// ==================== 指标统一获取与缓存中心 ====================

import { EMA, RSI, ADX, ATR, MACD } from 'technicalindicators'
import type {
  IndicatorData,
  Timeframe,
  IndicatorType,
  StatisticsType,
  StrategyId,
  CachedData,
  AIInput
} from '../../../types/strategy'
import type { OHLCV, BotConfig } from '../../../types'
import type { KLineTimeframe } from '../../../types/kline-simple'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { MultiTimeframeIndicatorCalculator } from './MultiTimeframeIndicatorCalculator'
import { 
  getSimpleKLineAsOHLCV, 
  getKLineFileMTime, 
  hasKLineData 
} from '../../utils/kline-simple-storage'
import { EventEmitter } from 'node:events'

/**
 * 统一数据缓存条目
 */
interface SymbolData {
  symbol: string
  klineData: Map<Timeframe, OHLCV[]>
  oiData?: { value: number; timestamp: number }
  volumeData?: Map<Timeframe, { current: number; average: number; ratio: number; timestamp: number }>
  indicators: Map<string, IndicatorData>
}

/**
 * 指标统一获取与缓存中心（重构版）
 *
 * 核心特性：
 * 1. 全局数据源 - 从 bot-config 统一管理交易对列表
 * 2. 统一K线缓存 - 所有策略共享同一套K线数据
 * 3. 按需计算指标 - 从缓存K线计算指标，避免重复API请求
 * 4. 定时刷新 - 统一刷新所有数据，避免并发控制
 */
export class IndicatorsHub {
  private static instance: IndicatorsHub | null = null

  // 依赖
  private binance: BinanceService
  private config: BotConfig

  // 统一数据缓存: symbol -> SymbolData
  private symbolDataCache: Map<string, SymbolData> = new Map()

  // 所有支持的时间周期
  private readonly ALL_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']

  // 常用指标类型
  private readonly ALL_INDICATORS: IndicatorType[] = ['EMA', 'RSI', 'MACD', 'ATR', 'ADX']
  private readonly ALL_STATISTICS: StatisticsType[] = ['OI', 'Volume']

