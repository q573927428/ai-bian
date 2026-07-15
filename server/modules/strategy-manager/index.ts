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
import { getSyncService, waitForSyncReady, startKLineAutoSync } from '../../utils/kline-sync-service'
import { initKLineDb } from '../../utils/kline-simple-storage'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { indicatorCombinationRegistry } from '../indicators/IndicatorCombinationRegistry'
import { IndicatorPrecomputeService } from '../indicators/IndicatorPrecomputeService'

let strategyManager: StrategyManager | null = null

const POSITION_MONITOR_START_DELAY_MS = 5000
const STRATEGY_FIRST_SCAN_DELAY_MS = 20000

/**
 * 初始化策略管理系统
 */
export async function initStrategyManager(): Promise<StrategyManager> {
  if (strategyManager) {
    return strategyManager
  }

  // logger.info('StrategyManager', '开始初始化策略管理系统...')

  try {
    // 确保K线数据库已初始化（sql.js）
    await initKLineDb()
    
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
    concurrencyPoolManager.updateConfig({
      indicatorConcurrency: config.concurrencyPool?.indicator?.maxConcurrency,
      aiConcurrency: config.concurrencyPool?.ai?.maxConcurrency,
      tradeApiConcurrency: config.concurrencyPool?.tradeApi?.maxConcurrency
    })
    binanceApiGateway.updateConfig(config.binanceRateLimit)

    logger.info('启动顺序', '阶段1/5：初始化基础服务、Binance、并发池和限流配置')

    // 初始化指标中心
    const indicatorsHub = IndicatorsHub.getInstance(binanceService, config)
    const indicatorPrecompute = new IndicatorPrecomputeService(indicatorCombinationRegistry, indicatorsHub, config)

    // 订阅 K线同步服务的更新事件
    const syncService = getSyncService()
    if (syncService) {
      logger.info('启动顺序', '等待K线初始同步完成后再初始化策略系统')
      await waitForSyncReady()
      const eventEmitter = syncService.getEventEmitter()
      indicatorsHub.subscribeToKLineUpdates(eventEmitter)
      // logger.success('StrategyManager', '已连接K线同步服务与指标中心')
    } else {
      logger.warn('StrategyManager', 'K线同步服务尚未初始化，无法连接事件')
    }

    // 初始化仓位管理器（使用全局单例）
    const positionMgr = positionManager
    // 加载本地持久化状态
    await positionMgr.init()

    // 初始化 BotState (默认值)
    const dateParts = new Date().toISOString().split('T')
    const defaultState: BotState = {
      status: PositionStatus.IDLE,
      circuitBreaker: {
        isTriggered: false,
        reason: '',
        timestamp: 0,
        dailyLoss: 0,
        consecutiveLosses: 0
      },
      dailyPnL: 0,
      isRunning: false
    }

    // 初始化策略执行引擎
    const engine = new StrategyEngine(
      store,
      indicatorsHub,
      positionMgr,
      binanceService,
      config,
      defaultState,
      indicatorCombinationRegistry,
      indicatorPrecompute
    )
    engine.delayInitialScans(STRATEGY_FIRST_SCAN_DELAY_MS)

    // 初始化策略管理器
    strategyManager = new StrategyManager(store)
    strategyManager.setEngine(engine)
    strategyManager.setIndicatorsHub(indicatorsHub)
    strategyManager.setIndicatorPrecomputeService(indicatorPrecompute)

    // logger.success('StrategyManager', '策略管理系统初始化完成')

    logger.info('启动顺序', '阶段2/5：加载K线缓存和指标基础数据')
    await indicatorsHub.initializeAllData()

    logger.info('启动顺序', '阶段3/5：加载激活策略并完成首轮指标预计算')
    await strategyManager.loadActiveStrategies()
    engine.delayInitialScans(STRATEGY_FIRST_SCAN_DELAY_MS)

    logger.info('启动顺序', '阶段4/5：启动指标刷新、指标预计算定时器和K线定时同步')
    indicatorsHub.startUpdateLoop(60 * 1000)
    indicatorPrecompute.start()
    startKLineAutoSync()

    logger.info('启动顺序', `阶段5/5：${POSITION_MONITOR_START_DELAY_MS}ms 后启动持仓监控，${STRATEGY_FIRST_SCAN_DELAY_MS}ms 后允许策略首次扫描`)
    engine.startPositionMonitor({
      immediate: true,
      initialDelayMs: POSITION_MONITOR_START_DELAY_MS
    })

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
