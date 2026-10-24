// ==================== 策略执行引擎 ====================

import type { Strategy, StrategyId, Timeframe, AIPromptConfig } from '../../../types/strategy'
import type { TradeSignal } from '../../../types/signal'
import type { BotConfig, OrderExecutionSummary } from '../../../types'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { getMarketBreadth } from '../../utils/market-breadth'
import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { MultiStrategyAIAnalyzer } from '../ai-analyzer/MultiStrategyAIAnalyzer'
import { logger } from '../../utils/logger'
import { calculateStopLoss, calculateTakeProfit, calculatePositionSize, calculateMaxUsdtAmount } from '../../utils/indicators-risk'
import { getOrderSide } from '../../utils/trade-helpers'
import { StrategyPositionCloser } from './StrategyPositionCloser'
import { StrategyPositionMonitor } from './StrategyPositionMonitor'
import { waitAndConfirmPosition } from './helpers/position-helpers'
import { aiPreScreener } from '../../utils/ai-pre-screen'
import type { BotState } from '../../../types'
import { SymbolBasedScheduler, type MarketSnapshot } from '../scheduler/SymbolBasedScheduler'
import { concurrencyPoolManager, type ConcurrencyPoolManager } from '../../utils/concurrency-pool'
import { shortHash } from '../../utils/stable-hash'
import { indicatorCombinationRegistry, type IndicatorCombinationRegistry } from '../indicators/IndicatorCombinationRegistry'
import type { IndicatorPrecomputeService } from '../indicators/IndicatorPrecomputeService'
import { DailyTradeLimiter } from '../risk-control/DailyTradeLimiter'

/**
 * 计算首次策略扫描距离当前时间的等待毫秒数。
 * 首次扫描统一对齐到下一个“5 分钟倍数 + 88 秒”，避免启动时刻不一致导致扫描窗口错位。
 */
export function getInitialScanDelayMs(nowMs: number = Date.now()): number {
  const target = new Date(nowMs)
  target.setMinutes(Math.ceil(target.getMinutes() / 5) * 5, 0, 0)
  target.setSeconds(88, 0)

  // 恰好处于目标时刻允许立即执行；超过目标时刻则顺延到下一个 5 分钟窗口。
  if (target.getTime() < nowMs) {
    target.setMinutes(target.getMinutes() + 5)
  }

  return Math.max(0, target.getTime() - nowMs)
}

/**
 * 策略运行时状态
 */
export interface StrategyRuntimeStatus {
  isRunning: boolean;
  lastScanTime?: string;
  lastSignalTime?: string;
  totalSignals: number;
  totalTrades: number;
  winRate: number;
  currentPositions: number;
  error?: string;
}

/**
 * 策略实例
 */
interface StrategyInstance {
  strategy: Strategy;
  isRunning: boolean;
  lastScanTime?: string;
  /** 下次扫描时间戳（毫秒），用于按各自间隔独立调度 */
  nextScanTime?: number;
  lastSignalTime?: string;
  totalSignals: number;
  totalTrades: number;
  winTrades: number;
  error?: string;
}

/**
 * 策略执行引擎
 *
 * 核心职责：
 * 1. 管理多个策略的并发执行
 * 2. 策略主循环（定时扫描市场）
 * 3. 调用 AI 分析（带缓存）
 * 4. 执行交易信号
 * 5. 与仓位管理器协作（同交易对互斥）
 */
export class StrategyEngine {
  // 运行中的策略实例
  private runningStrategies: Map<StrategyId, StrategyInstance> = new Map()

  // 依赖
  private store: StrategyStore
  private indicatorsHub: IndicatorsHub
  private positionManager: PositionManager
  private binance: BinanceService

  // AI 分析器
  private aiAnalyzer: MultiStrategyAIAnalyzer
  // AI 分析缓存: cacheKey -> {signal, timestamp}
  private aiCache: Map<string, { signal: TradeSignal; timestamp: number }> = new Map()
  // AI 结果通常包含较长的推理文本，必须限制条目数，避免行情变化不断产生新 key 后长期占用内存。
  private readonly AI_CACHE_MAX_ENTRIES = 1000
  private aiCacheWritesSinceCleanup = 0

  // 持仓相关模块
  private positionCloser: StrategyPositionCloser
  private positionMonitor: StrategyPositionMonitor
  private state: BotState
  private config: BotConfig

  // 新调度架构
  private scheduler: SymbolBasedScheduler
  private concurrencyPoolManager: ConcurrencyPoolManager
  private globalTimer: NodeJS.Timeout | null = null
  private globalScanInterval: number = 300000 // 默认5分钟
  private immediateRunScheduled: boolean = false // 防抖：确保多个策略同时启动只触发一次立即运行
  private immediateRunTimer: NodeJS.Timeout | null = null
  private scansPaused = false
  private currentLoopAIRequests: number = 0
  private isGlobalLoopRunning = false
  private skippedLoopCount = 0
  private initialScanNotBefore = 0
  private loopStats = {
    isRunning: false,
    // 实际开始执行的扫描轮次；并发触发但被跳过的调用不计入此值。
    scanCount: 0,
    lastStartedAt: 0,
    lastFinishedAt: 0,
    lastDurationMs: 0,
    lastSymbols: 0,
    lastAIRequests: 0,
    skippedLoops: 0,
    exceededDurationCount: 0
  }
  private indicatorRegistry: IndicatorCombinationRegistry
  private indicatorPrecompute: IndicatorPrecomputeService | null
  // 每日开仓限制必须由所有信号共享同一实例，才能正确处理并发预占。
  private dailyTradeLimiter: DailyTradeLimiter


  constructor(
    store: StrategyStore,
    indicatorsHub: IndicatorsHub,
    positionManager: PositionManager,
    binance: BinanceService,
    config: BotConfig,
    state: BotState,
    registry: IndicatorCombinationRegistry = indicatorCombinationRegistry,
    precomputeService: IndicatorPrecomputeService | null = null
  ) {
    this.store = store
    this.indicatorsHub = indicatorsHub
    this.positionManager = positionManager
    this.binance = binance
    this.state = state
    this.config = config
    this.indicatorRegistry = registry
    this.indicatorPrecompute = precomputeService
    this.dailyTradeLimiter = new DailyTradeLimiter(positionManager)
    
    // AI预筛配置已改为按策略独立配置，不再从全局加载
    aiPreScreener.initFromBotConfig()

    // 初始化AI分析器
    this.aiAnalyzer = new MultiStrategyAIAnalyzer(binance, config)

    // 初始化持仓相关模块
    this.positionCloser = new StrategyPositionCloser(binance, positionManager, config, state)
    this.positionMonitor = new StrategyPositionMonitor(binance, positionManager, this.positionCloser, config, store)

    // 初始化新调度架构
    this.scheduler = new SymbolBasedScheduler(indicatorsHub, binance)
    this.concurrencyPoolManager = concurrencyPoolManager

    logger.info('StrategyEngine', '策略执行引擎已初始化（新调度架构已启用）')
  }

  /** 为策略列表提供真实开仓计数，复用执行开仓检查的限制器实例。 */
  async getDailyTradeStatus(strategyId: StrategyId, maxDailyTrades: number, now = Date.now()) {
    return this.dailyTradeLimiter.getStatus(strategyId, maxDailyTrades, now)
  }

  setIndicatorPrecomputeService(service: IndicatorPrecomputeService | null): void {
    this.indicatorPrecompute = service
  }

  /**
   * 等待首次持仓监控完成，再启动后续周期监控。
   */
  async startPositionMonitor(): Promise<void> {
    await this.positionMonitor.runOnce()
    this.positionMonitor.start()
  }

  /**
   * 暂停所有策略扫描。
   *
   * 启动阶段需要先加载策略以建立指标组合，但首轮预计算完成前不能执行扫描。
   */
  pauseStrategyScans(): void {
    this.scansPaused = true
    this.clearImmediateRunTimer()
  }

  /**
   * 恢复策略扫描，并从恢复时刻开始计算首次扫描延迟。
   */
  resumeStrategyScans(delayMs: number): void {
    this.scansPaused = false
    const targetTime = Date.now() + Math.max(0, Number(delayMs || 0))
    this.initialScanNotBefore = Math.max(this.initialScanNotBefore, targetTime)

    // 策略可能已在第一次延迟配置下创建；此时必须同步更新实例，否则旧的
    // nextScanTime 会让全局循环绕过新的启动保护窗口。
    for (const instance of this.runningStrategies.values()) {
      if (instance.isRunning) {
        instance.nextScanTime = Math.max(instance.nextScanTime || 0, this.initialScanNotBefore)
      }
    }

    // 只保留一个首次扫描定时器，避免多次调整启动时间产生空扫描。
    if (this.runningStrategies.size > 0) {
      const waitMs = Math.max(200, this.initialScanNotBefore - Date.now())
      this.scheduleImmediateRun(waitMs)
    }
  }

  /**
   * 安排唯一一次即时扫描；重新安排时取消旧回调。
   */
  private scheduleImmediateRun(delayMs: number): void {
    this.clearImmediateRunTimer()
    this.immediateRunScheduled = true
    this.immediateRunTimer = setTimeout(async () => {
      this.immediateRunTimer = null
      this.immediateRunScheduled = false
      await this.globalStrategyLoop()
    }, Math.max(200, delayMs))
  }

