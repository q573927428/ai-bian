// ==================== 指标统一获取与缓存中心 ====================

import { calculateMoneyFlow } from '../../utils/money-flow'
import { EMA, RSI, ADX, ATR, MACD } from 'technicalindicators'
import { calculateSupportResistance, type SupportResistanceOptions } from './SupportResistanceCalculator'
import { SupportResistanceCache } from './SupportResistanceCache'
import type {
  IndicatorData,
  Timeframe,
  IndicatorType,
  StatisticsType,
  StrategyId
} from '../../../types/strategy'
import type { OHLCV, BotConfig } from '../../../types'
import type { KLineTimeframe } from '../../../types/kline-simple'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { 
  getSimpleKLineAsOHLCV, 
  getKLineFileMTime, 
  hasKLineData 
} from '../../utils/kline-simple-storage'
import { EventEmitter } from 'node:events'
import { getSquareHeat, SQUARE_HEAT_CACHE_TTL_MS } from '../../utils/square-heat'
import { shortHash } from '../../utils/stable-hash'
import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { OISnapshotService } from './OISnapshotService'

/**
 * 统一数据缓存条目
 */
interface SymbolData {
  symbol: string
  klineData: Map<Timeframe, OHLCV[]>
  volumeData?: Map<Timeframe, { current: number; prev: number; average: number; emaAverage: number; emaPeriod: number; ratio: number; timestamp: number }>
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
  private oiSnapshotService: OISnapshotService

  // 统一数据缓存: symbol -> SymbolData
  private symbolDataCache: Map<string, SymbolData> = new Map()
  private supportResistanceCache = new SupportResistanceCache()

  // 所有支持的时间周期
  private readonly ALL_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']

  // 常用指标类型
  private readonly ALL_INDICATORS: IndicatorType[] = ['EMA', 'RSI', 'MACD', 'ATR', 'ADX']
  private readonly ALL_STATISTICS: StatisticsType[] = ['OI', 'Volume', 'SquareHeat']

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

  // Volume 缓存 TTL（毫秒）
  private readonly VOLUME_CACHE_TTL = 120 * 1000 // 2分钟

  // 进行中的请求
  private pendingRequests: Map<string, Promise<any>> = new Map()

  // 定时更新定时器
  private updateTimer: NodeJS.Timeout | null = null
  // 网络变慢时一轮刷新可能超过定时间隔，锁用于防止多轮刷新同时持有 K 线和请求对象。
  private isRefreshingAllData = false

  // 最大并发数
  private readonly MAX_CONCURRENT = 3

  // 文件修改时间跟踪（字符串复合标识：timestamp_volume）
  private fileMTimes: Map<string, string> = new Map()

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

  private getVolumeEmaPeriod(): number {
    const configured = Number(this.config.volumeEmaPeriod ?? 12)
    if (!Number.isFinite(configured)) return 12
    return Math.max(2, Math.floor(configured))
  }

  private calculateVolumeEma(volumes: number[], period: number): number {
    if (volumes.length === 0) return 0
    const safePeriod = Math.max(2, Math.floor(period))
    const emaSeries = EMA.calculate({ period: safePeriod, values: volumes })
    if (emaSeries.length > 0) {
      return emaSeries[emaSeries.length - 1] ?? volumes[volumes.length - 1] ?? 0
    }
    return volumes[volumes.length - 1] ?? 0
  }

  /**
   * 时间周期转分钟
   */
  private timeframeToMinutes(timeframe: Timeframe): number {
    switch (timeframe) {
      case '5m': return 5
      case '15m': return 15
      case '1h': return 60
      case '4h': return 240
      case '1d': return 1440
      default: return 15
    }
  }

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    this.oiSnapshotService = new OISnapshotService(binance)
    // logger.info('IndicatorsHub', '指标统一获取中心已初始化（重构版）')
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
      IndicatorsHub.instance.oiSnapshotService.close()
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
    this.oiSnapshotService.updateBinance(binance)
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

      // 2. 保持原有行为：全局列表只初始化当前 OI，历史 OI 由启用 OI 的策略按需预热。
      await this.oiSnapshotService.refreshCurrent(symbol)

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
    const limit = this.config.indicatorsConfig?.requiredCandles || 493

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

    // 强制清除该周期所有指标缓存（解决 symbol 格式不匹配问题）
    for (const [key, data] of symbolData.indicators) {
      if (data.timeframe === timeframe) {
        symbolData.indicators.delete(key)
      }
    }

