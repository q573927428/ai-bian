// ==================== 指标统一获取与缓存中心 ====================

import type {
  IndicatorData,
  Timeframe,
  IndicatorType,
  StatisticsType,
  StrategyId,
  CachedData
} from '../../../types/strategy'
import type { TechnicalIndicators, OHLCV, BotConfig } from '../../../types'
import { BinanceService } from '../../utils/binance'
import { calculateIndicators } from '../../utils/indicators'
import { logger } from '../../utils/logger'

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

  // 常用时间周期
  private readonly ALL_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d']

  // 常用指标类型
  private readonly ALL_INDICATORS: IndicatorType[] = ['EMA', 'RSI', 'ATR', 'ADX']
  private readonly ALL_STATISTICS: StatisticsType[] = ['OI', 'Volume']

  // K线数据TTL（毫秒）
  private readonly KLINE_TTL: Record<Timeframe, number> = {
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

  // 最大并发数
  private readonly MAX_CONCURRENT = 3

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    logger.info('IndicatorsHub', '指标统一获取中心已初始化（重构版）')
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
    logger.success('IndicatorsHub', `所有交易对数据初始化完成，耗时 ${duration}ms`)
  }

  /**
   * 初始化单个交易对的数据
   */
  private async initializeSymbolData(symbol: string): Promise<void> {
    try {
      // logger.info('IndicatorsHub', `初始化 ${symbol} 数据...`)

      // 1. 获取所有时间周期的K线
      await this.fetchAndCacheKlines(symbol)

      // 2. 获取持仓量
      await this.fetchAndCacheOI(symbol)

      // 3. 计算所有指标
      await this.calculateAndCacheAllIndicators(symbol)

      // logger.success('IndicatorsHub', `${symbol} 数据初始化完成`)
    } catch (error: any) {
      logger.error('IndicatorsHub', `${symbol} 数据初始化失败: ${error.message}`)
    }
  }

  // ==================== K线数据管理 ====================

  /**
   * 获取并缓存K线数据
   */
  private async fetchAndCacheKlines(symbol: string): Promise<void> {
    const symbolData = this.getOrCreateSymbolData(symbol)

    for (const timeframe of this.ALL_TIMEFRAMES) {
      const cacheKey = `${symbol}_${timeframe}_klines`
      const pending = this.pendingRequests.get(cacheKey)
      if (pending) {
        await pending
        continue
      }

      const requestPromise = (async () => {
        try {
          const limit = this.config.indicatorsConfig?.requiredCandles || 300
          const klines = await this.binance.fetchOHLCV(symbol, timeframe, undefined, limit)
          symbolData.klineData.set(timeframe, klines)
          // logger.info('IndicatorsHub', `${symbol} ${timeframe} K线已缓存，共 ${klines.length} 根`)
        } finally {
          this.pendingRequests.delete(cacheKey)
        }
      })()

      this.pendingRequests.set(cacheKey, requestPromise)
      await requestPromise
    }
  }

  /**
   * 从缓存获取K线数据
   */
  getKlines(symbol: string, timeframe: Timeframe): OHLCV[] | undefined {
    const symbolData = this.symbolDataCache.get(symbol)
    return symbolData?.klineData.get(timeframe)
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
   * 计算并缓存所有指标
   */
  private async calculateAndCacheAllIndicators(symbol: string): Promise<void> {
    const symbolData = this.getOrCreateSymbolData(symbol)

    for (const timeframe of this.ALL_TIMEFRAMES) {
      const klines = symbolData.klineData.get(timeframe)
      if (!klines || klines.length === 0) {
        continue
      }

      try {
        // 计算技术指标
        const indicators = await calculateIndicators(this.binance, symbol, this.config, klines)

        // 缓存各个指标
        for (const type of this.ALL_INDICATORS) {
          const cacheKey = `${symbol}_${timeframe}_${type}`
          const indicatorData: IndicatorData = {
            symbol,
            timeframe,
            timestamp: Date.now(),
            values: this.extractIndicatorValues(indicators, type)
          }
          symbolData.indicators.set(cacheKey, indicatorData)
        }

        // 缓存成交量
        const volumeData = this.calculateVolumeFromKlines(klines)
        if (!symbolData.volumeData) {
          symbolData.volumeData = new Map()
        }
        symbolData.volumeData.set(timeframe, {
          ...volumeData,
          timestamp: Date.now()
        })
      } catch (error: any) {
        // logger.error('IndicatorsHub', `${symbol} ${timeframe} 指标计算失败: ${error.message}`)
      }
    }
  }

  /**
   * 从计算结果中提取指定类型的指标值
   */
  private extractIndicatorValues(indicators: TechnicalIndicators, type: IndicatorType): Record<string, any> {
    switch (type) {
      case 'EMA':
        return {
          emaPeriods: indicators.emaPeriods,
          emaNames: indicators.emaNames,
          emaFast: indicators.emaFast,
          emaMedium: indicators.emaMedium,
          emaSlow: indicators.emaSlow,
          emaFastValues: indicators.emaFastValues,
          emaMediumValues: indicators.emaMediumValues,
          emaSlowValues: indicators.emaSlowValues,
          adxPeriodLabels: indicators.adxPeriodLabels
        }
      case 'RSI':
        return { rsi: indicators.rsi }
      case 'ATR':
        return { atr: indicators.atr }
      case 'ADX':
        return {
          adxMain: indicators.adxMain,
          adxSecondary: indicators.adxSecondary,
          adxTertiary: indicators.adxTertiary,
          adxSlope: indicators.adxSlope,
          adxPeriodLabels: indicators.adxPeriodLabels
        }
      default:
        return {}
    }
  }

  /**
   * 从K线计算成交量数据
   */
  private calculateVolumeFromKlines(klines: OHLCV[]): { current: number; average: number; ratio: number } {
    const currentVolume = klines[klines.length - 1]?.volume || 0
    const averageVolume = klines.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20
    return {
      current: currentVolume,
      average: averageVolume,
      ratio: averageVolume > 0 ? currentVolume / averageVolume : 0
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
    types: (IndicatorType | StatisticsType)[]
  ): Promise<Map<string, IndicatorData>> {
    const results = new Map<string, IndicatorData>()
    const promises = timeframes.flatMap(tf =>
      types.map(async type => {
        try {
          const data = await this.getIndicators(symbol, tf, type)
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
    logger.info('IndicatorsHub', `策略 ${strategyId} 已连接到统一数据源`)
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

    logger.info('IndicatorsHub', `定时更新循环已启动，间隔 ${intervalMs / 1000}秒`)
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
      // 1. 刷新K线
      await this.fetchAndCacheKlines(symbol)

      // 2. 刷新持仓量
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
}