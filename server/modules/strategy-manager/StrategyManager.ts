// ==================== 策略管理器 ====================

import type {
  Strategy,
  StrategyId,
  CreateStrategyInput,
  UpdateStrategyInput,
  StrategyStatus
} from '../../../types/strategy'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { StrategyEngine } from '../strategy-engine/StrategyEngine'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { logger } from '../../utils/logger'

/**
 * 策略管理器
 *
 * 职责：
 * 1. 策略 CRUD 操作
 * 2. 策略版本控制
 * 3. 策略激活/停用
 * 4. 策略加载到执行引擎
 */
export class StrategyManager {
  private store: StrategyStore
  private engine: StrategyEngine | null = null
  private indicatorsHub: IndicatorsHub | null = null

  constructor(store: StrategyStore) {
    this.store = store
  }

  /**
   * 设置执行引擎
   */
  setEngine(engine: StrategyEngine): void {
    this.engine = engine
  }

  /**
   * 获取执行引擎
   */
  getEngine(): StrategyEngine {
    if (!this.engine) {
      throw new Error('执行引擎未初始化')
    }
    return this.engine
  }

  /**
   * 设置指标中心
   */
  setIndicatorsHub(hub: IndicatorsHub): void {
    this.indicatorsHub = hub
  }

  /**
   * 获取指标中心
   */
  getIndicatorsHub(): IndicatorsHub {
    if (!this.indicatorsHub) {
      throw new Error('指标中心未初始化')
    }
    return this.indicatorsHub
  }

  // ==================== 策略 CRUD ====================

  /**
   * 创建新策略
   */
  async createStrategy(input: CreateStrategyInput): Promise<Strategy> {
    logger.info('StrategyManager', `开始创建策略: ${input.name}`)

    const strategy = await this.store.createStrategy(input)

    logger.success('StrategyManager', `策略创建成功: ${strategy.name} (${strategy.id})`)
    return strategy
  }

  /**
   * 获取单个策略
   */
  async getStrategy(strategyId: StrategyId): Promise<Strategy | null> {
    return this.store.getStrategy(strategyId)
  }

  /**
   * 获取所有策略
   */
  async getAllStrategies(): Promise<Strategy[]> {
    return this.store.getAllStrategies()
  }

  /**
   * 获取所有激活的策略
   */
  async getActiveStrategies(): Promise<Strategy[]> {
    return this.store.getActiveStrategies()
  }

  /**
   * 更新策略（自动创建新版本）
   */
  async updateStrategy(
    strategyId: StrategyId,
    updates: UpdateStrategyInput,
    changes: string
  ): Promise<Strategy | null> {
    logger.info('StrategyManager', `开始更新策略: ${strategyId}`)

    const strategy = await this.store.updateStrategy(strategyId, updates, changes)

    if (strategy) {
      logger.success('StrategyManager', `策略更新成功: ${strategy.name} (v${strategy.version})`)

      // 如果策略正在运行，需要重启以应用新配置
      if (this.engine && strategy.isActive) {
        logger.info('StrategyManager', `策略正在运行，需要重启以应用新配置`)
        await this.engine.restartStrategy(strategyId)
      }
    }

    return strategy
  }

  /**
   * 回滚策略到指定版本
   */
  async rollbackStrategy(
    strategyId: StrategyId,
    targetVersion: number
  ): Promise<Strategy | null> {
    logger.info('StrategyManager', `开始回滚策略: ${strategyId} 到 v${targetVersion}`)

    const strategy = await this.store.rollbackStrategy(strategyId, targetVersion)

    if (strategy) {
      logger.success('StrategyManager', `策略回滚成功: ${strategy.name} (v${strategy.version})`)

      // 如果策略正在运行，需要重启
      if (this.engine && strategy.isActive) {
        await this.engine.restartStrategy(strategyId)
      }
    }

    return strategy
  }

  /**
   * 删除策略（软删除）
   */
  async deleteStrategy(strategyId: StrategyId): Promise<boolean> {
    logger.info('StrategyManager', `开始删除策略: ${strategyId}`)

    // 如果策略正在运行，先停止
    if (this.engine) {
      await this.engine.stopStrategy(strategyId)
    }

    const success = await this.store.deleteStrategy(strategyId)

    if (success) {
      logger.success('StrategyManager', `策略删除成功: ${strategyId}`)
    }

    return success
  }

  // ==================== 策略状态管理 ====================