    // 清除成交量缓存
    symbolData.volumeData?.delete(timeframe);
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
      const limit = this.config.indicatorsConfig?.requiredCandles || 493
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
    await this.oiSnapshotService.refreshCurrent(symbol)
  }

  /**
   * 从缓存获取持仓量
   */
  getOI(symbol: string): { value: number; timestamp: number } | undefined {
    const current = this.oiSnapshotService.getCurrent(symbol)
    return current ? { value: current.value, timestamp: current.timestamp } : undefined
  }

  /**
   * 为启用 OI 的策略预热历史序列。
   *
   * 交易对会先去重，并沿用指标中心并发上限；服务内部保证同一交易对成功后只请求一次历史。
   */
  async initializeOIHistory(symbols: string[]): Promise<void> {
    const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)))
    for (let i = 0; i < uniqueSymbols.length; i += this.MAX_CONCURRENT) {
      const batch = uniqueSymbols.slice(i, i + this.MAX_CONCURRENT)
      await Promise.allSettled(batch.map(symbol => this.oiSnapshotService.bootstrapSymbol(symbol)))
    }
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

    // EMA斜率计算周期，默认3
    const emaSlopePeriod = this.config.indicatorsConfig?.emaSlopePeriod ?? 3

    const emaValues = emaPeriods.map((period) => {
      const values = EMA.calculate({ period, values: closes })
      return values[values.length - 1] ?? closes[closes.length - 1]
    })

    const emaSlopes = emaPeriods.map((period) => {
      const values = EMA.calculate({ period, values: closes })
      const currentEMA = values[values.length - 1] ?? closes[closes.length - 1] ?? 0
      const prevIndex = Math.max(0, values.length - 1 - emaSlopePeriod)
      const prevEMA = values[prevIndex] ?? currentEMA
      return prevEMA > 0 ? (currentEMA - prevEMA) / prevEMA : 0
    })

    const emaMap = Object.fromEntries(
      emaPeriods.map((period, index) => [`EMA${period}`, emaValues[index]])
    )

    const emaList = emaPeriods.map((period, index) => ({
      period,
      name: `EMA${period}`,
      value: emaValues[index],
      slope: emaSlopes[index]
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

  // 预计算指标方法已删除 - 现在按需计算

  // ==================== 对外API：获取数据 ====================

  /**
   * 获取指标数据（按需计算并缓存）
   */
  async getIndicators(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType | StatisticsType,
    options?: SupportResistanceOptions & {
      refreshSupportResistance?: boolean
      lookbackMinutes?: number
      trendThresholdPercent?: number
      adxPeriod?: number // ADX计算周期，默认14
      rsiPeriod?: number // RSI计算周期，默认14
      atrPeriod?: number // ATR计算周期，默认14
      macdFastPeriod?: number // MACD快线周期，默认12
      macdSlowPeriod?: number // MACD慢线周期，默认26
      macdSignalPeriod?: number // MACD信号线周期，默认9
    }
  ): Promise<IndicatorData> {
    const symbolData = this.getOrCreateSymbolData(symbol)

    if (type === 'SupportResistance') {
      // 区域由统一预计算刷新；读取只更新价格距离，冷启动/过期仅兜底构建一次。
      const now = Date.now()
      const params = {
        lookback: options?.lookback ?? 96, pivotLeft: options?.pivotLeft ?? 3,
        pivotRight: options?.pivotRight ?? 3, mergeDistanceATR: options?.mergeDistanceATR ?? 0.5,
        minTouches: options?.minTouches ?? 1, breakoutBufferATR: options?.breakoutBufferATR ?? 0.1
      }
      const klines = this.getKlines(symbol, timeframe) || []
      const price = options?.currentPrice ?? klines.at(-1)?.close ?? null
      return {
        symbol, timeframe, timestamp: now,
        values: this.supportResistanceCache.get(`${symbol}:${timeframe}:${shortHash(params)}`, price, now,
          () => calculateSupportResistance(klines, timeframe,
            this.timeframeToMinutes(timeframe) * 60_000, { ...params, now }), options?.refreshSupportResistance)
      }
    }

    if (type === 'MoneyFlow') {
      // 从已加载 K 线计算，沿用 K 线事件驱动更新，避免另建易失效缓存。
      return {
        symbol, timeframe, timestamp: Date.now(),
        values: calculateMoneyFlow(this.getKlines(symbol, timeframe) || [], this.timeframeToMinutes(timeframe) * 60_000)
      }
    }

    if (type === 'EMA') {
      throw new Error(`${symbol} ${timeframe} EMA 需通过 getEMAByPeriods(symbol, timeframe, periods) 获取`)
    }

    if (type === 'OI') {
      // 热重载新增的交易对可能未经过全量初始化；幂等启动确保首次使用前只回填一次历史。
      await this.oiSnapshotService.bootstrapSymbol(symbol)
      const defaultLookbackMinutes = this.timeframeToMinutes(timeframe)
      const lookbackMinutes = Math.max(1, Math.floor(options?.lookbackMinutes ?? defaultLookbackMinutes))
      const oi = this.oiSnapshotService.calculateChange(symbol, lookbackMinutes)
      if (!oi) {
        throw new Error(`${symbol} OI数据未初始化`)
      }

      // OI changePercent 已经是百分数口径，例如 0.4 表示 0.4%。
      const trendThresholdPercent = Math.max(0.1, Number(options?.trendThresholdPercent ?? 0.4))
      const changePercent = oi.changePercent
      let trend: 'increasing' | 'decreasing' | 'flat' = 'flat'

      if (changePercent > trendThresholdPercent) {
        trend = 'increasing'
      } else if (changePercent < -trendThresholdPercent) {
        trend = 'decreasing'
      }

      return {
        symbol,
        timeframe,
        timestamp: oi.current.timestamp,
        values: {
          value: oi.current.value,
          trend: trend,
          changePercent: changePercent,
          // 基准与时间随变化率一起传递，避免AI端另取快照造成口径错位。
          context: {
            lookbackMinutes,
            baselineValue: oi.baseline.openInterest,
            baselineTimestamp: oi.baseline.timestamp,
            updatedAt: oi.current.timestamp,
            trendThresholdPercent
          }
        }
      }
    }

    if (type === 'SquareHeat') {
      // 情绪窗口由策略最大持仓时间决定；纳入缓存键，避免不同策略复用错误窗口
      const windowMinutes = Number(options?.lookbackMinutes ?? 24 * 60)
      const normalizedWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes > 0
        ? Math.floor(windowMinutes)
        : 24 * 60
      const cacheKey = `${symbol}_SquareHeat_${normalizedWindowMinutes}`
      const cached = symbolData.indicators.get(cacheKey)
      // 指标层也必须检查 TTL，否则会绕过 square-heat 工具层一直复用旧结果
      if (cached && Date.now() - cached.timestamp < SQUARE_HEAT_CACHE_TTL_MS) {
        return cached
      }
      if (cached) symbolData.indicators.delete(cacheKey)

      const heatData = await getSquareHeat(symbol, normalizedWindowMinutes)

      const indicatorData: IndicatorData = {
        symbol,
        timeframe,
        timestamp: heatData.lastUpdated,
        values: {
          heat: heatData.heat,
          postCount: heatData.postCount,
          trend: heatData.trend,
          changePercent: heatData.changePercent,
          historyAvg: heatData.historyAvg,
          bullishCount: heatData.bullishCount,
          bearishCount: heatData.bearishCount,
          neutralCount: heatData.neutralCount,
          directionalCoveragePercent: heatData.directionalCoveragePercent,
          netDirectionalSentimentPercent: heatData.netDirectionalSentimentPercent,
          dataUpdatedAt: heatData.lastUpdated,
        }
      }

      symbolData.indicators.set(cacheKey, indicatorData)
      return indicatorData
    }

    if (type === 'Volume') {
      const cacheKey = `${symbol}_${timeframe}_Volume`
      let volumeData = symbolData.volumeData?.get(timeframe)

      const now = Date.now()
      if (!volumeData || (now - volumeData.timestamp > this.VOLUME_CACHE_TTL)) {
        // 按需计算成交量
        const klines = this.getKlines(symbol, timeframe)
        if (!klines || klines.length < 20) {
          throw new Error(`${symbol} ${timeframe} K线数据不足，无法计算成交量`)
        }

        const currentVolume = klines[klines.length - 1]?.volume || 0
        const prevVolume = klines[klines.length - 2]?.volume || 0
        const averageVolume = klines.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20
        const volumeEmaPeriod = this.getVolumeEmaPeriod()
        const volumeSeries = klines.map(c => c.volume)
        const emaAverage = this.calculateVolumeEma(volumeSeries, volumeEmaPeriod)
        volumeData = {
          current: currentVolume,
          prev: prevVolume,
          average: averageVolume,
          emaAverage,
          emaPeriod: volumeEmaPeriod,
          ratio: averageVolume > 0 ? currentVolume / averageVolume : 0,
          timestamp: now
        }

        if (!symbolData.volumeData) {
          symbolData.volumeData = new Map()
        }
        symbolData.volumeData.set(timeframe, volumeData)
      }

      return {
        symbol,
        timeframe,
        timestamp: volumeData.timestamp,
        values: {
          current: volumeData.current,
          prev: volumeData.prev,
          average: volumeData.average,
          emaAverage: volumeData.emaAverage,
          emaPeriod: volumeData.emaPeriod,
          ratio: volumeData.ratio
        }
      }
    }

    // 技术指标：按参数组合计算并缓存，避免不同策略参数互相覆盖
    const cacheKey = `${symbol}_${timeframe}_${type}_${shortHash(options || {}, 16)}`
    let indicatorData = symbolData.indicators.get(cacheKey)

    if (!indicatorData) {
      const klines = this.getKlines(symbol, timeframe)
      if (!klines || klines.length < 100) {
        throw new Error(`${symbol} ${timeframe} K线数据不足，无法计算${type}`)
      }

      const closes = klines.map(c => c.close)
      const highs = klines.map(c => c.high)
      const lows = klines.map(c => c.low)

      indicatorData = {
        symbol,
        timeframe,
        timestamp: Date.now(),
        values: {}
      }

      switch (type) {
        case 'RSI':
          const rsiPeriod = Number(options?.rsiPeriod ?? 14)
          const rsiValues = RSI.calculate({ period: rsiPeriod, values: closes })
          indicatorData.values = { rsi: rsiValues[rsiValues.length - 1] ?? 50 }
          break

        case 'MACD':
          const macdFastPeriod = Number(options?.macdFastPeriod ?? 12)
          const macdSlowPeriod = Number(options?.macdSlowPeriod ?? 26)
          const macdSignalPeriod = Number(options?.macdSignalPeriod ?? 9)
          const macdValues = MACD.calculate({
            values: closes,
            fastPeriod: macdFastPeriod,
            slowPeriod: macdSlowPeriod,
            signalPeriod: macdSignalPeriod,
            SimpleMAOscillator: false,
            SimpleMASignal: false
          })
          const lastMACD = macdValues[macdValues.length - 1]
          const previousMACD = macdValues[macdValues.length - 2] ?? lastMACD
          const currentMacd = lastMACD?.MACD ?? 0
          const currentSignal = lastMACD?.signal ?? 0
          const currentHistogram = lastMACD?.histogram ?? 0
          const previousMacd = previousMACD?.MACD ?? currentMacd
          const previousSignal = previousMACD?.signal ?? currentSignal
          const previousHistogram = previousMACD?.histogram ?? currentHistogram

          // 最新 K 线包含盘中价格，因此这里的交叉会随未收盘 K 线实时出现或消失。
          const crossover = previousMacd <= previousSignal && currentMacd > currentSignal
            ? 'golden'
            : previousMacd >= previousSignal && currentMacd < currentSignal
              ? 'dead'
              : 'none'
          const histogramTrend = currentHistogram > previousHistogram
            ? 'rising'
            : currentHistogram < previousHistogram
              ? 'falling'
              : 'flat'

          indicatorData.values = {
            macd: currentMacd,
            signal: currentSignal,
            histogram: currentHistogram,
            previousMacd,
            previousSignal,
            previousHistogram,
            crossover,
            histogramTrend
          }
          break

        case 'ATR':
          const atrPeriod = Number(options?.atrPeriod ?? 14)
          const atrValues = ATR.calculate({ period: atrPeriod, high: highs, low: lows, close: closes })
          const lastClose = closes[closes.length - 1] || 0
          const atrValue = atrValues.length > 0 ? atrValues[atrValues.length - 1] : lastClose * 0.01
          indicatorData.values = { atr: atrValue }
          break

        case 'ADX':
          const adxPeriod = Number(options?.adxPeriod ?? 14)
          const adxValues = ADX.calculate({ period: adxPeriod, high: highs, low: lows, close: closes })
          const latestADX = adxValues[adxValues.length - 1]
          const previousDI = adxValues[adxValues.length - 2]
          const currentADX = latestADX?.adx ?? 0
          const adxSlopePeriod = this.config.indicatorsConfig?.adxSlopePeriod ?? 3
          const previousADXIndex = Math.max(0, adxValues.length - 1 - adxSlopePeriod)
          const previousADX = adxValues[previousADXIndex]?.adx ?? currentADX
          const adxSlope = currentADX - previousADX
          indicatorData.values = {
            adx: currentADX,
            adxSlope: adxSlope,
            // 随计算结果返回实际回看窗口，确保看板说明与缓存中的斜率口径一致。
            adxSlopePeriod,
            // 保留 ADX 同次计算的方向指标；数据不足时不输出，避免被误认为有效方向。
            pdi: latestADX?.pdi,
            mdi: latestADX?.mdi,
            // 固定比较上一根 K 线；不沿用 ADX 斜率回看窗口，缺少历史时保持缺失。
            previousPdi: previousDI?.pdi,
            previousMdi: previousDI?.mdi,
            diSpread: latestADX ? latestADX.pdi - latestADX.mdi : undefined,
            // 用绝对差距判断扩大/收窄，避免空头优势增强时被有符号差值误导。
            diGapChange: latestADX && previousDI
              ? Math.abs(latestADX.pdi - latestADX.mdi) - Math.abs(previousDI.pdi - previousDI.mdi)
              : undefined
          }
          break

        default:
          throw new Error(`不支持的指标类型: ${type}`)
      }

      symbolData.indicators.set(cacheKey, indicatorData)
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

    this.updateTimer = setInterval(() => {
      void this.refreshAllData().catch((error: any) => {
        logger.error('IndicatorsHub', `定时刷新数据失败: ${error.message}`)
      })
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
    if (binanceApiGateway.shouldPauseBackgroundWork()) {
      logger.warn('IndicatorsHub', `Binance 请求降级，跳过本轮数据刷新: ${binanceApiGateway.getBackgroundPauseReason()}`)
      return
    }

    if (this.isRefreshingAllData) {
      logger.warn('IndicatorsHub', '上一轮数据刷新尚未完成，跳过本轮刷新')
      return
    }

    const symbols = Array.from(this.symbolDataCache.keys())
    if (symbols.length === 0) return

    this.isRefreshingAllData = true
    try {
      this.oiSnapshotService.pruneExpiredHistory()
      // logger.info('IndicatorsHub', `开始刷新 ${symbols.length} 个交易对的数据...`)
      const startTime = Date.now()

      for (let i = 0; i < symbols.length; i += this.MAX_CONCURRENT) {
        if (binanceApiGateway.shouldPauseBackgroundWork()) {
          break
        }
        const batch = symbols.slice(i, i + this.MAX_CONCURRENT)
        await Promise.allSettled(
          batch.map(symbol => this.refreshSymbolData(symbol))
        )
      }

      const duration = Date.now() - startTime
      // logger.info('IndicatorsHub', `数据刷新完成，耗时 ${duration}ms`)
    } finally {
      this.isRefreshingAllData = false
    }
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

      // 3. 清除指标缓存 - 注意：getKlines 已经在文件更新时调用了 invalidateIndicatorsCache
      // 这里不需要再清除所有指标缓存，避免不必要的重新计算
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
    oi: ReturnType<OISnapshotService['getStatus']>
  } {
    return {
      size: this.symbolDataCache.size,
      symbols: Array.from(this.symbolDataCache.keys()),
      oi: this.oiSnapshotService.getStatus()
    }
  }

  /**
   * 获取单个交易对的 OI 内存诊断信息，不返回内部历史数组的可变引用。
   */
  getOIDiagnostics(symbol: string, lookbackMinutes: number) {
    return this.oiSnapshotService.getSymbolDiagnostics(symbol, lookbackMinutes)
  }

  /**
   * 停止后台刷新并清空 OI 内存状态。
   */
  shutdown(): void {
    this.stopUpdateLoop()
    this.oiSnapshotService.close()
  }

  // ==================== 周期角色分配（用于止盈止损）====================

  /**
   * 分配周期角色
   */
  private assignTimeframeRoles(timeframes: Timeframe[]) {
    const sorted = [...timeframes].sort((a, b) => {
      const order: Record<string, number> = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '1d': 5 }
      return (order[a] || 0) - (order[b] || 0)
    })
    if (sorted.length === 1) {
      return [{ tf: sorted[0], role: 'entry' as const }]
    }
    return [
      { tf: sorted[0], role: 'entry' as const },
      ...sorted.slice(1).map(tf => ({ tf, role: 'trend' as const }))
    ]
  }

  // ==================== 单周期指标计算（用于止盈止损）====================

  /**
   * 从策略配置的 timeframes 中选择 entry 周期来计算指标（用于止盈止损）
   * 只计算止盈止损需要的：rsi、adxSlope 和 emaSlope
   */
  async getIndicatorsForRiskManagement(
    symbol: string,
    strategyTimeframes: Timeframe[],
    minEmaPeriod: number = 50
  ): Promise<{ rsi: number; adxSlope: number; emaSlope: number }> {
    try {
      // 1. 分配周期角色，找到 entry 周期
      const roles = this.assignTimeframeRoles(strategyTimeframes)
      const entryRole = roles.find((r: any) => r.role === 'entry')
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

      // EMA 斜率（使用策略最小周期）
      const emaValues = EMA.calculate({ period: minEmaPeriod, values: closes })
      const currentEMA = emaValues[emaValues.length - 1] ?? closes[closes.length - 1] ?? 0
      const emaSlopePeriod = this.config.indicatorsConfig?.emaSlopePeriod ?? 3
      const prevEMAIndex = Math.max(0, emaValues.length - 1 - emaSlopePeriod)
      const prevEMA = emaValues[prevEMAIndex] ?? currentEMA
      const emaSlope = prevEMA > 0 ? (currentEMA - prevEMA) / prevEMA : 0

      return { rsi, adxSlope, emaSlope }
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
   * 刷新单个交易对和周期的数据（事件驱动）
   * 
   * 注意：getKLineFileMTime 已修复为返回复合标识（timestamp + volume），
   * 现在能感知 volume 变化。但事件驱动路径仍需强制重新加载以确保实时性。
   */
  private async refreshSymbolTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    try {
      const symbolData = this.symbolDataCache.get(symbol)
      if (!symbolData) return

      // 1. 强制重新加载该周期的 K线（绕过文件修改时间检测）
      const mappedTimeframe = this.TIMEFRAME_MAP[timeframe]
      if (mappedTimeframe) {
        const limit = this.config.indicatorsConfig?.requiredCandles || 493
        const klines = getSimpleKLineAsOHLCV(symbol, mappedTimeframe, limit)
        if (klines.length > 0) {
          symbolData.klineData.set(timeframe, klines)
          // 更新文件修改时间记录，保持一致性
          const mtime = getKLineFileMTime(symbol, mappedTimeframe)
          if (mtime) {
            this.fileMTimes.set(`${symbol}_${timeframe}`, mtime)
          }
        }
      }

      // 2. 清除该周期的技术指标缓存（关键修复：确保指标值随K线更新而重新计算）
      this.invalidateIndicatorsCache(symbol, timeframe)

      // 3. 重新计算该周期的成交量指标
      const klines = symbolData.klineData.get(timeframe)
      if (klines && klines.length > 0) {
        const currentVolume = klines[klines.length - 1]?.volume || 0
        const prevVolume = klines[klines.length - 2]?.volume || 0
        const averageVolume = klines.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20
        const volumeEmaPeriod = this.getVolumeEmaPeriod()
        const volumeSeries = klines.map(c => c.volume)
        const emaAverage = this.calculateVolumeEma(volumeSeries, volumeEmaPeriod)
        const now = Date.now()
        const volumeData = {
          current: currentVolume,
          prev: prevVolume,
          average: averageVolume,
          emaAverage,
          emaPeriod: volumeEmaPeriod,
          ratio: averageVolume > 0 ? currentVolume / averageVolume : 0,
          timestamp: now
        }
        
        if (!symbolData.volumeData) {
          symbolData.volumeData = new Map()
        }
        symbolData.volumeData.set(timeframe, volumeData)
      }

      // logger.info('IndicatorsHub', `${symbol} ${timeframe} 数据已刷新（事件驱动）`)
    } catch (error: any) {
      logger.error('IndicatorsHub', `${symbol} ${timeframe} 数据刷新失败: ${error.message}`)
    }
  }
}
