// ==================== 策略管理器 ====================

import type {
  Strategy,
  StrategyId,
  CreateStrategyInput,
  UpdateStrategyInput,
  StrategyStatus
} from '../../../types/strategy'
import type { BotConfig } from '../../../types'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { StrategyEngine } from '../strategy-engine/StrategyEngine'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { logger } from '../../utils/logger'
import { getBotConfig, saveBotConfig } from '../../utils/storage'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { indicatorCombinationRegistry, type IndicatorCombinationRegistry } from '../indicators/IndicatorCombinationRegistry'
import type { IndicatorPrecomputeService } from '../indicators/IndicatorPrecomputeService'

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
  private indicatorRegistry: IndicatorCombinationRegistry = indicatorCombinationRegistry
  private indicatorPrecompute: IndicatorPrecomputeService | null = null
  private refreshRegistryTimer: NodeJS.Timeout | null = null

  constructor(store: StrategyStore) {
    this.store = store
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '').toUpperCase()
  }

  private async getAllowedSymbolMap(): Promise<Map<string, string>> {
    const config = await getBotConfig()
    const symbols = Array.isArray(config.symbols) ? config.symbols : []
    return new Map(symbols.map(symbol => [this.normalizeSymbol(symbol), symbol]))
  }

  private filterSymbolsByConfig(
    symbols: string[] = [],
    allowedSymbolMap: Map<string, string>
  ): { symbols: string[]; removed: string[] } {
    const filtered: string[] = []
    const removed: string[] = []
    const seen = new Set<string>()

    for (const symbol of symbols) {
      const key = this.normalizeSymbol(symbol)
      const allowedSymbol = allowedSymbolMap.get(key)
      if (!allowedSymbol) {
        removed.push(symbol)
        continue
      }
      if (!seen.has(key)) {
        seen.add(key)
        filtered.push(allowedSymbol)
      }
    }

    return { symbols: filtered, removed }
  }

  private async sanitizeCreateInput(input: CreateStrategyInput): Promise<CreateStrategyInput> {
    const allowedSymbolMap = await this.getAllowedSymbolMap()
    const { symbols, removed } = this.filterSymbolsByConfig(input.marketData?.symbols || [], allowedSymbolMap)

    if (removed.length > 0) {
      logger.warn('StrategyManager', `创建策略时移除不在 bot-config.symbols 中的交易对: ${removed.join(', ')}`)
    }
    if (symbols.length === 0) {
      throw new Error('策略交易对不能为空，且必须来自 bot-config.symbols')
    }

    return {
      ...input,
      marketData: {
        ...input.marketData,
        symbols
      }
    }
  }

  private async sanitizeUpdates(updates: UpdateStrategyInput): Promise<UpdateStrategyInput> {
    if (!updates.marketData?.symbols) return updates

    const allowedSymbolMap = await this.getAllowedSymbolMap()
    const { symbols, removed } = this.filterSymbolsByConfig(updates.marketData.symbols, allowedSymbolMap)

    if (removed.length > 0) {
      logger.warn('StrategyManager', `更新策略时移除不在 bot-config.symbols 中的交易对: ${removed.join(', ')}`)
    }
    if (symbols.length === 0) {
      throw new Error('策略交易对不能为空，且必须来自 bot-config.symbols')
    }

    return {
      ...updates,
      marketData: {
        ...updates.marketData,
        symbols
      }
    }
  }

  private async enforceStrategySymbols(strategy: Strategy): Promise<Strategy> {
    const allowedSymbolMap = await this.getAllowedSymbolMap()
    const originalSymbols = strategy.marketData?.symbols || []
    const { symbols, removed } = this.filterSymbolsByConfig(originalSymbols, allowedSymbolMap)

    const changed =
      symbols.length !== originalSymbols.length ||
      symbols.some((symbol, index) => symbol !== originalSymbols[index])

    if (!changed) return strategy

    logger.warn(
      'StrategyManager',
      `策略 ${strategy.name} (${strategy.id}) 已移除不在 bot-config.symbols 中的交易对: ${removed.join(', ') || '格式归一化'}`
    )

    const updated = await this.store.updateStrategyWithoutVersion(strategy.id, {
      marketData: {
        ...strategy.marketData,
        symbols
      }
    })

    return updated || {
      ...strategy,
      marketData: {
        ...strategy.marketData,
        symbols
      }
    }
  }

  private async enforceStrategiesSymbols(strategies: Strategy[]): Promise<Strategy[]> {
    const sanitizedStrategies: Strategy[] = []
    for (const strategy of strategies) {
      sanitizedStrategies.push(await this.enforceStrategySymbols(strategy))
    }
    return sanitizedStrategies
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

  setIndicatorPrecomputeService(service: IndicatorPrecomputeService): void {
    this.indicatorPrecompute = service
    this.engine?.setIndicatorPrecomputeService(service)
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

  private scheduleIndicatorRegistryRefresh(immediate = false): void {
    if (this.refreshRegistryTimer) {
      clearTimeout(this.refreshRegistryTimer)
      this.refreshRegistryTimer = null
    }

    const run = async () => {
      try {
        const activeStrategies = await this.getActiveStrategies()
        this.indicatorRegistry.rebuildFromStrategies(activeStrategies)
        logger.info('StrategyManager', `指标组合注册表已刷新: ${this.indicatorRegistry.getCombinations().length} 个组合`)
        if (this.indicatorPrecompute && this.engine) {
          const config = (this.engine as any).config as BotConfig
          if (config.indicatorPrecompute?.computeOnStrategyChange !== false) {
            this.indicatorPrecompute.precomputeAll().catch((error: any) => {
              logger.warn('StrategyManager', `策略变更后指标预计算失败: ${error.message}`)
            })
          }
        }
      } catch (error: any) {
        logger.error('StrategyManager', `刷新指标组合注册表失败: ${error.message}`)
      }
    }

    if (immediate) {
      void run()
      return
    }

    this.refreshRegistryTimer = setTimeout(() => {
      this.refreshRegistryTimer = null
      void run()
    }, 300)
  }

  // ==================== 策略 CRUD ====================

  /**
   * 创建新策略
   */
  async createStrategy(input: CreateStrategyInput): Promise<Strategy> {
    logger.info('StrategyManager', `开始创建策略: ${input.name}`)

    const sanitizedInput = await this.sanitizeCreateInput(input)
    const strategy = await this.store.createStrategy(sanitizedInput)

    this.scheduleIndicatorRegistryRefresh()
    logger.success('StrategyManager', `策略创建成功: ${strategy.name} (${strategy.id})`)
    return strategy
  }

  /**
   * 获取单个策略
   */
  async getStrategy(strategyId: StrategyId): Promise<Strategy | null> {
    const strategy = await this.store.getStrategy(strategyId)
    return strategy ? await this.enforceStrategySymbols(strategy) : null
  }

  /**
   * 获取所有策略
   */
  async getAllStrategies(): Promise<Strategy[]> {
    return this.enforceStrategiesSymbols(await this.store.getAllStrategies())
  }

  /**
   * 获取所有激活的策略
   */
  async getActiveStrategies(): Promise<Strategy[]> {
    return this.enforceStrategiesSymbols(await this.store.getActiveStrategies())
  }

  /**
   * 更新策略（普通更新，不创建新版本）
   */
  async updateStrategyWithoutVersion(
    strategyId: StrategyId,
    updates: UpdateStrategyInput
  ): Promise<Strategy | null> {
    logger.info('StrategyManager', `开始更新策略（普通更新）: ${strategyId}`)

    const sanitizedUpdates = await this.sanitizeUpdates(updates)
    const strategy = await this.store.updateStrategyWithoutVersion(strategyId, sanitizedUpdates)

    if (strategy) {
      logger.success('StrategyManager', `策略更新成功（普通更新）: ${strategy.name}`)

      // 如果策略正在运行，需要重启以应用新配置
      if (this.engine && strategy.isActive) {
        logger.info('StrategyManager', `策略正在运行，需要重启以应用新配置`)
        await this.engine.restartStrategy(strategyId)
      }
      this.scheduleIndicatorRegistryRefresh()
    }

    return strategy
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

    const sanitizedUpdates = await this.sanitizeUpdates(updates)
    const strategy = await this.store.updateStrategy(strategyId, sanitizedUpdates, changes)

    if (strategy) {
      logger.success('StrategyManager', `策略更新成功: ${strategy.name} (v${strategy.version})`)

      // 如果策略正在运行，需要重启以应用新配置
      if (this.engine && strategy.isActive) {
        logger.info('StrategyManager', `策略正在运行，需要重启以应用新配置`)
        await this.engine.restartStrategy(strategyId)
      }
      this.scheduleIndicatorRegistryRefresh()
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
      this.scheduleIndicatorRegistryRefresh()
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
      this.indicatorRegistry.removeStrategy(strategyId)
      this.scheduleIndicatorRegistryRefresh()
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

    const sanitizedStrategy = await this.enforceStrategySymbols(strategy)

    // 如果激活，加载到执行引擎
    if (active && this.engine && this.indicatorsHub) {
      await this.engine.startStrategy(strategyId)
      await this.indicatorsHub.subscribe(strategyId)
      this.scheduleIndicatorRegistryRefresh()
      logger.success('StrategyManager', `策略已激活并加载: ${sanitizedStrategy.name}`)
    }

    // 如果停用，从执行引擎移除
    if (!active && this.engine) {
      await this.engine.stopStrategy(strategyId)
      if (this.indicatorsHub) {
        this.indicatorsHub.unsubscribe(strategyId)
      }
      this.indicatorRegistry.removeStrategy(strategyId)
      this.scheduleIndicatorRegistryRefresh()
      logger.success('StrategyManager', `策略已停用并卸载: ${sanitizedStrategy.name}`)
    }

    return sanitizedStrategy
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

    const activeStrategies = await this.getActiveStrategies()

    if (activeStrategies.length === 0) {
      this.indicatorRegistry.rebuildFromStrategies([])
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
    this.indicatorRegistry.rebuildFromStrategies(activeStrategies)
    logger.info('StrategyManager', `指标组合注册表已初始化: ${this.indicatorRegistry.getCombinations().length} 个组合`)
    try {
      await this.indicatorPrecompute?.precomputeAll()
    } catch (error: any) {
      logger.warn('StrategyManager', `初始化指标预计算失败: ${error.message}`)
    }
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

  // ==================== 配置管理 ====================

  /**
   * 更新系统配置
   */
  async updateConfig(config: BotConfig): Promise<void> {
    if (!this.engine) {
      throw new Error('执行引擎未设置')
    }

    logger.info('StrategyManager', '更新系统配置')
    
    // 保存配置到文件
    await saveBotConfig(config)
    concurrencyPoolManager.updateConfig({
      indicatorConcurrency: config.concurrencyPool?.indicator?.maxConcurrency,
      aiConcurrency: config.concurrencyPool?.ai?.maxConcurrency,
      tradeApiConcurrency: config.concurrencyPool?.tradeApi?.maxConcurrency
    })
    binanceApiGateway.updateConfig(config.binanceRateLimit)
    
    // 通知引擎更新配置
    this.engine.updateConfig(config)
    this.indicatorPrecompute?.updateConfig(config)
    
    logger.success('StrategyManager', '系统配置已更新')
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

  /**
   * 强制开仓 - 直接构造 TradeSignal 并执行，置信度=100 finalScore=100
   */
  async forceOpenPosition(strategyId: StrategyId, symbol: string, direction: 'long' | 'short'): Promise<any> {
    if (!this.engine) {
      throw new Error('执行引擎未设置')
    }

    logger.info('StrategyManager', `强制开仓: ${strategyId} - ${symbol} ${direction}`)

    return this.engine.forceOpenPosition(strategyId, symbol, direction)
  }
}