  // K线数据TTL（毫秒）
  private readonly KLINE_TTL: Record<Timeframe, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  }

  // 统计数据TTL
  private readonly STATS_TTL = 300 * 1000 // 5分钟

  // 进行中的请求
  private pendingRequests: Map<string, Promise<any>> = new Map()

  // 定时更新定时器
  private updateTimer: NodeJS.Timeout | null = null

  // 多周期指标计算器
  private multiTimeframeCalculator: MultiTimeframeIndicatorCalculator | null = null

  // 最大并发数
  private readonly MAX_CONCURRENT = 3

  // 文件修改时间跟踪
  private fileMTimes: Map<string, number> = new Map()

  // 已订阅的事件发射器
  private subscribedEventEmitters: Set<EventEmitter> = new Set()

  // K线周期映射 - IndicatorsHub 支持的周期 -> 简单存储支持的周期
  private readonly TIMEFRAME_MAP: Record<Timeframe, KLineTimeframe | null> = {
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d'
  }

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    // logger.info('IndicatorsHub', '指标统一获取中心已初始化（重构版）')
    
    // 初始化多周期指标计算器
    this.multiTimeframeCalculator = new MultiTimeframeIndicatorCalculator(
      this.binance,
      this,
      this.config
    )
  }

  /**
   * 获取单例实例
   */
  static getInstance(binance: BinanceService, config: BotConfig): IndicatorsHub {
    if (!IndicatorsHub.instance) {
      IndicatorsHub.instance = new IndicatorsHub(binance, config)
    }
    return IndicatorsHub.instance
  }

  /**
   * 重置单例
   */
  static resetInstance(): void {
    if (IndicatorsHub.instance) {
      IndicatorsHub.instance.stopUpdateLoop()
      IndicatorsHub.instance.symbolDataCache.clear()
      IndicatorsHub.instance = null
      logger.info('IndicatorsHub', '指标统一获取中心已重置')
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
  }

  /**
   * 更新 Binance 服务实例
   */
  updateBinance(binance: BinanceService): void {
    this.binance = binance
  }

  /**
   * 获取或创建 SymbolData
   */
  private getOrCreateSymbolData(symbol: string): SymbolData {
    let data = this.symbolDataCache.get(symbol)
    if (!data) {
      data = {
        symbol,
        klineData: new Map(),
        indicators: new Map()
      }
      this.symbolDataCache.set(symbol, data)
    }
    return data
  }

  // ==================== 统一数据初始化 ====================

  /**
   * 初始化所有交易对的数据
   */
  async initializeAllData(): Promise<void> {
    const symbols = this.config.symbols || []
    if (symbols.length === 0) {
      logger.warn('IndicatorsHub', '没有配置交易对')
      return
    }

    // logger.info('IndicatorsHub', `开始初始化 ${symbols.length} 个交易对的数据...`)
    const startTime = Date.now()

    // 分批初始化，控制并发
    for (let i = 0; i < symbols.length; i += this.MAX_CONCURRENT) {
      const batch = symbols.slice(i, i + this.MAX_CONCURRENT)
      await Promise.allSettled(
        batch.map(symbol => this.initializeSymbolData(symbol))
      )
    }

    const duration = Date.now() - startTime
    // logger.success('IndicatorsHub', `所有交易对数据初始化完成，耗时 ${duration}ms`)
  }

  /**
   * 初始化单个交易对的数据
   */
  private async initializeSymbolData(symbol: string): Promise<void> {
    try {
      // logger.info('IndicatorsHub', `初始化 ${symbol} 数据...`)

      // 1. 从文件加载所有时间周期的K线
      await this.loadKlinesFromFile(symbol)

      // 2. 获取持仓量
      await this.fetchAndCacheOI(symbol)

      // 3. 获取成交量数据
      await this.calculateAndCacheAllIndicators(symbol)

      // logger.success('IndicatorsHub', `${symbol} 数据初始化完成`)
    } catch (error: any) {
      logger.error('IndicatorsHub', `${symbol} 数据初始化失败: ${error.message}`)
    }
  }

  // ==================== K线数据管理 ====================

  /**
   * 从文件加载并缓存K线数据（替代 API 拉取）
   */
  private async loadKlinesFromFile(symbol: string): Promise<void> {
    const symbolData = this.getOrCreateSymbolData(symbol)
    const limit = this.config.indicatorsConfig?.requiredCandles || 300

    for (const timeframe of this.ALL_TIMEFRAMES) {
      const mappedTimeframe = this.TIMEFRAME_MAP[timeframe]
      
      // 如果该周期不支持，跳过
      if (!mappedTimeframe) {
        continue
      }

      // 检查文件是否存在且有数据
      if (!hasKLineData(symbol, mappedTimeframe)) {
        logger.warn('IndicatorsHub', `${symbol} ${timeframe} K线文件不存在或为空，跳过`)
        continue
      }

      try {
        // 从文件读取 K线
        const klines = getSimpleKLineAsOHLCV(symbol, mappedTimeframe, limit)
        symbolData.klineData.set(timeframe, klines)

        // 记录文件修改时间
        const mtime = getKLineFileMTime(symbol, mappedTimeframe)
        if (mtime) {
          this.fileMTimes.set(`${symbol}_${timeframe}`, mtime)
        }

        // logger.info('IndicatorsHub', `${symbol} ${timeframe} K线已从文件加载，共 ${klines.length} 根`)
      } catch (error: any) {
        logger.error('IndicatorsHub', `${symbol} ${timeframe} 从文件加载K线失败: ${error.message}`)
      }
    }
  }

  /**
   * 使指标缓存失效（当 K线文件更新时）
   */
  private invalidateIndicatorsCache(symbol: string, timeframe: Timeframe): void {
    const symbolData = this.symbolDataCache.get(symbol)
    if (!symbolData) return

    // 清除该交易对和周期的所有指标缓存
    for (const [key] of symbolData.indicators) {
      if (key.startsWith(`${symbol}_${timeframe}_`)) {
        symbolData.indicators.delete(key)
      }
    }

    // 清除成交量缓存
    symbolData.volumeData?.delete(timeframe)
  }

  /**
   * 从缓存获取K线数据（自动检查文件更新）
   */
  getKlines(symbol: string, timeframe: Timeframe): OHLCV[] | undefined {
    const symbolData = this.getOrCreateSymbolData(symbol)
    const mappedTimeframe = this.TIMEFRAME_MAP[timeframe]
    const cacheKey = `${symbol}_${timeframe}`

    // 如果该周期不支持，尝试返回缓存
    if (!mappedTimeframe) {
      return symbolData.klineData.get(timeframe)
    }

    // 检查文件是否更新
    const currentMTime = getKLineFileMTime(symbol, mappedTimeframe)
    const cachedMTime = this.fileMTimes.get(cacheKey)

    // 如果文件已更新，重新加载
    if (currentMTime && currentMTime !== cachedMTime) {
      const limit = this.config.indicatorsConfig?.requiredCandles || 300
      const klines = getSimpleKLineAsOHLCV(symbol, mappedTimeframe, limit)
      
      if (klines.length > 0) {
        symbolData.klineData.set(timeframe, klines)
        this.fileMTimes.set(cacheKey, currentMTime)
        this.invalidateIndicatorsCache(symbol, timeframe)
        // logger.info('IndicatorsHub', `${symbol} ${timeframe} K线已更新（文件变化检测）`)
      }
    }

    return symbolData.klineData.get(timeframe)
  }

  // ==================== 持仓量数据管理 ====================

  /**
   * 获取并缓存持仓量
   */
  private async fetchAndCacheOI(symbol: string): Promise<void> {
    const symbolData = this.getOrCreateSymbolData(symbol)
    const cacheKey = `${symbol}_OI`
    const pending = this.pendingRequests.get(cacheKey)
    if (pending) {
      await pending
      return
    }

    const requestPromise = (async () => {
      try {
        const oiData = await this.binance.fetchOpenInterest(symbol)
        symbolData.oiData = {
          value: oiData.openInterest,
          timestamp: Date.now()
        }
        // logger.info('IndicatorsHub', `${symbol} OI已缓存: ${oiData.openInterest}`)
      } finally {
        this.pendingRequests.delete(cacheKey)
      }
    })()

    this.pendingRequests.set(cacheKey, requestPromise)
    await requestPromise
  }

  /**
   * 从缓存获取持仓量
   */
  getOI(symbol: string): { value: number; timestamp: number } | undefined {
    return this.symbolDataCache.get(symbol)?.oiData
  }

  // ==================== 指标计算与缓存 ====================

  /**
   * 标准化 EMA 周期（最少返回 1 个）
   */
  private normalizeEMAPeriods(periods: number[]): number[] {
    const defaultPeriods = [14]
    const cleaned = periods
      .map(p => Number(p))
      .filter(p => Number.isFinite(p) && p >= 2)
      .map(p => Math.floor(p))

    const merged: number[] = []
    for (const p of [...cleaned, ...defaultPeriods]) {
      if (!merged.includes(p)) {
        merged.push(p)
      }
      if (merged.length >= Math.max(1, cleaned.length)) break
    }

    return merged.length > 0 ? merged : defaultPeriods
  }

  /**
   * 计算并缓存指定周期组合的 EMA
   */
  private calculateAndCacheEMAByPeriods(
    symbol: string,
    timeframe: Timeframe,
    closes: number[],
    periods: number[]
  ): IndicatorData {
    const symbolData = this.getOrCreateSymbolData(symbol)
    const emaPeriods = this.normalizeEMAPeriods(periods)

    const cacheKey = `${symbol}_${timeframe}_EMA_${emaPeriods.join('_')}`
    const cached = symbolData.indicators.get(cacheKey)
    if (cached) {
      return cached
    }

    const emaValues = emaPeriods.map((period) => {
      const values = EMA.calculate({ period, values: closes })
      return values[values.length - 1] ?? closes[closes.length - 1]
    })

    const emaMap = Object.fromEntries(
      emaPeriods.map((period, index) => [`EMA${period}`, emaValues[index]])
    )

    const emaList = emaPeriods.map((period, index) => ({
      period,
      name: `EMA${period}`,
      value: emaValues[index]
    }))

    const indicatorData: IndicatorData = {
      symbol,
      timeframe,
      timestamp: Date.now(),
      values: {
        emaMap,
        emaList
      }
    }

    symbolData.indicators.set(cacheKey, indicatorData)

    return indicatorData
  }

  /**
   * 对外：按指定周期获取 EMA（带缓存）
   */
  async getEMAByPeriods(symbol: string, timeframe: Timeframe, periods: number[]): Promise<IndicatorData> {
    const klines = this.getKlines(symbol, timeframe)
    if (!klines || klines.length === 0) {
      throw new Error(`${symbol} ${timeframe} K线数据不足，无法计算EMA`)
    }

    const closes = klines.map(c => c.close)
    return this.calculateAndCacheEMAByPeriods(symbol, timeframe, closes, periods)
  }

  /**
   * 计算并缓存所有指标（包括技术指标和成交量）
   */
  private async calculateAndCacheAllIndicators(symbol: string): Promise<void> {
    const symbolData = this.getOrCreateSymbolData(symbol)

    for (const timeframe of this.ALL_TIMEFRAMES) {
      const klines = symbolData.klineData.get(timeframe)
      if (!klines || klines.length === 0) {
        continue
      }

      try {
        // 缓存成交量
        const currentVolume = klines[klines.length - 1]?.volume || 0
        const averageVolume = klines.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20
        const volumeData = {
          current: currentVolume,
          average: averageVolume,
          ratio: averageVolume > 0 ? currentVolume / averageVolume : 0
        }
        
        if (!symbolData.volumeData) {
          symbolData.volumeData = new Map()
        }
        symbolData.volumeData.set(timeframe, {
          ...volumeData,
          timestamp: Date.now()
        })

        // 计算并缓存技术指标
        const closes = klines.map(c => c.close)
        const highs = klines.map(c => c.high)
        const lows = klines.map(c => c.low)

        // EMA (14, 60, 120)
        try {
          this.calculateAndCacheEMAByPeriods(symbol, timeframe, closes, [14, 60, 120])
        } catch (e) {
          // 忽略 EMA 计算错误
        }

        // RSI (14)
        try {
          const rsiValues = RSI.calculate({ period: 14, values: closes })
          const rsiCacheKey = `${symbol}_${timeframe}_RSI`
          symbolData.indicators.set(rsiCacheKey, {
            symbol,
            timeframe,
            timestamp: Date.now(),
            values: {
              rsi: rsiValues[rsiValues.length - 1] ?? 50
            }
          })
        } catch (e) {
          // 忽略 RSI 计算错误
        }

        // MACD (默认参数: fast=12, slow=26, signal=9)
        try {
          const macdValues = MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
          })
          const lastMACD = macdValues[macdValues.length - 1]
          const macdCacheKey = `${symbol}_${timeframe}_MACD`
          symbolData.indicators.set(macdCacheKey, {
            symbol,
            timeframe,
            timestamp: Date.now(),
            values: {
              macd: lastMACD?.MACD ?? 0,
              signal: lastMACD?.signal ?? 0,
              histogram: lastMACD?.histogram ?? 0
            }
          })
        } catch (e) {
          // 忽略 MACD 计算错误
        }

        // ATR (14)
        try {
          const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes })
          const atrCacheKey = `${symbol}_${timeframe}_ATR`
          const lastClose = closes[closes.length - 1] || 0
          const atrValue = atrValues.length > 0 ? atrValues[atrValues.length - 1] : lastClose * 0.01
          symbolData.indicators.set(atrCacheKey, {
            symbol,
            timeframe,
            timestamp: Date.now(),
            values: {
              atr: atrValue
            }
          })
        } catch (e) {
          // 忽略 ATR 计算错误
        }

        // ADX (14) + ADX斜率
        try {
          const adxValues = ADX.calculate({ period: 14, high: highs, low: lows, close: closes })
          const currentADX = adxValues[adxValues.length - 1]?.adx ?? 0
          const adxSlopePeriod = this.config.indicatorsConfig?.adxSlopePeriod ?? 3
          const previousADXIndex = Math.max(0, adxValues.length - 1 - adxSlopePeriod)
          const previousADX = adxValues[previousADXIndex]?.adx ?? currentADX
          const adxSlope = currentADX - previousADX

          const adxCacheKey = `${symbol}_${timeframe}_ADX`
          symbolData.indicators.set(adxCacheKey, {
            symbol,
            timeframe,
            timestamp: Date.now(),
            values: {
              adxMain: currentADX,
              adxSlope: adxSlope,
              adxPeriodLabels: { main: timeframe, secondary: '1h', tertiary: '4h' }
            }
          })
        } catch (e) {
          // 忽略 ADX 计算错误
        }

      } catch (error: any) {
        logger.error('IndicatorsHub', `${symbol} ${timeframe} 指标缓存失败: ${error.message}`)
      }
    }
  }

  // ==================== 对外API：获取数据 ====================

  /**
   * 获取指标数据（从统一缓存读取）
   */
  async getIndicators(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType | StatisticsType
  ): Promise<IndicatorData> {
    const symbolData = this.symbolDataCache.get(symbol)
    if (!symbolData) {
      throw new Error(`${symbol} 数据未初始化`)
    }

    if (type === 'EMA') {
      throw new Error(`${symbol} ${timeframe} EMA 需通过 getEMAByPeriods(symbol, timeframe, periods) 获取`)
    }

    if (type === 'OI') {
      const oi = symbolData.oiData
      if (!oi) {
        throw new Error(`${symbol} OI数据未初始化`)
      }
      return {
        symbol,
        timeframe,
        timestamp: oi.timestamp,
        values: {
          value: oi.value,
          trend: 'flat',
          changePercent: 0
        }
      }
    }

    if (type === 'Volume') {
      const volumeData = symbolData.volumeData?.get(timeframe)
      if (!volumeData) {
        throw new Error(`${symbol} ${timeframe} Volume数据未初始化`)
      }
      return {
        symbol,
        timeframe,
        timestamp: volumeData.timestamp,
        values: {
          current: volumeData.current,
          average: volumeData.average,
          ratio: volumeData.ratio
        }
      }
    }

    const cacheKey = `${symbol}_${timeframe}_${type}`
    const indicatorData = symbolData.indicators.get(cacheKey)
    if (!indicatorData) {
      throw new Error(`${symbol} ${timeframe} ${type} 指标数据未初始化`)
    }
    return indicatorData
  }

  /**
   * 批量获取指标数据
   */
  async getBatchIndicators(
    symbol: string,
    timeframes: Timeframe[],
    types: (IndicatorType | StatisticsType)[],
    options?: {
      emaPeriods?: number[]
    }
  ): Promise<Map<string, IndicatorData>> {
    const results = new Map<string, IndicatorData>()
    const promises = timeframes.flatMap(tf =>
      types.map(async type => {
        try {
          let data: IndicatorData

          if (type === 'EMA') {
            if (!options?.emaPeriods || options.emaPeriods.length === 0) {
              logger.warn('IndicatorsHub', `跳过 ${symbol} ${tf} EMA：缺少 emaPeriods，请使用 getEMAByPeriods 或在 getBatchIndicators 传入 options.emaPeriods`)
              return
            }
            data = await this.getEMAByPeriods(symbol, tf, options.emaPeriods)
          } else {
            data = await this.getIndicators(symbol, tf, type)
          }

          const key = `${tf}_${type}`
          results.set(key, data)
        } catch (error: any) {
          logger.warn('IndicatorsHub', `获取 ${symbol} ${tf} ${type} 失败: ${error.message}`)
        }
      })
    )
    await Promise.allSettled(promises)
    return results
  }

  // ==================== 策略订阅（空实现，保持兼容）====================

  /**
   * 订阅（空实现，保持接口兼容）
   */
  async subscribe(strategyId: StrategyId): Promise<void> {
    // logger.info('IndicatorsHub', `策略 ${strategyId} 已连接到统一数据源`)
  }

  /**
   * 取消订阅（空实现，保持接口兼容）
   */
  unsubscribe(strategyId: StrategyId): void {
    logger.info('IndicatorsHub', `策略 ${strategyId} 已断开连接`)
  }

  // ==================== 定时更新 ====================

  /**
   * 启动定时更新循环
   */
  startUpdateLoop(intervalMs: number = 60 * 1000): void {
    if (this.updateTimer) {
      this.stopUpdateLoop()
    }

    this.updateTimer = setInterval(async () => {
      await this.refreshAllData()
    }, intervalMs)

    // logger.info('IndicatorsHub', `定时更新循环已启动，间隔 ${intervalMs / 1000}秒`)
  }

  /**
   * 停止定时更新
   */
  stopUpdateLoop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
      logger.info('IndicatorsHub', '定时更新循环已停止')
    }
  }

  /**
   * 刷新所有数据
   */
  private async refreshAllData(): Promise<void> {
    const symbols = Array.from(this.symbolDataCache.keys())
    if (symbols.length === 0) return

    // logger.info('IndicatorsHub', `开始刷新 ${symbols.length} 个交易对的数据...`)
    const startTime = Date.now()

    for (let i = 0; i < symbols.length; i += this.MAX_CONCURRENT) {
      const batch = symbols.slice(i, i + this.MAX_CONCURRENT)
      await Promise.allSettled(
        batch.map(symbol => this.refreshSymbolData(symbol))
      )
    }

    const duration = Date.now() - startTime
    // logger.info('IndicatorsHub', `数据刷新完成，耗时 ${duration}ms`)
  }

  /**
   * 刷新单个交易对数据
   */
  private async refreshSymbolData(symbol: string): Promise<void> {
    try {
      // 1. 检查K线文件是否更新（getKlines 会自动处理）
      for (const timeframe of this.ALL_TIMEFRAMES) {
        this.getKlines(symbol, timeframe)
      }

      // 2. 刷新持仓量（仅这个需要 API 请求）
      await this.fetchAndCacheOI(symbol)

      // 3. 重新计算指标
      await this.calculateAndCacheAllIndicators(symbol)
    } catch (error: any) {
      logger.error('IndicatorsHub', `${symbol} 数据刷新失败: ${error.message}`)
    }
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): {
    size: number
    symbols: string[]
  } {
    return {
      size: this.symbolDataCache.size,
      symbols: Array.from(this.symbolDataCache.keys())
    }
  }

  // ==================== 多周期指标计算 ====================

  /**
   * 获取多周期AI输入数据
   */
  async getMultiTimeframeAIInput(
    symbol: string,
    timeframes: Timeframe[]
  ): Promise<AIInput> {
    if (!this.multiTimeframeCalculator) {
      throw new Error('多周期指标计算器未初始化')
    }
    return this.multiTimeframeCalculator.calculateIndicators(symbol, timeframes)
  }

  /**
   * 分配周期角色
   */
  assignTimeframeRoles(timeframes: Timeframe[]) {
    if (!this.multiTimeframeCalculator) {
      throw new Error('多周期指标计算器未初始化')
    }
    return this.multiTimeframeCalculator.assignRoles(timeframes)
  }

  // ==================== 单周期指标计算（用于止盈止损） ====================

  /**
   * 从策略配置的 timeframes 中选择 entry 周期来计算指标（用于止盈止损）
   * 只计算止盈止损需要的：rsi 和 adxSlope
   */
  async getIndicatorsForRiskManagement(
    symbol: string,
    strategyTimeframes: Timeframe[]
  ): Promise<{ rsi: number; adxSlope: number }> {
    try {
      // 1. 分配周期角色，找到 entry 周期
      const roles = this.assignTimeframeRoles(strategyTimeframes)
      const entryRole = roles.find(r => r.role === 'entry')
      const entryTimeframe = entryRole?.tf || strategyTimeframes[0] || '15m'

      // 2. 获取 entry 周期的 K 线数据
      const klines = this.getKlines(symbol, entryTimeframe)
      if (!klines || klines.length < 100) {
        throw new Error(`K线数据不足: ${symbol} ${entryTimeframe}`)
      }

      const closes = klines.map(c => c.close)
      const highs = klines.map(c => c.high)
      const lows = klines.map(c => c.low)

      // 3. 只计算止盈止损需要的指标

      // RSI（14周期）
      const rsiValues = RSI.calculate({ period: 14, values: closes })
      const rsi = rsiValues[rsiValues.length - 1] ?? 50

      // ADX和ADX斜率
      const adxValues = ADX.calculate({ period: 14, high: highs, low: lows, close: closes })
      const currentADX = adxValues[adxValues.length - 1]?.adx ?? 0
      const adxSlopePeriod = this.config.indicatorsConfig?.adxSlopePeriod ?? 3
      const previousADXIndex = Math.max(0, adxValues.length - 1 - adxSlopePeriod)
      const previousADX = adxValues[previousADXIndex]?.adx ?? currentADX
      const adxSlope = currentADX - previousADX

      return { rsi, adxSlope }
    } catch (error: any) {
      logger.error('IndicatorsHub', `获取止盈止损指标失败 ${symbol}: ${error.message}`)
      throw error
    }
  }

  // ==================== 事件订阅（连接 KLineSimpleSyncService）====================

  /**
   * 订阅 K线数据更新事件
   */
  subscribeToKLineUpdates(eventEmitter: EventEmitter): void {
    if (this.subscribedEventEmitters.has(eventEmitter)) {
      logger.warn('IndicatorsHub', '已经订阅了该事件发射器')
      return
    }

    // 监听 K线更新事件
    eventEmitter.on('klineUpdated', async (data: {
      symbol: string
      timeframe: KLineTimeframe
      type: 'update' | 'append'
      timestamp: number
    }) => {
      try {
        // 转换为 IndicatorsHub 使用的 Timeframe 类型
        const mappedTimeframe = this.convertToTimeframe(data.timeframe)
        if (!mappedTimeframe) {
          return
        }
        
        // 只刷新该交易对和周期的数据
        await this.refreshSymbolTimeframe(data.symbol, mappedTimeframe)
      } catch (error: any) {
        logger.error('IndicatorsHub', `处理K线更新事件失败: ${error.message}`)
      }
    })

    this.subscribedEventEmitters.add(eventEmitter)
    // logger.info('IndicatorsHub', '已订阅K线数据更新事件')
  }

  /**
   * 取消订阅 K线数据更新事件
   */
  unsubscribeFromKLineUpdates(eventEmitter: EventEmitter): void {
    if (!this.subscribedEventEmitters.has(eventEmitter)) {
      return
    }

    eventEmitter.removeAllListeners('klineUpdated')
    this.subscribedEventEmitters.delete(eventEmitter)
    logger.info('IndicatorsHub', '已取消订阅K线数据更新事件')
  }

  /**
   * 转换 KLineTimeframe 为 Timeframe
   */
  private convertToTimeframe(klineTimeframe: KLineTimeframe): Timeframe | null {
    // 简单的反向映射
    const reverseMap: Record<string, Timeframe> = {
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d'
    }
    return reverseMap[klineTimeframe] || null
  }

  /**
   * 刷新单个交易对和周期的数据
   */
  private async refreshSymbolTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    try {
      // 1. 检查并重新加载该周期的 K线
      this.getKlines(symbol, timeframe)

      // 2. 重新计算该周期的成交量指标
      const symbolData = this.symbolDataCache.get(symbol)
      if (symbolData) {
        const klines = symbolData.klineData.get(timeframe)
        if (klines && klines.length > 0) {
          const currentVolume = klines[klines.length - 1]?.volume || 0
          const averageVolume = klines.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20
          const volumeData = {
            current: currentVolume,
            average: averageVolume,
            ratio: averageVolume > 0 ? currentVolume / averageVolume : 0,
            timestamp: Date.now()
          }
          
          if (!symbolData.volumeData) {
            symbolData.volumeData = new Map()
          }
          symbolData.volumeData.set(timeframe, volumeData)
        }
      }

      // logger.debug('IndicatorsHub', `${symbol} ${timeframe} 数据已刷新（事件驱动）`)
    } catch (error: any) {
      logger.error('IndicatorsHub', `${symbol} ${timeframe} 数据刷新失败: ${error.message}`)
    }
  }
}