  /**
   * 清理尚未触发的即时扫描。
   */
  private clearImmediateRunTimer(): void {
    if (this.immediateRunTimer) {
      clearTimeout(this.immediateRunTimer)
      this.immediateRunTimer = null
    }
    this.immediateRunScheduled = false
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    aiPreScreener.initFromBotConfig()
    this.aiAnalyzer.updateConfig(config)
    this.indicatorsHub.updateConfig(config)
    this.indicatorPrecompute?.updateConfig(config)
    this.positionMonitor.stop()
    this.positionMonitor = new StrategyPositionMonitor(this.binance, this.positionManager, this.positionCloser, config, this.store)
    const updatedPositionMonitor = this.positionMonitor
    // 配置热更新不阻塞接口响应，但仍保持“单次监控完成后再启动周期监控”的顺序。
    void updatedPositionMonitor.runOnce().then(() => {
      updatedPositionMonitor.start()
    })
    logger.info('StrategyEngine', '配置已更新')
  }

  /**
   * 获取仓位管理器
   */
  getPositionManager(): PositionManager {
    return this.positionManager
  }

  /**
   * 获取Binance服务
   */
  getBinanceService(): BinanceService {
    return this.binance
  }

  /**
   * 将时间周期字符串转换为毫秒数
   */
  private timeframeToMs(timeframe: string): number {
    const unit = timeframe.slice(-1)
    const value = parseInt(timeframe.slice(0, -1))
    switch (unit) {
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return 15 * 60 * 1000 // 默认 15m
    }
  }

  /**
   * 计算当前K线已走的时间比例 (0-1)
   */
  private calculateCandleProgress(candleTimestamp: number, timeframe: string): number {
    const timeframeMs = this.timeframeToMs(timeframe)
    const now = Date.now()
    const elapsed = now - candleTimestamp
    const progress = Math.min(Math.max(elapsed / timeframeMs, 0), 1)
    return progress
  }

  /**
   * 时间周期转分钟数
   */
  private timeframeToMinutes(timeframe: string): number {
    return Math.max(1, Math.floor(this.timeframeToMs(timeframe) / (60 * 1000)))
  }

  /**
   * AI缓存TTL（毫秒）
   */
  private getAiCacheTtl(): number {
    const minutes = Math.max(1, Number(this.config.aiCacheTtlMinutes ?? 10))
    return minutes * 60 * 1000
  }

  // ==================== 策略生命周期 ====================

  /**
   * 启动策略
   */
  async startStrategy(strategyId: StrategyId): Promise<void> {
    // 检查是否已在运行
    if (this.runningStrategies.has(strategyId)) {
      logger.warn('StrategyEngine', `策略已在运行: ${strategyId}`)
      return
    }

    // 获取策略配置
    const strategy = await this.store.getStrategy(strategyId)
    if (!strategy) {
      logger.error('StrategyEngine', `策略不存在: ${strategyId}`)
      return
    }

    if (!strategy.isActive) {
      logger.warn('StrategyEngine', `策略未激活: ${strategyId}`)
      return
    }

    const requiresOI = strategy.statistics.some(stat => stat.type === 'OI' && stat.enabled)
    if (requiresOI) {
      // 仅启用 OI 的策略需要历史序列；必须在订阅和首轮扫描前完成按交易对去重预热。
      await this.indicatorsHub.initializeOIHistory(strategy.marketData.symbols)
    }

    // logger.info('StrategyEngine', `启动策略: ${strategy.name} (${strategyId})`)

    // 订阅策略到调度器
    this.scheduler.subscribeStrategy(strategy)

    // 创建策略实例
    const instance: StrategyInstance = {
      strategy,
      isRunning: true,
      totalSignals: 0,
      totalTrades: 0,
      winTrades: 0
    }

    this.runningStrategies.set(strategyId, instance)

    // 启动策略循环
    this.startStrategyLoop(instance)

    // logger.success('StrategyEngine', `策略已启动: ${strategy.name}`)
  }

  /**
   * 停止策略
   */
  async stopStrategy(strategyId: StrategyId): Promise<void> {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      logger.warn('StrategyEngine', `策略未运行: ${strategyId}`)
      return
    }

    logger.info('StrategyEngine', `停止策略: ${instance.strategy.name} (${strategyId})`)

    // 取消订阅
    this.scheduler.unsubscribeStrategy(strategyId)

    // 停止循环
    this.stopStrategyLoop(instance)

    // 移除实例
    this.runningStrategies.delete(strategyId)