  /**
   * 激活/停用策略
   */
  async toggleStrategy(strategyId: StrategyId, active: boolean): Promise<Strategy | null> {
    logger.info('StrategyManager', `${active ? '激活' : '停用'}策略: ${strategyId}`)

    const strategy = await this.store.toggleStrategy(strategyId, active)

    if (!strategy) {
      logger.error('StrategyManager', `策略不存在: ${strategyId}`)
      return null
    }

    // 如果激活，加载到执行引擎
    if (active && this.engine && this.indicatorsHub) {
      await this.engine.startStrategy(strategyId)
      await this.indicatorsHub.subscribe(strategyId)
      logger.success('StrategyManager', `策略已激活并加载: ${strategy.name}`)
    }

    // 如果停用，从执行引擎移除
    if (!active && this.engine) {
      await this.engine.stopStrategy(strategyId)
      if (this.indicatorsHub) {
        this.indicatorsHub.unsubscribe(strategyId)
      }
      logger.success('StrategyManager', `策略已停用并卸载: ${strategy.name}`)
    }

    return strategy
  }

  /**
   * 加载所有激活的策略到执行引擎
   */
  async loadActiveStrategies(): Promise<void> {
    if (!this.engine || !this.indicatorsHub) {
      logger.warn('StrategyManager', '执行引擎或指标中心未设置')
      return
    }

    // logger.info('StrategyManager', '开始加载所有激活的策略...')

    const activeStrategies = await this.store.getActiveStrategies()

    if (activeStrategies.length === 0) {
      logger.info('StrategyManager', '没有激活的策略')
      return
    }

    for (const strategy of activeStrategies) {
      try {
        // 订阅指标
        await this.indicatorsHub.subscribe(strategy.id)

        // 启动策略执行
        await this.engine.startStrategy(strategy.id)

        // logger.success('StrategyManager', `策略已加载: ${strategy.name} (${strategy.id})`)
      } catch (error: any) {
        logger.error('StrategyManager', `加载策略失败 ${strategy.id}: ${error.message}`)
      }
    }

    logger.success('StrategyManager', `已加载 ${activeStrategies.length} 个策略`)
  }

  // ==================== 版本历史 ====================

  /**
   * 获取策略版本历史
   */
  async getVersionHistory(strategyId: StrategyId): Promise<any[] | null> {
    return this.store.getVersionHistory(strategyId)
  }

  /**
   * 获取指定版本的完整快照
   */
  async getVersionSnapshot(
    strategyId: StrategyId,
    version: number
  ): Promise<Strategy | null> {
    return this.store.getVersionSnapshot(strategyId, version)
  }

  // ==================== 策略状态查询 ====================

  /**
   * 获取策略运行状态
   */
  async getStrategyStatus(strategyId: StrategyId): Promise<StrategyStatus | null> {
    const strategy = await this.store.getStrategy(strategyId)
    if (!strategy) {
      return null
    }

    // 从执行引擎获取运行时状态
    const runtimeStatus = this.engine?.getStrategyRuntimeStatus(strategyId)

    return {
      id: strategy.id,
      name: strategy.name,
      version: strategy.version,
      isActive: strategy.isActive,
      isRunning: runtimeStatus?.isRunning || false,
      lastScanTime: runtimeStatus?.lastScanTime,
      lastSignalTime: runtimeStatus?.lastSignalTime,
      totalSignals: runtimeStatus?.totalSignals || 0,
      totalTrades: runtimeStatus?.totalTrades || 0,
      winRate: runtimeStatus?.winRate || 0,
      currentPositions: runtimeStatus?.currentPositions || 0,
      error: runtimeStatus?.error
    }
  }

  /**
   * 获取所有策略的运行状态
   */
  async getAllStrategiesStatus(): Promise<StrategyStatus[]> {
    const allStrategies = await this.store.getAllStrategies()
    const statuses: StrategyStatus[] = []

    for (const strategy of allStrategies) {
      const status = await this.getStrategyStatus(strategy.id)
      if (status) {
        statuses.push(status)
      }
    }

    return statuses
  }

  // ==================== 策略测试 ====================

  /**
   * 测试策略信号（手动触发一次分析）
   */
  async testStrategySignal(strategyId: StrategyId, symbol: string): Promise<any> {
    if (!this.engine) {
      throw new Error('执行引擎未设置')
    }

    logger.info('StrategyManager', `测试策略信号: ${strategyId} - ${symbol}`)

    return this.engine.analyzeSymbolForTest(strategyId, symbol)
  }
}
