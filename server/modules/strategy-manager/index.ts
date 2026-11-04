// ==================== 策略管理器初始化 ====================

import { StrategyManager } from './StrategyManager'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { StrategyEngine, getInitialScanDelayMs } from '../strategy-engine/StrategyEngine'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { PositionManager, positionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { loadBotConfig, loadBotState, saveBotState } from '../../utils/storage'
import { resetDailyRiskState } from '../risk-control/DailyRiskState'
import { logger } from '../../utils/logger'
import type { BotState } from '../../../types'
import { getSyncService, waitForSyncReady, startKLineAutoSync } from '../../utils/kline-sync-service'
import { initKLineDb } from '../../utils/kline-simple-storage'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { indicatorCombinationRegistry } from '../indicators/IndicatorCombinationRegistry'
import { IndicatorPrecomputeService } from '../indicators/IndicatorPrecomputeService'

let strategyManager: StrategyManager | null = null
let initializationPromise: Promise<StrategyManager> | null = null

/**
 * 同一进程内的并发初始化共用一个任务，避免重复创建引擎、监控和定时器。
 */
export function initStrategyManager(): Promise<StrategyManager> {
  if (initializationPromise) return initializationPromise
  if (strategyManager) return Promise.resolve(strategyManager)

  // 先登记共享任务再执行初始化；失败后清除任务，允许后续显式重试。
  initializationPromise = Promise.resolve().then(initializeStrategyManager).finally(() => {
    initializationPromise = null
  })
  return initializationPromise
}

/** 按既有顺序初始化；仅在指标、持仓监控和扫描调度准备完成后发布实例。 */
async function initializeStrategyManager(): Promise<StrategyManager> {
  let manager: StrategyManager | null = null
  let precompute: IndicatorPrecomputeService | null = null

  try {
    // 确保 K 线数据库已初始化（node:sqlite）
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

    logger.info('🟡 启动顺序', '阶段1/6：初始化基础服务、Binance、并发池和限流配置')

    // 初始化指标中心
    const indicatorsHub = IndicatorsHub.getInstance(binanceService, config)
    const indicatorPrecompute = new IndicatorPrecomputeService(indicatorCombinationRegistry, indicatorsHub, config)
    precompute = indicatorPrecompute

    // 订阅 K线同步服务的更新事件
    const syncService = getSyncService()
    if (syncService) {
      logger.info('🟡 启动顺序', '阶段1.1/6：初等待K线初始同步完成后再初始化策略系统')
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

    // 同一天重启必须恢复净盈亏和已触发的门禁，避免重启重新获得亏损额度。
    // 运行状态仍由策略实例管理，不从风控文件恢复。
    const state: BotState = await loadBotState() ?? {
      strategyDailyRisk: {}
    }
    // 在首次持仓监控和策略扫描前切换日期，不能把昨天的熔断带入今天。
    if (resetDailyRiskState(state)) {
      await saveBotState(state)
    }

    // 初始化策略执行引擎
    const engine = new StrategyEngine(
      store,
      indicatorsHub,
      positionMgr,
      binanceService,
      config,
      state,
      indicatorCombinationRegistry,
      indicatorPrecompute
    )
    // 策略必须先加载才能构建指标组合，但首轮预计算完成前禁止扫描。
    engine.pauseStrategyScans()

    // 初始化策略管理器
    manager = new StrategyManager(store)
    manager.setEngine(engine)
    manager.setIndicatorsHub(indicatorsHub)
    manager.setIndicatorPrecomputeService(indicatorPrecompute)

    // logger.success('StrategyManager', '策略管理系统初始化完成')

    logger.info('🟡 启动顺序', '阶段2/6：加载K线缓存和指标基础数据')
    await indicatorsHub.initializeAllData()

    logger.info('🟡 启动顺序', '阶段3/6：加载激活策略并完成首轮指标预计算')
    await manager.loadActiveStrategies()

    logger.info('🟡 启动顺序', '阶段4/6：启动指标刷新、指标预计算定时器和K线定时同步')
    indicatorsHub.startUpdateLoop(60 * 1000)
    indicatorPrecompute.start()
    startKLineAutoSync()

    logger.info('🟡 启动顺序', '阶段5/6：执行首次持仓监控')
    await engine.startPositionMonitor()
    logger.info('🟡 启动顺序', '阶段6/6：首次持仓监控已完成，开放策略首次扫描')
    const initialScanDelayMs = getInitialScanDelayMs()
    logger.info('StrategyManager', `首次策略扫描将在 ${Math.ceil(initialScanDelayMs / 1000)} 秒后执行（对齐到 5 分钟倍数 + 68 秒）`)
    engine.resumeStrategyScans(initialScanDelayMs)

    // 不让列表、配置修改等接口拿到仍在预计算中的半成品实例。
    strategyManager = manager
    return manager
  } catch (error: any) {
    // 失败重试前先停止本次创建的后台资源，防止遗留循环与下一次初始化重复运行。
    precompute?.stop()
    if (manager) {
      try {
        await manager.getEngine().destroy()
      } catch (cleanupError: any) {
        logger.error('StrategyManager', `初始化失败后清理引擎失败: ${cleanupError.message}`)
      }
      manager.getIndicatorsHub().shutdown()
    }
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

/** 只读看板在启动等待期间允许返回空状态，不触发初始化或改变启动顺序。 */
export function getStrategyManagerIfAvailable(): StrategyManager | null {
  return strategyManager
}

/**
 * 销毁策略管理系统
 */
export async function destroyStrategyManager(): Promise<void> {
  // 销毁时等正在运行的初始化结束，避免销毁返回后又发布一个新实例。
  if (initializationPromise) {
    try {
      await initializationPromise
    } catch {
      return // 初始化失败已在内部清理资源。
    }
  }
  if (strategyManager) {
    logger.info('StrategyManager', '正在销毁策略管理系统...')

    // 停止所有策略
    const engine = (strategyManager as any).engine as StrategyEngine
    if (engine) {
      await engine.destroy()
    }

    // 统一关闭指标刷新循环并清空 OI 内存，避免开发热重载残留旧快照。
    strategyManager.getIndicatorsHub().shutdown()

    strategyManager = null
    logger.success('StrategyManager', '策略管理系统已销毁')
  }
}
