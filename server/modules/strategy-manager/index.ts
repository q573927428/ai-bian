// ==================== 策略管理器初始化 ====================

import { StrategyManager } from './StrategyManager'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { StrategyEngine } from '../strategy-engine/StrategyEngine'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { PositionManager, positionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { loadBotConfig } from '../../utils/storage'
import { logger } from '../../utils/logger'
import type { BotState } from '../../../types'
import { PositionStatus } from '../../../types'

let strategyManager: StrategyManager | null = null

/**
 * 初始化策略管理系统
 */
export async function initStrategyManager(): Promise<StrategyManager> {
  if (strategyManager) {
    return strategyManager
  }

  logger.info('StrategyManager', '开始初始化策略管理系统...')

  try {
    // 创建依赖实例
    const store = new StrategyStore()
    const binanceService = new BinanceService()
    try {
      await binanceService.initialize()
      logger.info('StrategyManager', 'Binance服务初始化成功')
    } catch (error: any) {
      logger.warn('StrategyManager', `Binance服务初始化失败: ${error.message}，部分功能可能受限`)
    }
    const config = await loadBotConfig()

    // 初始化指标中心
    const indicatorsHub = IndicatorsHub.getInstance(binanceService, config || undefined)

    // 初始化仓位管理器（使用全局单例）
    const positionMgr = positionManager
    // 加载本地持久化状态
    await positionMgr.init()

    // 初始化 BotState (默认值)
    const dateParts = new Date().toISOString().split('T')
    const defaultState: BotState = {
      status: PositionStatus.IDLE,
      currentPosition: null,
      circuitBreaker: {
        isTriggered: false,
        reason: '',
        timestamp: 0,
        dailyLoss: 0,
        consecutiveLosses: 0
      },
      todayTrades: 0,
      dailyPnL: 0,
      lastResetDate: dateParts[0] || new Date().toISOString().slice(0, 10),
      monitoringSymbols: [],
      isRunning: false,
      allowNewTrades: true
    }

    // 初始化策略执行引擎
    const engine = new StrategyEngine(
      store,
      indicatorsHub,
      positionMgr,
      binanceService,
      config || undefined,
      defaultState
    )

    // 初始化策略管理器
    strategyManager = new StrategyManager(store)
    strategyManager.setEngine(engine)
    strategyManager.setIndicatorsHub(indicatorsHub)

    logger.success('StrategyManager', '策略管理系统初始化完成')

    // 初始化 IndicatorsHub 的所有数据
    logger.info('StrategyManager', '开始初始化统一数据源...')
    await indicatorsHub.initializeAllData()

    // 启动定时更新循环
    indicatorsHub.startUpdateLoop(60 * 1000)

    // 加载所有激活的策略
    await strategyManager.loadActiveStrategies()

    return strategyManager
  } catch (error: any) {
    logger.error('StrategyManager', `策略管理系统初始化失败: ${error.message}`)
    throw error
  }
}

/**
 * 获取策略管理器实例
 */
export function getStrategyManager(): StrategyManager {
  if (!strategyManager) {
    throw new Error('策略管理器未初始化，请先调用 initStrategyManager()')
  }
  return strategyManager
}

/**
 * 销毁策略管理系统
 */
export async function destroyStrategyManager(): Promise<void> {
  if (strategyManager) {
    logger.info('StrategyManager', '正在销毁策略管理系统...')

    // 停止所有策略
    const engine = (strategyManager as any).engine as StrategyEngine
    if (engine) {
      await engine.destroy()
    }

    strategyManager = null
    logger.success('StrategyManager', '策略管理系统已销毁')
  }
}
