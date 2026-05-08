// ==================== 策略执行引擎 ====================

import type { Strategy, StrategyId, Timeframe, AIPromptConfig } from '../../../types/strategy'
import type { TradeSignal } from '../../../types/signal'
import type { BotConfig } from '../../../types'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
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


  constructor(
    store: StrategyStore,
    indicatorsHub: IndicatorsHub,
    positionManager: PositionManager,
    binance: BinanceService,
    config: BotConfig,
    state: BotState
  ) {
    this.store = store
    this.indicatorsHub = indicatorsHub
    this.positionManager = positionManager
    this.binance = binance
    this.state = state
    this.config = config
    
    // 初始化AI预筛配置
    aiPreScreener.initFromBotConfig(config.preScreenConfig)

    // 初始化AI分析器
    this.aiAnalyzer = new MultiStrategyAIAnalyzer(binance, config)

    // 初始化持仓相关模块
    this.positionCloser = new StrategyPositionCloser(binance, positionManager, config, state)
    this.positionMonitor = new StrategyPositionMonitor(binance, positionManager, this.positionCloser, config, store)

    // 启动持仓监控
    this.positionMonitor.start()

    // 初始化新调度架构
    this.scheduler = new SymbolBasedScheduler(indicatorsHub, binance)
    this.concurrencyPoolManager = concurrencyPoolManager

    logger.info('StrategyEngine', '策略执行引擎已初始化（新调度架构已启用）')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    aiPreScreener.initFromBotConfig(config.preScreenConfig)
    this.aiAnalyzer.updateConfig(config)
    this.indicatorsHub.updateConfig(config)
    this.positionMonitor.stop()
    this.positionMonitor = new StrategyPositionMonitor(this.binance, this.positionManager, this.positionCloser, config, this.store)
    this.positionMonitor.start()
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
    // 初始化该策略的下次扫描时间：设为当前时间，让首次 setTimeout 触发时立即执行
    instance.nextScanTime = Date.now()

    // 更新全局扫描间隔（取所有策略中的最小值）
    this.updateGlobalScanInterval()

    // 防抖：多个策略同时启动时，只安排一次立即运行
    if (!this.immediateRunScheduled) {
      this.immediateRunScheduled = true
      // 使用 200ms 延迟确保所有策略的异步初始化（subscribeStrategy 等）全部完成后再执行全局循环
      setTimeout(async () => {
        this.immediateRunScheduled = false
        await this.globalStrategyLoop()
      }, 200)
    }

    // 如果全局定时器未启动，则启动
    if (!this.globalTimer) {
      this.globalTimer = setInterval(() => {
        // 使用 void 忽略异步操作的 Promise，避免 setInterval 堆积
        void this.globalStrategyLoop()
      }, this.globalScanInterval)
      logger.info('StrategyEngine', `全局策略循环已启动, 间隔 ${this.globalScanInterval / 1000}秒`)
    }
  }

  /**
   * 停止策略循环
   */
  private stopStrategyLoop(instance: StrategyInstance): void {
    instance.isRunning = false

    // 如果所有策略都已停止，停止全局定时器
    const hasRunning = Array.from(this.runningStrategies.values()).some(i => i.isRunning)
    if (!hasRunning && this.globalTimer) {
      clearInterval(this.globalTimer)
      this.globalTimer = null
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
    const loopStartTime = Date.now()
    
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
      for (const [symbol, dueInstances] of symbolStrategies) {
        try {
          // 过滤掉已有仓位的策略
          const activeInstances: StrategyInstance[] = []
          for (const instance of dueInstances) {
            if (!(await this.positionManager.hasConflict(symbol, instance.strategy.id))) {
              activeInstances.push(instance)
            }
          }

          if (activeInstances.length === 0) continue

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
    } catch (error: any) {
      logger.error('StrategyEngine', `全局策略循环异常: ${error.message}`)
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
      logger.info('扫描结果', ` ${symbol}，已有仓位`)
      return
    }

    // 2. 确定主周期（使用配置的第一个周期，即最小的周期）
    const mainTimeframe = strategy.marketData.timeframes[0] || '15m'

    // 3. 从快照中提取指标数据
    const indicatorsData = this.extractIndicatorsFromSnapshot(snapshot, mainTimeframe)

    // 4. 补充策略特定的指标（OI和EMA）
    const oiStatConfig = strategy.statistics.find((s: any) => s.type === 'OI' && s.enabled)
    if (oiStatConfig) {
      const oiTimeframe = oiStatConfig?.timeframes?.[0] || mainTimeframe
      const changePeriod = Number(oiStatConfig?.params?.changePeriod ?? 6)
      const trendThresholdPercent = Number(oiStatConfig?.params?.trendThresholdPercent ?? 0.05)
      const lookbackMinutes = Math.max(1, changePeriod) * this.timeframeToMinutes(oiTimeframe)

      try {
        const oiData = await this.indicatorsHub.getIndicators(symbol, oiTimeframe, 'OI', {
          lookbackMinutes,
          trendThresholdPercent
        })
        indicatorsData.set(`${oiTimeframe}_OI`, oiData)
      } catch (error: any) {
        logger.warn('StrategyEngine', `获取OI失败 ${symbol} ${oiTimeframe}: ${error.message}`)
      }
    }

    // 动态获取EMA
    const emaPeriods = this.getEMAPeriodsFromStrategy(strategy)
    try {
      const emaData = await this.indicatorsHub.getEMAByPeriods(symbol, mainTimeframe, emaPeriods)
      const emaCacheKey = `${mainTimeframe}_EMA`
      indicatorsData.set(emaCacheKey, emaData)
    } catch (error: any) {
      logger.warn('StrategyEngine', `获取动态EMA失败 ${symbol} ${mainTimeframe}: ${error.message}`)
    }

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
    if (!this.validateSignal(signal)) {
      return
    }

    // 7. 更新统计
    instance.totalSignals++

    // 8. 再次检查仓位冲突（防止并发问题）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.info('扫描结果', ` ${symbol} 已有仓位 [策略 ${strategy.id}] 信号被忽略 `)
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
      // 构建缓存键
      const cacheKey = this.buildAICacheKey(strategyId, symbol, indicatorsData)

      // 检查缓存
      const cached = this.aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
        // logger.info('StrategyEngine', `使用 AI 缓存结果: ${symbol}`)
        return cached.signal
      }

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

      // 按策略参数重新获取 RSI/MACD/ATR（覆盖快照中的默认参数值）
      if (enabledRSI) {
        try {
          const rsiData = await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'RSI', { rsiPeriod })
          indicatorsData.set(`${mainTimeframe}_RSI`, rsiData)
        } catch (error: any) {
          logger.warn('StrategyEngine', `按策略参数获取RSI失败 ${symbol}: ${error.message}`)
        }
      }
      if (enabledMACD) {
        try {
          const macdData = await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'MACD', {
            macdFastPeriod,
            macdSlowPeriod,
            macdSignalPeriod
          })
          indicatorsData.set(`${mainTimeframe}_MACD`, macdData)
        } catch (error: any) {
          logger.warn('StrategyEngine', `按策略参数获取MACD失败 ${symbol}: ${error.message}`)
        }
      }
      if (enabledATR) {
        try {
          const atrData = await this.indicatorsHub.getIndicators(symbol, mainTimeframe, 'ATR', { atrPeriod })
          indicatorsData.set(`${mainTimeframe}_ATR`, atrData)
        } catch (error: any) {
          logger.warn('StrategyEngine', `按策略参数获取ATR失败 ${symbol}: ${error.message}`)
        }
      }

      // AI预筛
      const preScreenResult = aiPreScreener.screen({
        symbol,
        strategyId,
        adx: enabledADX ? adxData.adx : undefined,
        adxSlope: enabledADX ? adxData.adxSlope : undefined,
        adxPeriod: enabledADX ? adxPeriod : undefined,
        adxTimeframe: enabledADX ? mainTimeframe : undefined,
        atr: enabledATR ? indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr : undefined,
        currentPrice: price,
        currentVolume: volumeData.current,
        prevVolume: volumeData.prev
      })

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
          histogram: macdData.histogram
        } : undefined,
        adx: enabledADX ? adxData.adx : undefined,
        adxSlope: enabledADX ? adxData.adxSlope : undefined,
        atr: enabledATR ? indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr : undefined,
        openInterest: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.value : undefined,
        openInterestChangePercent: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.changePercent : undefined,
        openInterestTrend: enabledOI ? indicatorsData.get(`${oiTimeframe}_OI`)?.values?.trend : undefined,
        adxPeriodLabel: mainTimeframe,
        enabledIndicators: {
          ema: enabledEMAs,
          rsi: enabledRSI,
          macd: enabledMACD,
          adx: enabledADX,
          atr: enabledATR,
          oi: enabledOI,
          volume: enabledVolume
        },
        lastCandle,
        prevCandle
      }

      // 使用并发池控制AI调用
      const signal = await this.concurrencyPoolManager.getAIPool().submit(async () => {
        return await this.aiAnalyzer.analyze(
          strategyId,
          symbol,
          promptConfig,
          indicators,
          price,
          volume,
          candleProgress
        )
      })

      if (!signal) {
        return null
      }

      // 统一记录扫描结果日志
      const strategyInstance = this.runningStrategies.get(strategyId)
      const strategyName = strategyInstance ? strategyInstance.strategy.name : '未知策略'
      const minConfidence = this.config.minConfidence ?? 70

      let enhancedLog = signal.reasoning

      const minFinalScore = this.config.minFinalScore
      const finalScore = signal.scoreBreakdown?.finalScore
      const isFinalScoreOK = minFinalScore === undefined || finalScore === undefined || finalScore >= minFinalScore

      const maxRiskLevel = this.config.maxRiskLevel
      let isRiskLevelOK = true
      if (maxRiskLevel !== undefined && signal.riskLevel !== undefined) {
        const riskLevelOrder: Record<string, number> = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 }
        const signalLevel = riskLevelOrder[signal.riskLevel] ?? 2
        const maxLevel = riskLevelOrder[maxRiskLevel] ?? 0
        isRiskLevelOK = signalLevel <= maxLevel
      }

      if (signal.direction === 'idle') {
        logger.info('扫描结果', `${signal.symbol} @${signal.price} IDLE 置信度（${signal.confidence} < ${minConfidence}）评分（${finalScore}） [${strategyName} - ${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`)
        return null
      } else if (signal.confidence < minConfidence) {
        logger.info('扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} 置信度（${signal.confidence} < ${minConfidence}）评分（${finalScore}） [${strategyName} - ${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`)
        return null
      } else if (!isFinalScoreOK) {
        logger.info('扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} 置信度（${signal.confidence} >= ${minConfidence}）评分（${finalScore} < ${minFinalScore}）[${strategyName} - ${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`)
        return null
      } else if (!isRiskLevelOK) {
        logger.info('扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} 置信度（${signal.confidence} >= ${minConfidence}）评分（${finalScore} >= ${minFinalScore}）风险等级（${signal.riskLevel} > ${maxRiskLevel}）[${strategyName} - ${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`)
        return null
      } else {
        logger.success('扫描结果', `${signal.symbol} @${signal.price} ${signal.direction.toUpperCase()} 置信度（${signal.confidence} >= ${minConfidence}）评分（${finalScore} >= ${minFinalScore}）风险等级（${signal.riskLevel} < ${maxRiskLevel}）[${strategyName} - ${signal.strategyId}] ===详细AI日志=== ${enhancedLog}`)
      }

      // 补充止损价
      if (signal.direction === 'long' || signal.direction === 'short') {
        signal.stopLoss = this.calculateStopLoss(price, signal.direction)
      }

      // 缓存结果
      this.aiCache.set(cacheKey, { signal, timestamp: Date.now() })

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
    strategyId: StrategyId,
    symbol: string,
    indicatorsData: Map<string, any>
  ): string {
    // 基于指标数据构建唯一键
    const dataHash = Array.from(indicatorsData.entries())
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
      .join('|')

    return `${strategyId}_${symbol}_${Buffer.from(dataHash).toString('base64').substring(0, 32)}`
  }

  /**
   * 计算止损价
   */
  private calculateStopLoss(price: number, direction: 'long' | 'short'): number {
    // 简化版本，实际应该基于 ATR 计算
    const stopLossPercent = 0.02 // 2% 止损
    if (direction === 'long') {
      return price * (1 - stopLossPercent)
    } else {
      return price * (1 + stopLossPercent)
    }
  }

  /**
   * 验证信号
   */
  private validateSignal(signal: TradeSignal): boolean {
    // 检查必填字段
    if (!signal.strategyId || !signal.symbol || !signal.direction || !signal.action) {
      logger.info('StrategyEngine', `[缺失字段] 策略ID=${signal.strategyId || '未知'} 交易对=${signal.symbol || '未知'} 方向=${signal.direction || '未知'} 操作=${signal.action || '未知'}`);
      return false
    }

    // 检查置信度
    const minConfidence = this.config.minConfidence ?? 70
    if (signal.confidence < minConfidence) {
      return false
    }

    // 检查最终评分
    const minFinalScore = this.config.minFinalScore
    if (minFinalScore !== undefined && signal.scoreBreakdown?.finalScore !== undefined && signal.scoreBreakdown.finalScore < minFinalScore) {
      return false
    }

    // 检查风险等级
    const maxRiskLevel = this.config.maxRiskLevel
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

  // ==================== 信号执行 ====================

  /**
   * 执行交易信号
   */
  private async executeSignal(instance: StrategyInstance, signal: TradeSignal, indicatorsData: Map<string, any>): Promise<void> {
    let symbolLocked = false
    let positionRecorded = false
    try {
      const strategy = instance.strategy

      logger.info('开仓信号', `执行信号: ${signal.symbol} ${signal.direction} (${signal.reasoning})`)

      // 1. 获取账户余额
      const account = await this.binance.fetchBalance()
      logger.info('账户', `余额: ${account.availableBalance} USDT`)

      // 余额检查
      if (account.availableBalance < 60) {
        logger.warn('开仓', `账户余额（${account.availableBalance} USDT）不足60 USDT，无法开仓`)
        return
      }

      // 余额检查通过后再锁定交易对，避免“未开仓先锁仓”
      this.positionManager.lockSymbol(signal.symbol, strategy.id)
      symbolLocked = true

      // 2. 计算止损价格
      const stopLoss = calculateStopLoss(
        signal.price,
        signal.direction.toUpperCase() as 'LONG' | 'SHORT',
        signal.indicators.atr || (signal.price * 0.01), // 默认ATR为价格的1%
        strategy.riskManagement.stopLossATRMultiplier
      )

      // 3. 计算杠杆
      let finalLeverage = typeof strategy.executionConfig.leverage === 'number' ? strategy.executionConfig.leverage : 3
      let leverageCalculationDetails = {}

      // 暂时固定杠杆，动态杠杆功能后续实现
      logger.info('杠杆', `使用杠杆: ${finalLeverage} X`)

      // 4. 设置杠杆和持仓模式
      await this.binance.setLeverage(signal.symbol, finalLeverage)
      await this.binance.setMarginMode(signal.symbol, 'cross')
      
      try {
        await this.binance.setPositionMode(false) // 单向持仓模式
        logger.info('持仓模式', '已设置为单向持仓模式')
      } catch (error: any) {
        logger.warn('持仓模式', `设置持仓模式失败: ${error.message}`)
      }

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

      logger.success('开仓', `开仓订单已提交`, order)

      // 7. 确认持仓建立
      const realPosition = await waitAndConfirmPosition(this.binance, signal.symbol, 3, 500)
      
      if (!realPosition) {
        throw new Error('开仓后未检测到实际持仓')
      }

      const actualQuantity = realPosition.quantity
      logger.info('持仓确认', `实际成交数量: ${actualQuantity} (下单数量: ${quantity})`)

      // 8. 计算止盈价格
      const takeProfit1 = calculateTakeProfit(signal.price, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[0])
      const takeProfit2 = calculateTakeProfit(signal.price, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[1])
      
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
          entryIndicators[`EMA${period}`] = Number(value)
        })
      }
      
      // 收集其他指标
      if (rsiData.rsi !== undefined) entryIndicators['RSI'] = rsiData.rsi
      if (macdData.macd !== undefined) entryIndicators['MACD'] = macdData.macd
      if (adxData.adx !== undefined) entryIndicators['ADX'] = adxData.adx
      if (atrData.atr !== undefined) entryIndicators['ATR'] = atrData.atr
      
      // 收集 OI 和 Volume
      const oiStatConfig = strategy.statistics.find((s: any) => s.type === 'OI' && s.enabled)
      const volumeStatConfig = strategy.statistics.find((s: any) => s.type === 'Volume' && s.enabled)
      
      if (oiStatConfig) {
        const oiTimeframe = oiStatConfig.timeframes?.[0] || mainTimeframe
        const oiData = indicatorsData.get(`${oiTimeframe}_OI`)?.values || {}
        if (oiData.value !== undefined) entryIndicators['OI'] = oiData.value
      }
      
      if (volumeStatConfig) {
        const volumeTimeframe = volumeStatConfig.timeframes?.[0] || '1h'
        const volumeData = indicatorsData.get(`${volumeTimeframe}_Volume`)?.values || {}
        if (volumeData.current !== undefined) entryIndicators['Volume'] = volumeData.current
      }

      // 9. 设置止损单
      const stopSide = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', false)
      const stopOrder = await this.binance.stopLossOrder(signal.symbol, stopSide, actualQuantity, stopLoss)

      logger.success('止损', `止损单已设置`, stopOrder)

      // 计算开仓手续费
      const positionValue = Math.abs(actualQuantity) * signal.price
      const entryCommission = positionValue * (this.config.commissionRate || 0.0005)

      logger.info('开仓', `开仓手续费: ${entryCommission.toFixed(4)} USDT`, {
        positionValue: positionValue.toFixed(3),
        commissionRate: this.config.commissionRate || 0.0005
      })

      // 10. 记录仓位到PositionManager
      const position = {
        symbol: signal.symbol,
        strategyId: strategy.id,
        direction: signal.direction,
        entryPrice: signal.price,
        quantity: actualQuantity,
        leverage: finalLeverage,
        stopLoss,
        initialStopLoss: stopLoss,
        takeProfit1,
        takeProfit2,
        openTime: Date.now(),
        highestPrice: signal.price,
        lowestPrice: signal.price,
        orderId: order.orderId,
        stopLossOrderId: stopOrder.orderId,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        entryCommission,
        scoreBreakdown: signal.scoreBreakdown,
        riskLevel: signal.riskLevel,
        entryIndicators,
        maxFloatingProfit: 0,
        maxFloatingProfitPercent: 0,
        maxFloatingLoss: 0,
        maxFloatingLossPercent: 0,
        position: {
          symbol: signal.symbol,
          direction: signal.direction.toUpperCase() as 'LONG' | 'SHORT',
          entryPrice: signal.price,
          quantity: actualQuantity,
          leverage: finalLeverage,
          stopLoss,
          initialStopLoss: stopLoss,
          takeProfit1,
          takeProfit2,
          openTime: Date.now(),
          highestPrice: signal.price,
          lowestPrice: signal.price,
          orderId: order.orderId,
          stopLossOrderId: stopOrder.orderId,
          entryCommission
        }
      }

      this.positionManager.recordPosition(signal.symbol, position)
      positionRecorded = true

      instance.lastSignalTime = new Date().toISOString()
      instance.totalTrades++

      logger.success('开仓信号', `信号执行完成: ${signal.symbol}`)
    } catch (error: any) {
      logger.error('开仓信号', `信号执行失败 ${signal.symbol}: ${error.message}`)

      instance.error = error.message
      throw error
    } finally {
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
    logger.info('StrategyEngine', 'AI缓存已清理')
  }

  /**
   * 销毁引擎
   */
  async destroy(): Promise<void> {
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