    logger.success('StrategyEngine', `策略已停止: ${instance.strategy.name}`)
  }

  /**
   * 重启策略（用于配置更新后）
   */
  async restartStrategy(strategyId: StrategyId): Promise<void> {
    logger.info('StrategyEngine', `重启策略: ${strategyId}`)

    await this.stopStrategy(strategyId)
    await this.startStrategy(strategyId)
  }

  // ==================== 策略循环 ====================

  /**
   * 启动策略循环（全局统一调度入口）
   * 不再为每个策略创建独立定时器，改为启动/维护全局统一循环
   */
  private startStrategyLoop(instance: StrategyInstance): void {
    // 初始化该策略的下次扫描时间。启动编排阶段可延后首次扫描，避免与K线同步/预计算/持仓监控抢资源。
    const now = Date.now()
    instance.nextScanTime = Math.max(now, this.initialScanNotBefore)

    // 更新全局扫描间隔（取所有策略中的最小值）
    this.updateGlobalScanInterval()

    // 防抖：多个策略同时启动时，只安排一次立即运行
    if (!this.scansPaused && !this.immediateRunScheduled) {
      const delayMs = Math.max(200, instance.nextScanTime - now)
      // 使用延迟确保所有策略的异步初始化（subscribeStrategy 等）全部完成后再执行全局循环
      this.scheduleImmediateRun(delayMs)
    }

    // 如果全局定时器未启动，则启动
    if (!this.globalTimer) {
      this.globalTimer = setInterval(() => {
        // 使用 void 忽略异步操作的 Promise，避免 setInterval 堆积
        void this.globalStrategyLoop()
      }, this.globalScanInterval)
      // logger.info('StrategyEngine', `全局策略循环已启动, 间隔 ${this.globalScanInterval / 1000}秒`)
    }
  }

  /**
   * 停止策略循环
   */
  private stopStrategyLoop(instance: StrategyInstance): void {
    instance.isRunning = false

    // 如果所有策略都已停止，停止全局定时器
    const hasRunning = Array.from(this.runningStrategies.values()).some(i => i.isRunning)
    if (!hasRunning) {
      if (this.globalTimer) {
        clearInterval(this.globalTimer)
        this.globalTimer = null
      }
      this.clearImmediateRunTimer()
      logger.info('StrategyEngine', '全局策略循环已停止（无运行中的策略）')
    }
  }

  /**
   * 更新全局扫描间隔（取所有运行策略中的最小值）
   * 间隔必须是300秒（5分钟）的整数倍
   */
  private updateGlobalScanInterval(): void {
    const MIN_INTERVAL_MS = 300000 // 最小间隔 5分钟
    const SCAN_STEP_MS = 300000 // 步长 5分钟（只能为5的倍数）
    
    let minInterval = Infinity
    for (const instance of this.runningStrategies.values()) {
      if (!instance.isRunning) continue
      const scanMinutes = instance.strategy.executionConfig.scanInterval
      if (scanMinutes && scanMinutes > 0) {
        const intervalMs = scanMinutes * 60000
        // 向上取整到 SCAN_STEP_MS 的倍数，且不低于 MIN_INTERVAL_MS
        const rounded = Math.max(
          MIN_INTERVAL_MS,
          Math.ceil(intervalMs / SCAN_STEP_MS) * SCAN_STEP_MS
        )
        if (rounded < minInterval) {
          minInterval = rounded
        }
      }
    }
    
    // 如果没有任何运行策略，使用默认值
    this.globalScanInterval = minInterval === Infinity ? MIN_INTERVAL_MS : minInterval
  }

  /**
   * 全局统一策略循环 - 按交易对聚合调度
   * 
   * 设计思路：
   * - 全局定时器以所有策略中最短的间隔（必为5分钟倍数）运行
   * - 每次触发时，按交易对构建一次快照，但只分发给"距上次扫描已达自身间隔"的策略
   * - 这样策略A(5min)和策略B(10min)都使用同一份5分钟级快照，但B每两次才执行一次
   */
  private async globalStrategyLoop(): Promise<void> {
    // 启动阶段会先注册策略以构建指标组合；预计算完成前禁止任何定时入口开始扫描。
    if (this.scansPaused) return

    if (this.isGlobalLoopRunning) {
      this.skippedLoopCount++
      this.loopStats.skippedLoops = this.skippedLoopCount
      logger.warn('StrategyEngine', `上一轮扫描尚未完成，跳过本次扫描，累计跳过 ${this.skippedLoopCount} 次`)
      return
    }

    this.isGlobalLoopRunning = true
    const loopStartTime = Date.now()
    // 只有通过并发保护并真正进入扫描的调用才计为一轮。
    this.loopStats.scanCount++
    this.loopStats.isRunning = true
    this.loopStats.lastStartedAt = loopStartTime
    this.loopStats.lastSymbols = 0
    this.loopStats.lastAIRequests = 0
    
    try {
      const instances = Array.from(this.runningStrategies.values())

      if (instances.length === 0) {
        if (this.globalTimer) {
          clearInterval(this.globalTimer)
          this.globalTimer = null
        }
        return
      }

      // 按交易对分组：symbol -> 需要本次扫描的策略列表
      const symbolStrategies = new Map<string, StrategyInstance[]>()

      for (const instance of instances) {
        if (!instance.isRunning) continue
        
        // 检查是否到了该策略的扫描时间
        if (instance.nextScanTime && loopStartTime < instance.nextScanTime) {
          continue
        }

        for (const symbol of instance.strategy.marketData.symbols) {
          if (!symbolStrategies.has(symbol)) {
            symbolStrategies.set(symbol, [])
          }
          symbolStrategies.get(symbol)!.push(instance)
        }
      }

      if (symbolStrategies.size === 0) return
      this.loopStats.lastSymbols = symbolStrategies.size

      // 日志：本轮待处理的 symbols
      logger.info('StrategyEngine', `本轮扫描处理 ${symbolStrategies.size} 个symbols: ${Array.from(symbolStrategies.keys()).join(', ')}`)

      // ★ 关键修复：在遍历交易对之前，先统一更新所有到期策略的 nextScanTime
      // 避免在 symbol 循环中提前更新，导致后续 symbol 被跳过
      const updatedInstances = new Set<StrategyInstance>()
      for (const [, dueInstances] of symbolStrategies) {
        for (const instance of dueInstances) {
          if (!updatedInstances.has(instance)) {
            updatedInstances.add(instance)
            const scanMinutes = instance.strategy.executionConfig.scanInterval
            const scanMs = (scanMinutes && scanMinutes > 0) ? scanMinutes * 60000 : 300000
            instance.nextScanTime = loopStartTime + scanMs
          }
        }
      }

      // 按交易对聚合调度
      const symbolEntries = Array.from(symbolStrategies.entries())
      const symbolBatchSize = Math.max(1, Number(this.config.strategyScheduler?.symbolBatchSize ?? 3))
      const symbolBatchDelayMs = Math.max(0, Number(this.config.strategyScheduler?.symbolBatchDelayMs ?? 5000))
      const maxLoopDurationMs = Math.max(30000, Number(this.config.strategyScheduler?.maxLoopDurationMs ?? 240000))
      this.currentLoopAIRequests = 0

      const processSymbolEntry = async (symbol: string, dueInstances: StrategyInstance[]): Promise<void> => {
        try {
          // 过滤掉已有仓位的策略
          const activeInstances: StrategyInstance[] = []
          for (const instance of dueInstances) {
            if (!(await this.positionManager.hasConflict(symbol, instance.strategy.id))) {
              activeInstances.push(instance)
            }
          }

          if (activeInstances.length === 0) return

          // 构建市场快照（同一交易对只构建一次，复用给所有到期的策略）
          const snapshot = await this.concurrencyPoolManager.getIndicatorPool().submit(async () => {
            return await this.scheduler.buildMarketSnapshot(symbol)
          })

          // 分发给每个到期的策略
          for (const instance of activeInstances) {
            const sid = instance.strategy.id
            instance.lastScanTime = new Date().toISOString()

            await this.analyzeSymbol(instance, symbol, snapshot).catch((error: any) => {
              logger.error('StrategyEngine', `分析交易对失败 ${symbol} [策略${sid}]: ${error.message}`)
            })
          }
        } catch (error: any) {
          logger.error('StrategyEngine', `处理交易对失败 ${symbol}: ${error.message}`)
        }
      }

      for (let symbolIndex = 0; symbolIndex < symbolEntries.length; symbolIndex += symbolBatchSize) {
        if (Date.now() - loopStartTime > maxLoopDurationMs) {
          logger.warn('StrategyEngine', `本轮扫描超过最大耗时，剩余 ${symbolEntries.length - symbolIndex} 个交易对顺延`)
          break
        }
        if (symbolIndex > 0 && symbolIndex % symbolBatchSize === 0 && symbolBatchDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, symbolBatchDelayMs))
        }

        const batch = symbolEntries.slice(symbolIndex, symbolIndex + symbolBatchSize)
        const results = await Promise.allSettled(
          batch.map(([symbol, dueInstances]) => processSymbolEntry(symbol, dueInstances))
        )

        results.forEach((result, batchIndex) => {
          if (result.status === 'rejected') {
            const [symbol] = batch[batchIndex]!
            logger.error('StrategyEngine', `交易对批处理异常 ${symbol}: ${result.reason?.message || result.reason}`)
          }
        })
      }
    } catch (error: any) {
      logger.error('StrategyEngine', `全局策略循环异常: ${error.message}`)
    } finally {
      const finishedAt = Date.now()
      const duration = finishedAt - loopStartTime
      this.isGlobalLoopRunning = false
      this.loopStats.isRunning = false
      this.loopStats.lastFinishedAt = finishedAt
      this.loopStats.lastDurationMs = duration
      this.loopStats.lastAIRequests = this.currentLoopAIRequests
      this.loopStats.skippedLoops = this.skippedLoopCount
      logger.success('StrategyEngine', `第 ${this.loopStats.scanCount} 轮扫描结束，耗时 ${duration}ms，跳过计数 ${this.skippedLoopCount}`)
      if (duration > this.globalScanInterval * 0.8) {
        this.loopStats.exceededDurationCount++
        logger.warn('StrategyEngine', `本轮扫描耗时接近全局间隔: ${duration}ms / ${this.globalScanInterval}ms`)
      }
    }
  }

  // ==================== 市场分析 ====================

  /**
   * 从策略配置中提取EMA周期
   */
  private getEMAPeriodsFromStrategy(strategy: any): number[] {
    const emaConfig = strategy.indicators.find((i: any) => i.type === 'EMA' && i.enabled)
    if (emaConfig?.params?.periods && Array.isArray(emaConfig.params.periods)) {
      const periods = emaConfig.params.periods
        .map((p: any) => Number(p))
        .filter((p: number) => Number.isFinite(p) && p >= 2)
        .map((p: number) => Math.floor(p))

      if (periods.length > 0) {
        return periods
      }
    }
    // 默认值
    return [14]
  }

  /**
   * 从市场快照中提取指标数据
   */
  private extractIndicatorsFromSnapshot(
    snapshot: MarketSnapshot,
    mainTimeframe: Timeframe
  ): Map<string, any> {
    const indicatorsData = new Map<string, any>()

    // 从快照中提取指标
    const timeframeData = snapshot.indicatorsByTimeframe.get(mainTimeframe)
    if (timeframeData) {
      for (const [indicatorType, indicatorValue] of timeframeData.entries()) {
        indicatorsData.set(`${mainTimeframe}_${indicatorType}`, indicatorValue)
      }
    }

    return indicatorsData
  }

  private setPrecomputedIndicator(
    indicatorsData: Map<string, any>,
    precomputed: Map<string, any>,
    key: string | undefined,
    dataKey: string
  ): boolean {
    if (!key) return false
    const data = precomputed.get(key)
    if (!data) return false
    indicatorsData.set(dataKey, data)
    return true
  }

  private async hydrateIndicatorsForStrategy(
    strategy: Strategy,
    symbol: string,
    mainTimeframe: Timeframe,
    indicatorsData: Map<string, any>
  ): Promise<void> {
    const binding = this.indicatorRegistry.getBinding(strategy.id, symbol)
    const precomputed = binding && this.indicatorPrecompute
      ? this.indicatorPrecompute.getMany(Object.values(binding.keys).filter(Boolean) as string[])
      : new Map<string, any>()

    const volumeStatConfig = strategy.statistics.find((s: any) => s.type === 'Volume' && s.enabled)
    const oiStatConfig = strategy.statistics.find((s: any) => s.type === 'OI' && s.enabled)
    const squareHeatStatConfig = strategy.statistics.find((s: any) => s.type === 'SquareHeat' && s.enabled)
    const volumeTimeframe = volumeStatConfig?.timeframes?.[0] || mainTimeframe
    const oiTimeframe = oiStatConfig?.timeframes?.[0] || mainTimeframe

    const missing: string[] = []
    const bindKeys = binding?.keys || {}

    if (strategy.indicators.some((i: any) => i.type === 'EMA' && i.enabled)) {
      if (!this.setPrecomputedIndicator(indicatorsData, precomputed, bindKeys.ema, `${mainTimeframe}_EMA`)) {
        missing.push(bindKeys.ema || `${symbol}:${mainTimeframe}:EMA`)
        try {
          const emaData = await this.indicatorsHub.getEMAByPeriods(symbol, mainTimeframe, this.getEMAPeriodsFromStrategy(strategy))
          indicatorsData.set(`${mainTimeframe}_EMA`, emaData)
        } catch (error: any) {
          logger.warn('StrategyEngine', `获取动态EMA失败 ${symbol} ${mainTimeframe}: ${error.message}`)
        }
      }
    }

    for (const indicator of strategy.indicators.filter((i: any) => i.enabled && i.type !== 'EMA')) {
      const dataKey = `${mainTimeframe}_${indicator.type}`
      const bindingKey = indicator.type === 'RSI' ? bindKeys.rsi
        : indicator.type === 'ADX' ? bindKeys.adx
          : indicator.type === 'MACD' ? bindKeys.macd
            : indicator.type === 'ATR' ? bindKeys.atr
              : undefined
      if (this.setPrecomputedIndicator(indicatorsData, precomputed, bindingKey, dataKey)) continue

      missing.push(bindingKey || `${symbol}:${mainTimeframe}:${indicator.type}`)
      try {
        if (indicator.type === 'RSI') {
          indicatorsData.set(dataKey, await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'RSI', { rsiPeriod: Number(indicator.params?.period ?? 14) }))
        } else if (indicator.type === 'ADX') {
          indicatorsData.set(dataKey, await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'ADX', { adxPeriod: Number(indicator.params?.period ?? 14) }))
        } else if (indicator.type === 'MACD') {
          indicatorsData.set(dataKey, await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'MACD', {
            macdFastPeriod: Number(indicator.params?.fastPeriod ?? 12),
            macdSlowPeriod: Number(indicator.params?.slowPeriod ?? 26),
            macdSignalPeriod: Number(indicator.params?.signalPeriod ?? 9)
          }))
        } else if (indicator.type === 'ATR') {
          indicatorsData.set(dataKey, await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'ATR', { atrPeriod: Number(indicator.params?.period ?? 14) }))
        }
      } catch (error: any) {
        logger.warn('StrategyEngine', `预计算指标缺失且实时计算失败 ${dataKey}: ${error.message}`)
      }
    }

    if (oiStatConfig) {
      const dataKey = `${oiTimeframe}_OI`
      const changePeriod = Number(oiStatConfig.params?.changePeriod ?? 8)
      try {
        // OI 使用每分钟刷新的当前值和内存 5m 序列即时计算，不能复用 5 分钟预计算缓存。
        indicatorsData.set(dataKey, await this.indicatorsHub.getIndicators(symbol, oiTimeframe, 'OI', {
          lookbackMinutes: Math.max(1, changePeriod) * this.timeframeToMinutes(oiTimeframe),
          trendThresholdPercent: Number(oiStatConfig.params?.trendThresholdPercent ?? 0.4)
        }))
      } catch (error: any) {
        logger.warn('StrategyEngine', `获取OI失败 ${symbol} ${oiTimeframe}: ${error.message}`)
        // OI 是该策略启用的预筛和 AI 输入，缺失历史基准时必须跳过本轮分析，不能静默绕过。
        throw error
      }
    }

    if (volumeStatConfig && !this.setPrecomputedIndicator(indicatorsData, precomputed, bindKeys.volume, `${volumeTimeframe}_Volume`)) {
      missing.push(bindKeys.volume || `${symbol}:${volumeTimeframe}:Volume`)
      try {
        indicatorsData.set(`${volumeTimeframe}_Volume`, await this.indicatorsHub.getIndicators(symbol, volumeTimeframe, 'Volume'))
      } catch (error: any) {
        logger.warn('StrategyEngine', `获取Volume失败 ${symbol} ${volumeTimeframe}: ${error.message}`)
      }
    }

    if (squareHeatStatConfig && !this.setPrecomputedIndicator(indicatorsData, precomputed, bindKeys.squareHeat, `SquareHeat_SquareHeat`)) {
      missing.push(bindKeys.squareHeat || `${symbol}:SquareHeat`)
      try {
        // 社区情绪窗口跟随策略最大持仓时间，确保短线策略不会使用过长的滞后窗口
        const maxHoldTimeMinutes = Number(strategy.riskManagement?.maxHoldTimeMinutes ?? 24 * 60)
        indicatorsData.set(`SquareHeat_SquareHeat`, await this.indicatorsHub.getIndicators(symbol, '1h', 'SquareHeat', {
          lookbackMinutes: maxHoldTimeMinutes
        }))
      } catch (error: any) {
        logger.warn('StrategyEngine', `获取SquareHeat失败 ${symbol}: ${error.message}`)
      }
    }

    if (missing.length > 0) {
      logger.warn('StrategyEngine', `预计算指标缺失，已回退实时计算: ${missing.join(', ')}`)
    }
  }

  /**
   * 使用市场快照分析交易对
   */
  private async analyzeSymbol(
    instance: StrategyInstance,
    symbol: string,
    snapshot: MarketSnapshot
  ): Promise<void> {
    const strategy = instance.strategy

    // 1. 检查是否已有仓位（同交易对互斥）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.info('🔍扫描结果', ` ${symbol}，已有仓位`)
      return
    }

    // 2. 确定主周期（使用配置的第一个周期，即最小的周期）
    const mainTimeframe = strategy.marketData.timeframes[0] || '15m'

    // 3. 从快照中提取指标数据
    const indicatorsData = this.extractIndicatorsFromSnapshot(snapshot, mainTimeframe)

    // 4. 优先读取预计算指标，缺失时回退实时计算
    await this.hydrateIndicatorsForStrategy(strategy, symbol, mainTimeframe, indicatorsData)

    // 5. 构建 AI 提示词并调用 AI 分析
    const signal = await this.callAI(
      instance,
      strategy.id,
      symbol,
      strategy.aiPrompt,
      indicatorsData,
      snapshot
    )

    if (!signal) {
      return
    }

    // 6. 验证信号
    if (!this.validateSignal(instance, signal)) {
      return
    }

    // 7. 更新统计
    instance.totalSignals++

    // 8. 再次检查仓位冲突（防止并发问题）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.info('🔍扫描结果', ` ${symbol} 已有仓位 [策略 ${strategy.id}] 信号被忽略 `)
      return
    }

    // 9. 执行交易
    await this.executeSignal(instance, signal, indicatorsData)
  }

  /**
   * 调用 AI 分析（带市场快照）
   */
  private async callAI(
    instance: StrategyInstance,
    strategyId: StrategyId,
    symbol: string,
    promptConfig: AIPromptConfig,
    indicatorsData: Map<string, any>,
    snapshot: MarketSnapshot
  ): Promise<TradeSignal | null> {
    try {
      // 主时间框架取配置的第一个周期（最小的周期）
      const mainTimeframe = instance.strategy.marketData.timeframes[0] || '15m'

      // 正确提取指标数据
      const emaData = indicatorsData.get(`${mainTimeframe}_EMA`)?.values || {}
      const rsiData = indicatorsData.get(`${mainTimeframe}_RSI`)?.values || {}
      const macdData = indicatorsData.get(`${mainTimeframe}_MACD`)?.values || {}

      // 从策略配置中动态获取 Volume 和 OI 的时间周期
      const volumeStatConfig = instance.strategy.statistics.find((s: any) => s.type === 'Volume' && s.enabled)
      const oiStatConfig = instance.strategy.statistics.find((s: any) => s.type === 'OI' && s.enabled)

      const volumeTimeframe = volumeStatConfig?.timeframes?.[0] || '1h'
      const oiTimeframe = oiStatConfig?.timeframes?.[0] || '1h'

      const volumeData = indicatorsData.get(`${volumeTimeframe}_Volume`)?.values || {}

      const rsi = rsiData.rsi || 50
      const volume = volumeData.current || 0

      // 只从主周期获取ADX数据
      const adxData = indicatorsData.get(`${mainTimeframe}_ADX`)?.values || {}

      // 检查策略中哪些指标是启用的
      const enabledEMAs = instance.strategy.indicators.some((i: any) => i.type === 'EMA' && i.enabled)
      const enabledRSI = instance.strategy.indicators.some((i: any) => i.type === 'RSI' && i.enabled)
      const enabledMACD = instance.strategy.indicators.some((i: any) => i.type === 'MACD' && i.enabled)
      const enabledADX = instance.strategy.indicators.some((i: any) => i.type === 'ADX' && i.enabled)
      const enabledATR = instance.strategy.indicators.some((i: any) => i.type === 'ATR' && i.enabled)
      const enabledOI = instance.strategy.statistics.some((s: any) => s.type === 'OI' && s.enabled)
      const enabledVolume = instance.strategy.statistics.some((s: any) => s.type === 'Volume' && s.enabled)
      const enabledSquareHeat = instance.strategy.statistics.some((s: any) => s.type === 'SquareHeat' && s.enabled)

      // 获取K线数据用于价格行为分析
      let lastCandle, prevCandle
      let candleProgress = this.config.defaultCandleProgress ?? 0.1
      const klines = snapshot.klinesByTimeframe.get(mainTimeframe)
      if (klines && klines.length >= 2) {
        lastCandle = klines[klines.length - 1]
        prevCandle = klines[klines.length - 2]
        if (lastCandle && lastCandle.timestamp) {
          candleProgress = this.calculateCandleProgress(lastCandle.timestamp, mainTimeframe)
        }
      }

      // 使用快照中的价格
      const price = snapshot.price
      // 所有交易对复用本轮缓存，同时把快照加入 AI 缓存键，防止复用旧市场背景的结论。
      const marketBreadth = await getMarketBreadth(this.config)

      const cacheKey = this.buildAICacheKey(
        symbol,
        indicatorsData,
        promptConfig,
        (instance.strategy as any).structuredRules,
        {
          price: Number(price.toFixed(8)),
          marketBreadth,
          lastCandle,
          prevCandle,
          candleProgress: Number(candleProgress.toFixed(4))
        }
      )

      const cached = this.aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
        logger.info('StrategyEngine', `使用 AI 缓存结果: ${symbol} [策略 ${strategyId}]`)
        return { ...cached.signal, strategyId }
      }
      if (cached) {
        // 命中已过期条目时立即释放，不能只把它当作缓存未命中继续保留。
        this.aiCache.delete(cacheKey)
      }

      // 从策略配置中读取各指标参数
      const adxConfig = instance.strategy.indicators.find((i: any) => i.type === 'ADX' && i.enabled)
      const adxPeriod = Number(adxConfig?.params?.period ?? 14)
      const rsiConfig = instance.strategy.indicators.find((i: any) => i.type === 'RSI' && i.enabled)
      const rsiPeriod = Number(rsiConfig?.params?.period ?? 14)
      const atrConfig = instance.strategy.indicators.find((i: any) => i.type === 'ATR' && i.enabled)
      const atrPeriod = Number(atrConfig?.params?.period ?? 14)
      const macdConfig = instance.strategy.indicators.find((i: any) => i.type === 'MACD' && i.enabled)
      const macdFastPeriod = Number(macdConfig?.params?.fastPeriod ?? 12)
      const macdSlowPeriod = Number(macdConfig?.params?.slowPeriod ?? 26)
      const macdSignalPeriod = Number(macdConfig?.params?.signalPeriod ?? 9)

      // 获取策略级阈值（每个策略独立配置，无全局兜底）
      const strategyPreScreenConfig = (instance.strategy as any).preScreenConfig
      const strategyMaxRiskLevel = instance.strategy.maxRiskLevel ?? 'MEDIUM'

      // AI预筛（支持策略级覆盖）
      const preScreenResult = aiPreScreener.screen({
        symbol,
        strategyId,
        adx: enabledADX ? adxData.adx : undefined,
        adxSlope: enabledADX ? adxData.adxSlope : undefined,
        adxPeriod: enabledADX ? adxPeriod : undefined,
        adxTimeframe: enabledADX ? mainTimeframe : undefined,
        atr: enabledATR ? indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr : undefined,
        currentPrice: price,
        oiChangePercent: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.changePercent : undefined,
        currentVolume: volumeData.current,
        prevVolume: volumeData.prev,
        volumeAverage: volumeData.average,
        candleProgress
      }, strategyPreScreenConfig)

      if (!preScreenResult.passed) {
        return null
      }

      const indicators: any = {
        emaList: enabledEMAs && Array.isArray(emaData.emaList) ? emaData.emaList : [],
        emaMap: enabledEMAs ? (emaData.emaMap || {}) : {},
        rsi: enabledRSI ? rsiData.rsi : undefined,
        macd: enabledMACD && macdData.macd !== undefined ? {
          macd: macdData.macd,
          signal: macdData.signal,
          histogram: macdData.histogram,
          previousMacd: macdData.previousMacd ?? macdData.macd,
          previousSignal: macdData.previousSignal ?? macdData.signal,
          previousHistogram: macdData.previousHistogram ?? macdData.histogram,
          crossover: macdData.crossover ?? 'none',
          histogramTrend: macdData.histogramTrend ?? 'flat'
        } : undefined,
        adx: enabledADX ? adxData.adx : undefined,
        adxSlope: enabledADX ? adxData.adxSlope : undefined,
        atr: enabledATR ? indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr : undefined,
        // DI 与 ADX 使用同一策略周期和参数，仅在启用 ADX 时传入 AI。
        pdi: enabledADX ? adxData.pdi : undefined,
        mdi: enabledADX ? adxData.mdi : undefined,
        previousPdi: enabledADX ? adxData.previousPdi : undefined,
        previousMdi: enabledADX ? adxData.previousMdi : undefined,
        diSpread: enabledADX ? adxData.diSpread : undefined,
        diGapChange: enabledADX ? adxData.diGapChange : undefined,
        openInterest: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.value : undefined,
        openInterestChangePercent: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.changePercent : undefined,
        openInterestTrend: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.trend : undefined,
        squareHeat: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.heat : undefined,
        squareHeatPostCount: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.postCount : undefined,
        squareHeatTrend: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.trend : undefined,
        squareHeatChangePercent: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.changePercent : undefined,
        squareHeatHistoryAvg: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.historyAvg : undefined,
        squareHeatBullishCount: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.bullishCount : undefined,
        squareHeatBearishCount: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.bearishCount : undefined,
        squareHeatNeutralCount: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.neutralCount : undefined,
        squareHeatDirectionalCoveragePercent: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.directionalCoveragePercent : undefined,
        squareHeatNetDirectionalSentimentPercent: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.netDirectionalSentimentPercent : undefined,
        squareHeatDataUpdatedAt: enabledSquareHeat ? indicatorsData.get(`SquareHeat_SquareHeat`)?.values?.dataUpdatedAt : undefined,
        // 将实际情绪统计窗口传给 AI，避免把策略周期误写成固定 24H
        squareHeatWindowMinutes: enabledSquareHeat
          ? Number(instance.strategy.riskManagement?.maxHoldTimeMinutes ?? 24 * 60)
          : undefined,
        adxPeriodLabel: mainTimeframe,
        marketBreadth,
        enabledIndicators: {
          ema: enabledEMAs,
          rsi: enabledRSI,
          macd: enabledMACD,
          adx: enabledADX,
          atr: enabledATR,
          oi: enabledOI,
          volume: enabledVolume,
          squareHeat: enabledSquareHeat
        },
        volumeCurrent: enabledVolume ? volumeData.current : undefined,
        volumePrev: enabledVolume ? volumeData.prev : undefined,
        volumeAverage: enabledVolume ? volumeData.average : undefined,
        volumeEmaAverage: enabledVolume ? volumeData.emaAverage : undefined,
        volumeEmaPeriod: enabledVolume ? volumeData.emaPeriod : undefined,
        lastCandle,
        prevCandle
      }

      // 调用 AI 分析器（内部已有并发池控制，此处不再重复包装）
      const maxRequestsPerScan = Math.max(1, Number(this.config.aiRateLimit?.maxRequestsPerScan ?? 40))
      if (this.currentLoopAIRequests >= maxRequestsPerScan) {
        logger.warn('StrategyEngine', `AI request budget exhausted for this scan, skip ${symbol} [strategy ${strategyId}]`)
        return null
      }
      this.currentLoopAIRequests++

      const signal = await this.aiAnalyzer.analyze(
        strategyId,
        symbol,
        promptConfig,
        indicators,
        price,
        volume,
        candleProgress
      )

      if (!signal) {
        return null
      }

      // 统一记录扫描结果日志
      const strategyInstance = this.runningStrategies.get(strategyId)
      const strategyName = strategyInstance ? strategyInstance.strategy.name : '未知策略'

      let enhancedLog = signal.reasoning
      const finalScore = signal.scoreBreakdown?.finalScore
      // 通知直接读取扫描时的评分和置信度，避免不同检查分支的摘要格式导致字段丢失。
      const scanContext = {
        symbol: signal.symbol,
        strategyId: signal.strategyId,
        // 保存扫描当时的主周期，避免策略配置变更后点击通知定位到错误周期。
        mainTimeframe,
        direction: signal.direction,
        score: finalScore,
        confidence: signal.confidence
      }
      const thresholdState = this.evaluateEntryThreshold(instance, signal)
      const thresholdValue = thresholdState.displayValue
      const threshold = thresholdState.displayThreshold
      const isThresholdOK = thresholdState.passed

      const maxRiskLevel = strategyMaxRiskLevel
      let isRiskLevelOK = true
      if (maxRiskLevel !== undefined && signal.riskLevel !== undefined) {
        const riskLevelOrder: Record<string, number> = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 }
        const signalLevel = riskLevelOrder[signal.riskLevel] ?? 2
        const maxLevel = riskLevelOrder[maxRiskLevel] ?? 0
        isRiskLevelOK = signalLevel <= maxLevel
      }

      if (signal.direction === 'idle') {
        logger.info('🔍扫描结果', `${signal.symbol} @${signal.price} IDLE ${thresholdState.label}（${thresholdValue}，阈值 ${threshold}）置信度（${signal.confidence}）评分（${finalScore}） [${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`, scanContext)
        return null
      } else if (!isThresholdOK) {
        logger.info('🔍扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} ${thresholdState.label}（${thresholdValue} < ${threshold}）置信度（${signal.confidence}）评分（${finalScore}）[${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`, scanContext)
        return null
      } else if (!isRiskLevelOK) {
        logger.info('🔍扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} ${thresholdState.label}（${thresholdValue} >= ${threshold}）置信度（${signal.confidence}）评分（${finalScore}）风险等级（${signal.riskLevel} > ${maxRiskLevel}）[${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`, scanContext)
        return null
      } else {
        logger.success('🔍扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} ${thresholdState.label}（${thresholdValue} >= ${threshold}）置信度（${signal.confidence}）评分（${finalScore}）风险等级（${signal.riskLevel} <= ${maxRiskLevel}）[${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`, scanContext)
      }

      // 信号中的止损价用于缓存和后续扩展展示，必须与正式下单使用同一套策略 ATR 口径。
      signal.stopLoss = this.calculateConfiguredStopLoss(signal, instance.strategy)

      // 缓存结果
      this.aiCache.set(cacheKey, { signal, timestamp: Date.now() })
      this.aiCacheWritesSinceCleanup++
      if (this.aiCacheWritesSinceCleanup >= 100 || this.aiCache.size > this.AI_CACHE_MAX_ENTRIES) {
        this.pruneAICache()
      }

      return signal
    } catch (error: any) {
      logger.error('StrategyEngine', `AI 分析失败 ${symbol}: ${error.message}`)
      return null
    }
  }

  /**
   * 构建 AI 缓存键
   */
  private buildAICacheKey(
    symbol: string,
    indicatorsData: Map<string, any>,
    promptConfig: AIPromptConfig,
    structuredRules?: unknown,
    marketContext?: unknown
  ): string {
    const cachePayload = {
      symbol,
      indicatorsData,
      marketContext,
      userPrompt: promptConfig.userPrompt,
      provider: promptConfig.provider,
      model: promptConfig.model,
      thinkingEnabled: promptConfig.thinkingEnabled,
      temperature: promptConfig.temperature,
      structuredRules
    }
    return `ai:${symbol}:${shortHash(cachePayload)}`
  }

  /**
   * 清理过期 AI 缓存，并按插入顺序淘汰超过容量上限的最旧结果。
   */
  private pruneAICache(): void {
    const expiresBefore = Date.now() - this.getAiCacheTtl()
    for (const [key, value] of this.aiCache) {
      if (value.timestamp < expiresBefore) {
        this.aiCache.delete(key)
      }
    }

    while (this.aiCache.size > this.AI_CACHE_MAX_ENTRIES) {
      const oldestKey = this.aiCache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.aiCache.delete(oldestKey)
    }
    this.aiCacheWritesSinceCleanup = 0
  }

  /**
   * 按策略风险配置计算止损价
   *
   * ATR 缺失时沿用现有兼容规则，以价格的 1% 作为 ATR，确保信号缓存与正式下单口径一致。
   */
  private calculateConfiguredStopLoss(signal: TradeSignal, strategy: Strategy): number {
    return calculateStopLoss(
      signal.price,
      signal.direction.toUpperCase() as 'LONG' | 'SHORT',
      signal.indicators.atr || (signal.price * 0.01),
      strategy.riskManagement.stopLossATRMultiplier
    )
  }

  /**
   * 验证信号
   */
  private validateSignal(instance: StrategyInstance, signal: TradeSignal): boolean {
    // 检查必填字段
    if (!signal.strategyId || !signal.symbol || !signal.direction || !signal.action) {
      logger.info('StrategyEngine', `[缺失字段] 策略ID=${signal.strategyId || '未知'} 交易对=${signal.symbol || '未知'} 方向=${signal.direction || '未知'} 操作=${signal.action || '未知'}`);
      return false
    }

    // 根据策略模式统一判断阈值；both 模式要求两个指标同时达标。
    if (!this.evaluateEntryThreshold(instance, signal).passed) {
      return false
    }

    // 与 AI 返回路径保持一致，缓存信号也必须遵守策略风险上限。
    const maxRiskLevel = instance.strategy.maxRiskLevel ?? 'MEDIUM'
    if (maxRiskLevel !== undefined && signal.riskLevel !== undefined) {
      // 风险等级优先级：LOW < MEDIUM < HIGH
      const riskLevelOrder: Record<string, number> = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 }
      const signalLevel = riskLevelOrder[signal.riskLevel] ?? 2
      const maxLevel = riskLevelOrder[maxRiskLevel] ?? 0
      if (signalLevel > maxLevel) {
        return false
      }
    }

    return true
  }

  /**
   * 统一评估策略开仓阈值，避免扫描、校验和杠杆计算出现不同口径。
   */
  private evaluateEntryThreshold(instance: StrategyInstance, signal: TradeSignal): {
    passed: boolean
    label: string
    displayValue: string
    displayThreshold: string
    confidence: number | undefined
    finalScore: number | undefined
    confidenceThreshold: number
    finalScoreThreshold: number
  } {
    const mode = instance.strategy.entryThresholdMode ?? 'confidence'
    const confidenceThreshold = instance.strategy.minConfidence ?? 50
    const finalScoreThreshold = instance.strategy.minFinalScore ?? 0
    const confidence = signal.confidence
    const finalScore = signal.scoreBreakdown?.finalScore
    const confidencePassed = typeof confidence === 'number' && confidence >= confidenceThreshold
    const finalScorePassed = typeof finalScore === 'number' && finalScore >= finalScoreThreshold

    if (mode === 'both') {
      return {
        passed: confidencePassed && finalScorePassed,
        label: 'confidence+finalScore',
        displayValue: `置信度 ${confidence ?? '缺失'} / 评分 ${finalScore ?? '缺失'}`,
        displayThreshold: `${confidenceThreshold} / ${finalScoreThreshold}`,
        confidence,
        finalScore,
        confidenceThreshold,
        finalScoreThreshold
      }
    }

    if (mode === 'finalScore') {
      return {
        passed: finalScorePassed,
        label: 'finalScore',
        displayValue: `${finalScore ?? '缺失'}`,
        displayThreshold: `${finalScoreThreshold}`,
        confidence,
        finalScore,
        confidenceThreshold,
        finalScoreThreshold
      }
    }

    return {
      passed: confidencePassed,
      label: 'confidence',
      displayValue: `${confidence ?? '缺失'}`,
      displayThreshold: `${confidenceThreshold}`,
      confidence,
      finalScore,
      confidenceThreshold,
      finalScoreThreshold
    }
  }

  // ==================== 信号执行 ====================

  /**
   * 执行交易信号
   */
  public async executeSignal(instance: StrategyInstance, signal: TradeSignal, indicatorsData: Map<string, any>): Promise<void> {
    let symbolLocked = false
    let positionRecorded = false
    // 市价单成交后，即使后续止损失败，也必须尝试反向平仓，避免遗留无保护仓位。
    let openedOrder: { orderId: string } | null = null
    let openedQuantity = 0
    let dailyTradeReservationId: string | undefined
    let dailyTradeReservationCommitted = false
    try {
      const strategy = instance.strategy

      logger.info('开仓信号', `执行信号: ${signal.symbol} ${signal.direction} (${signal.reasoning})`)

      // 必须在任何下单操作前原子预占名额，防止同一轮并发信号突破每日上限。
      const dailyTradeReservation = await this.dailyTradeLimiter.reserve(
        strategy.id,
        strategy.riskManagement.maxDailyTrades
      )
      if (!dailyTradeReservation.allowed || !dailyTradeReservation.reservationId) {
        logger.warn(
          '每日开仓限制',
          `${strategy.name} 今日已开仓 ${dailyTradeReservation.openedCount} 笔` +
          `${dailyTradeReservation.reservedCount > 0 ? `，另有 ${dailyTradeReservation.reservedCount} 笔正在开仓` : ''}` +
          `，达到上限 ${dailyTradeReservation.limit} 笔，今日禁止继续开仓`
        )
        return
      }
      dailyTradeReservationId = dailyTradeReservation.reservationId

      // 1. 获取账户余额
      const account = await this.binance.fetchBalance()
      logger.info('账户', `余额: ${account.availableBalance} USDT`)

      // 余额检查
      if (account.availableBalance < 30) {
        logger.warn('开仓', `账户余额（${account.availableBalance} USDT）不足30 USDT，无法开仓`)
        return
      }

      // 余额检查通过后再锁定交易对，避免“未开仓先锁仓”
      this.positionManager.lockSymbol(signal.symbol, strategy.id)
      symbolLocked = true

      // 2. 计算止损价格
      const stopLoss = this.calculateConfiguredStopLoss(signal, strategy)

      // 3. 计算杠杆
      let finalLeverage: number
      let leverageCalculationDetails: Record<string, any> = {}

      if (typeof strategy.executionConfig.leverage === 'number') {
        // 固定杠杆
        finalLeverage = strategy.executionConfig.leverage
        leverageCalculationDetails = { mode: 'fixed', leverage: finalLeverage }
      } else {
        // 动态杠杆：基于所选开仓指标超出阈值的超额部分，线性映射到整数杠杆
        const minLev = Math.max(1, strategy.executionConfig.dynamicLeverageMin ?? 5)
        const maxLev = Math.min(125, strategy.executionConfig.dynamicLeverageMax ?? 10)
        const clampedMinLev = Math.min(minLev, maxLev)
        const clampedMaxLev = maxLev

        const thresholdState = this.evaluateEntryThreshold(instance, signal)
        const thresholdMode = instance.strategy.entryThresholdMode ?? 'confidence'
        const minThreshold = thresholdMode === 'finalScore'
          ? thresholdState.finalScoreThreshold
          : thresholdState.confidenceThreshold
        const thresholdValue = thresholdMode === 'finalScore'
          ? (thresholdState.finalScore ?? minThreshold)
          : (thresholdState.confidence ?? minThreshold)

        // both 模式取两个指标超额比例的中位数；两个数的中位数等于其平均值。
        const normalizedExcess = (value: number | undefined, threshold: number) =>
          typeof value === 'number' && threshold < 100
            ? Math.max(0, (value - threshold) / (100 - threshold))
            : 0
        const thresholdExcess = thresholdMode === 'both'
          ? (
              normalizedExcess(thresholdState.confidence, thresholdState.confidenceThreshold) +
              normalizedExcess(thresholdState.finalScore, thresholdState.finalScoreThreshold)
            ) / 2
          : normalizedExcess(thresholdValue, minThreshold)

        // 线性映射到 [minLev, maxLev]，取整数
        finalLeverage = Math.round(clampedMinLev + (clampedMaxLev - clampedMinLev) * thresholdExcess)

        leverageCalculationDetails = {
          mode: 'dynamic',
          minLeverage: clampedMinLev,
          maxLeverage: clampedMaxLev,
          thresholdMode,
          threshold: thresholdMode === 'both'
            ? { confidence: thresholdState.confidenceThreshold, finalScore: thresholdState.finalScoreThreshold }
            : minThreshold,
          thresholdValue: thresholdMode === 'both'
            ? { confidence: thresholdState.confidence, finalScore: thresholdState.finalScore }
            : thresholdValue,
          thresholdExcess: (thresholdExcess * 100).toFixed(0) + '%',
          finalLeverage
        }
      }

      logger.info('杠杆', `使用杠杆: ${finalLeverage} X`, leverageCalculationDetails)

      // 4. 设置杠杆和保证金模式
      await this.binance.setLeverage(signal.symbol, finalLeverage)
      await this.binance.setMarginMode(signal.symbol, 'cross')

      // 5. 计算仓位大小
      const riskAmount = calculatePositionSize(
        account.availableBalance,
        signal.price,
        stopLoss,
        strategy.riskManagement.maxRiskPercentage
      )

      const maxUsdtAmount = calculateMaxUsdtAmount(
        account.availableBalance,
        finalLeverage,
        strategy.riskManagement.maxRiskPercentage
      )

      const usdtAmount = Math.min(riskAmount, maxUsdtAmount)

      // 检查最小名义价值
      const minQuantity = 20 / signal.price
      const estimatedQuantity = usdtAmount / signal.price
      
      let quantity: number
      let finalUsdtAmount: number
      
      if (estimatedQuantity < minQuantity) {
        logger.warn('风控', `预估数量${estimatedQuantity.toFixed(4)}小于最小名义价值要求，调整到最小数量`)
        finalUsdtAmount = Math.min(minQuantity * signal.price, maxUsdtAmount)
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        const notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
        }
      } else {
        finalUsdtAmount = usdtAmount
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        const notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
        }
      }

      logger.info('开仓', `仓位参数`, {
        数量: quantity,
        杠杆: finalLeverage,
        入场价: signal.price,
        止损价: stopLoss,
        USDT金额: finalUsdtAmount,
        ...leverageCalculationDetails,
      })

      // 6. 市价开仓
      const side = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', true)
      const order = await this.binance.marketOrder(signal.symbol, side, quantity)
      openedOrder = order
      // 订单已被交易所接受，先记录下单数量；即使后续查询持仓超时，也要尝试保护性平仓。
      openedQuantity = quantity

      logger.success('开仓', `开仓订单已提交`, order)

      // 7. 确认持仓建立
      const realPosition = await waitAndConfirmPosition(this.binance, signal.symbol, 3, 500)
      
      if (!realPosition) {
        throw new Error('开仓后未检测到实际持仓')
      }

      const actualQuantity = realPosition.quantity
      openedQuantity = actualQuantity
      logger.info('持仓确认', `实际成交数量: ${actualQuantity} (下单数量: ${quantity})`)

      // 交易所已确认真实持仓，此时即计为一次开仓；后续止损单设置失败也不能退还次数。
      const confirmedOpenTime = Date.now()
      await this.dailyTradeLimiter.commit(dailyTradeReservationId, {
        strategyId: strategy.id,
        symbol: signal.symbol,
        openedAt: confirmedOpenTime,
        entryOrderId: order.orderId
      })
      dailyTradeReservationCommitted = true

      // 开仓完成后立即读取币安成交明细。查询失败时不能中断已建立的仓位，只能标记为估算数据等待平仓时继续兼容处理。
      let entryExecution: OrderExecutionSummary | null = null
      try {
        entryExecution = await this.binance.waitForOrderExecutionSummary(
          signal.symbol,
          order.orderId
        )
      } catch (error: any) {
        logger.warn('开仓对账', `读取币安成交明细失败，暂用估算手续费: ${error.message}`)
      }

      const actualEntryPrice = entryExecution?.averagePrice || realPosition.entryPrice || order.average || signal.price

      // 滑点可能使原止损价落到入场价错误的一侧，币安会以 -2021 拒单；此时禁止继续下单。
      const isLong = signal.direction === 'long'
      const stopDirectionValid = isLong ? stopLoss < actualEntryPrice : stopLoss > actualEntryPrice
      if (!stopDirectionValid) {
        throw new Error(`止损价方向无效: ${stopLoss}，实际入场价 ${actualEntryPrice}`)
      }

      // 止盈必须以实际成交均价为基准；市价单可能产生滑点，继续使用 signal.price
      // 会让空单止盈落在实际入场价上方（或多单下方）。
      const takeProfit1 = calculateTakeProfit(actualEntryPrice, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[0])
      const takeProfit2 = calculateTakeProfit(actualEntryPrice, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[1])
      
      // 9. 收集入场指标（根据策略启用的指标）
      const entryIndicators: Record<string, number> = {}
      
      // 从 indicatorsData 中收集指标
      const mainTimeframe = strategy.marketData.timeframes[0] || '5m'
      const emaData = indicatorsData.get(`${mainTimeframe}_EMA`)?.values || {}
      const rsiData = indicatorsData.get(`${mainTimeframe}_RSI`)?.values || {}
      const macdData = indicatorsData.get(`${mainTimeframe}_MACD`)?.values || {}
      const adxData = indicatorsData.get(`${mainTimeframe}_ADX`)?.values || {}
      const atrData = indicatorsData.get(`${mainTimeframe}_ATR`)?.values || {}
      
      // 收集 EMA
      if (emaData.emaMap) {
        Object.entries(emaData.emaMap).forEach(([period, value]) => {
          // emaMap 的 key 在不同计算路径中可能是 "14" 或 "EMA14"，统一避免重复前缀。
          const indicatorKey = /^EMA/i.test(period) ? period : `EMA${period}`
          entryIndicators[indicatorKey] = Number(value)
        })
      }
      
      // 收集其他指标
      if (rsiData.rsi !== undefined) entryIndicators['RSI'] = rsiData.rsi
      if (macdData.macd !== undefined) {
        entryIndicators['MACD'] = macdData.macd
        entryIndicators['MACDSignal'] = macdData.signal
        entryIndicators['MACDHistogram'] = macdData.histogram
        entryIndicators['PreviousMACD'] = macdData.previousMacd ?? macdData.macd
        entryIndicators['PreviousMACDSignal'] = macdData.previousSignal ?? macdData.signal
        entryIndicators['PreviousMACDHistogram'] = macdData.previousHistogram ?? macdData.histogram
      }
      if (adxData.adx !== undefined) entryIndicators['ADX'] = adxData.adx
      // 保存入场时的 DMI 方向和 ADX 强度变化，供历史订单复核趋势条件。
      if (adxData.pdi !== undefined) entryIndicators['PDI'] = adxData.pdi
      if (adxData.mdi !== undefined) entryIndicators['MDI'] = adxData.mdi
      if (adxData.adxSlope !== undefined) entryIndicators['ADXSlope'] = adxData.adxSlope
      if (atrData.atr !== undefined) entryIndicators['ATR'] = atrData.atr
      if (signal.indicators?.atrVolatilityPercent !== undefined) {
        entryIndicators['ATRVolatilityPercent'] = signal.indicators.atrVolatilityPercent
      }
      
      // 收集 OI 和 Volume
      const oiStatConfig = strategy.statistics.find((s: any) => s.type === 'OI' && s.enabled)
      const volumeStatConfig = strategy.statistics.find((s: any) => s.type === 'Volume' && s.enabled)
      
      if (oiStatConfig) {
        const oiIndicators = signal.indicators?.oi
        if (oiIndicators?.value !== undefined) entryIndicators['OI'] = oiIndicators.value
        if (oiIndicators?.changePercent !== undefined) entryIndicators['OIChangePercent'] = oiIndicators.changePercent
      }
      
      if (volumeStatConfig) {
        const volumeIndicators = signal.indicators?.volume
        if (volumeIndicators?.estimatedVolume !== undefined) {
          entryIndicators['EstimatedVolume'] = volumeIndicators.estimatedVolume
        }
        if (volumeIndicators?.emaAverage !== undefined) {
          entryIndicators['VolumeEmaAverage'] = volumeIndicators.emaAverage
        }
        if (volumeIndicators?.estimatedEmaRatioPercent !== undefined) {
          entryIndicators['EstimatedVolumeEmaRatioPercent'] = volumeIndicators.estimatedEmaRatioPercent
        }
      }

      // 社区情绪使用 AI 实际分析时的快照，避免开仓阶段重新请求导致数据口径变化。
      const entryCommunitySentiment = signal.indicators?.communitySentiment

      // 9. 设置止损单
      const stopSide = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', false)
      const stopOrder = await this.binance.stopLossOrder(signal.symbol, stopSide, actualQuantity, stopLoss)

      logger.success('止损', `止损单已设置`, stopOrder)

      // 计算开仓手续费
      const positionValue = Math.abs(actualQuantity) * actualEntryPrice
      const entryCommission = entryExecution?.commissionInUsdt
        ?? positionValue * (this.config.commissionRate ?? 0.0005)
      const entryCommissionAsset = entryExecution?.commissions.length === 1
        ? entryExecution.commissions[0]?.asset || 'USDT'
        : entryExecution?.commissions.length ? 'MULTI' : 'USDT'
      const entryCommissionRaw = entryExecution?.commissions.length === 1
        ? entryExecution.commissions[0]?.amount ?? entryCommission
        : entryCommission
      const entryDataSource: 'binance' | 'estimated' = entryExecution ? 'binance' : 'estimated'

      logger.info('开仓', `开仓手续费: ${entryCommission.toFixed(7)} USDT`, {
        positionValue: positionValue.toFixed(6),
        source: entryExecution ? 'binance' : 'estimated',
        commissionAsset: entryCommissionAsset
      })

      // 10. 记录仓位到PositionManager
      const position = {
        accountId: 'default',
        symbol: signal.symbol,
        strategyId: strategy.id,
        direction: signal.direction,
        entryPrice: actualEntryPrice,
        quantity: actualQuantity,
        leverage: finalLeverage,
        mainTimeframe,
        stopLoss,
        initialStopLoss: stopLoss,
        takeProfit1,
        takeProfit2,
        openTime: confirmedOpenTime,
        highestPrice: signal.price,
        lowestPrice: signal.price,
        orderId: order.orderId,
        stopLossOrderId: stopOrder.orderId,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        entryCommission,
        entryCommissionAsset,
        entryCommissionRaw,
        entryOrderId: order.orderId,
        entryDataSource,
        scoreBreakdown: signal.scoreBreakdown,
        riskLevel: signal.riskLevel,
        entryIndicators,
        // 固化 AI 决策时的 K 线进度，不能在平仓时用另一根 K 线重新计算。
        candleProgressPercent: signal.indicators.candleProgressPercent,
        entryCommunitySentiment,
        maxFloatingProfit: 0,
        maxFloatingProfitPercent: 0,
        maxFloatingLoss: 0,
        maxFloatingLossPercent: 0,
        position: {
          symbol: signal.symbol,
          direction: signal.direction.toUpperCase() as 'LONG' | 'SHORT',
          entryPrice: actualEntryPrice,
          quantity: actualQuantity,
          leverage: finalLeverage,
          stopLoss,
          initialStopLoss: stopLoss,
          takeProfit1,
          takeProfit2,
          openTime: confirmedOpenTime,
          highestPrice: signal.price,
          lowestPrice: signal.price,
          orderId: order.orderId,
          stopLossOrderId: stopOrder.orderId,
          entryCommission,
          entryCommissionAsset,
          entryCommissionRaw,
          entryOrderId: order.orderId,
          entryDataSource
        }
      }

      this.positionManager.recordPosition(signal.symbol, position)
      positionRecorded = true

      instance.lastSignalTime = new Date().toISOString()
      instance.totalTrades++

      logger.success('开仓信号', `信号执行完成: ${signal.symbol}`)
    } catch (error: any) {
      logger.error('开仓信号', `信号执行失败 ${signal.symbol}: ${error.message}`)

      // 市价开仓已成交但止损/记录流程失败时，优先反向平仓，防止留下裸仓。
      if (openedOrder && openedQuantity > 0 && !positionRecorded) {
        try {
          const closeSide = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', false)
          const closeOrder = await this.binance.marketOrder(signal.symbol, closeSide, openedQuantity)
          logger.warn('开仓保护', `止损设置失败，已执行反向平仓: ${signal.symbol}`, {
            entryOrderId: openedOrder.orderId,
            closeOrderId: closeOrder.orderId,
            quantity: openedQuantity
          })
        } catch (closeError: any) {
          logger.error('开仓保护', `止损设置失败且反向平仓失败，币安可能遗留裸仓: ${signal.symbol}: ${closeError.message}`)
        }
      }

      instance.error = error.message
      throw error
    } finally {
      if (dailyTradeReservationId && !dailyTradeReservationCommitted) {
        await this.dailyTradeLimiter.release(dailyTradeReservationId)
      }
      // 兜底：只要未成功记录仓位，就释放锁，防止残留锁
      if (symbolLocked && !positionRecorded) {
        this.positionManager.unlockSymbol(signal.symbol)
      }
    }
  }

  // ==================== 状态查询 ====================

  /**
   * 获取策略运行时状态
   */
  getStrategyRuntimeStatus(strategyId: StrategyId): StrategyRuntimeStatus | null {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      return null
    }

    return {
      isRunning: instance.isRunning,
      lastScanTime: instance.lastScanTime,
      lastSignalTime: instance.lastSignalTime,
      totalSignals: instance.totalSignals,
      totalTrades: instance.totalTrades,
      winRate: instance.totalTrades > 0 ? (instance.winTrades / instance.totalTrades * 100) : 0,
      currentPositions: this.positionManager.getStrategyPositionCount(strategyId),
      error: instance.error
    }
  }

  /**
   * 获取所有运行中的策略
   */
  getRunningStrategies(): StrategyId[] {
    return Array.from(this.runningStrategies.keys())
  }

  /**
   * 检查策略是否在运行
   */
  isStrategyRunning(strategyId: StrategyId): boolean {
    return this.runningStrategies.has(strategyId)
  }

  getLoopStats() {
    return { ...this.loopStats }
  }

  // ==================== 测试接口 ====================

  /**
   * 测试策略信号（手动触发一次分析）
   */
  async analyzeSymbolForTest(strategyId: StrategyId, symbol: string): Promise<any> {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      throw new Error(`策略未运行: ${strategyId}`)
    }

    logger.info('手动开仓', `手动触发分析: ${symbol}`)

    // 构建市场快照
    const snapshot = await this.concurrencyPoolManager.getIndicatorPool().submit(async () => {
      return await this.scheduler.buildMarketSnapshot(symbol)
    })

    await this.analyzeSymbol(instance, symbol, snapshot)

    return {
      message: `分析完成: ${symbol}`,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * 强制开仓 - 构造 TradeSignal 并直接执行
   * 将置信度和 finalScore 设为 100 以绕过所有风控阈值
   */
  async forceOpenPosition(strategyId: StrategyId, symbol: string, direction: 'long' | 'short'): Promise<any> {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      throw new Error(`策略未运行: ${strategyId}`)
    }

    logger.info('强制开仓', `手动开仓: ${symbol} ${direction} [策略: ${strategyId}]`)

    // 1. 检查仓位冲突
    if (await this.positionManager.hasConflict(symbol, strategyId)) {
      throw new Error(`${symbol} 已有仓位，无法开仓`)
    }

    // 2. 构建市场快照获取当前价格
    const snapshot = await this.concurrencyPoolManager.getIndicatorPool().submit(async () => {
      return await this.scheduler.buildMarketSnapshot(symbol)
    })

    const price = snapshot.price
    if (!price || price <= 0) {
      throw new Error(`${symbol} 无法获取当前价格`)
    }

    // 3. 从快照中提取指标数据（用于 executeSignal 内部计算止盈止损）
    const mainTimeframe = instance.strategy.marketData.timeframes[0] || '15m'
    const indicatorsData = this.extractIndicatorsFromSnapshot(snapshot, mainTimeframe)
    
    // 提取 ATR 数据供 executeSignal 计算止损
    const atrData = indicatorsData.get(`${mainTimeframe}_ATR`)
    const atrValue = atrData?.value || atrData?.atr || price * 0.01

    // 4. 构建 TradeSignal（止盈止损由 executeSignal 根据策略 riskManagement 配置自动计算）
    const signal: TradeSignal = {
      strategyId,
      symbol,
      direction,
      action: 'open',
      price,
      stopLoss: 0, // 由 executeSignal 根据策略配置重新计算
      takeProfit: [], // 由 executeSignal 根据策略配置重新计算
      confidence: 100,
      reasoning: `手动强制开仓 - ${symbol} ${direction}`,
      indicators: { atr: atrValue },
      timestamp: new Date().toISOString(),
      scoreBreakdown: {
        baseScore: 30,
        hardScore: 50,
        softScore: 20,
        penaltyScore: 0,
        finalScore: 100
      },
      riskLevel: 'LOW'
    }

    // 5. 调用 executeSignal 执行开仓（内部会用策略的 riskManagement 计算止盈止损）

    await this.executeSignal(instance, signal, indicatorsData)

    return {
      success: true,
      message: `强制开仓成功: ${symbol} ${direction}`,
      price,
      timestamp: new Date().toISOString()
    }
  }

  // ==================== 清理 ====================

  /**
   * 停止所有策略
   */
  async stopAll(): Promise<void> {
    logger.info('StrategyEngine', '停止所有策略...')

    const strategyIds = Array.from(this.runningStrategies.keys())
    for (const strategyId of strategyIds) {
      await this.stopStrategy(strategyId)
    }

    // 清理 AI 缓存
    this.aiCache.clear()

    // 停止持仓监控
    this.positionMonitor.stop()

    logger.success('StrategyEngine', '所有策略已停止')
  }

  /**
   * 清理AI缓存
   */
  clearAICache(): void {
    this.aiCache.clear()
    this.aiCacheWritesSinceCleanup = 0
    logger.info('StrategyEngine', 'AI缓存已清理')
  }

  /**
   * 销毁引擎
   */
  getAIAnalyzerStatus(): any {
    return this.aiAnalyzer.getStatus()
  }

  getIndicatorPrecomputeStatus(): any {
    return this.indicatorPrecompute?.getStatus() || null
  }

  async destroy(): Promise<void> {
    this.clearImmediateRunTimer()
    await this.stopAll()
    this.runningStrategies.clear()
    logger.info('StrategyEngine', '引擎已销毁')
  }

  /**
   * 获取平仓模块
   */
  getPositionCloser(): StrategyPositionCloser {
    return this.positionCloser
  }

  /**
   * 获取持仓监控模块
   */
  getPositionMonitor(): StrategyPositionMonitor {
    return this.positionMonitor
  }
}
