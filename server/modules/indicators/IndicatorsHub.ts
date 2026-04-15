// ==================== 指标统一获取与缓存中心 ====================

import type {
  IndicatorData,
  IndicatorSubscription,
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
 * 指标统一获取与缓存中心
 *
 * 核心特性：
 * 1. 单例模式 - 全局唯一实例
 * 2. 智能合并 - 多个策略请求相同数据时只获取一次
 * 3. 按需更新 - 根据 K 线周期自动设置 TTL
 * 4. 发布-订阅 - 数据更新后自动通知所有订阅策略
 * 5. 请求去重 - 防止缓存击穿
 * 6. LRU 淘汰 - 限制最大缓存条目数
 * 7. 降级策略 - API 失败时返回缓存
 */
export class IndicatorsHub {
  private static instance: IndicatorsHub | null = null

  // 依赖
  private binance: BinanceService
  private config?: BotConfig

  // 缓存层
  private cache: Map<string, CachedData> = new Map()

  // 进行中的请求（用于去重）
  private pendingRequests: Map<string, Promise<any>> = new Map()

  // 订阅者管理: cacheKey -> Set<strategyId>
  private subscribers: Map<string, Set<StrategyId>> = new Map()

  // 策略订阅配置: strategyId -> IndicatorSubscription
  private subscriptions: Map<StrategyId, IndicatorSubscription> = new Map()

  // 最大缓存条目数
  private readonly MAX_CACHE_SIZE: number = 200

  // 默认 TTL (毫秒)
  private readonly DEFAULT_TTL: number = 60 * 1000 // 1分钟

  // K线周期对应的 TTL (毫秒)
  private readonly TIMEFRAME_TTL: Record<Timeframe, number> = {
    '15m': 15 * 60 * 1000,  // 15分钟
    '1h': 60 * 60 * 1000,   // 1小时
    '4h': 4 * 60 * 60 * 1000, // 4小时
    '1d': 24 * 60 * 60 * 1000 // 1天
  }

  // 定时更新定时器
  private updateTimer: NodeJS.Timeout | null = null

  // 事件回调存储
  private eventCallbacks: Map<string, Function[]> = new Map()

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(binance: BinanceService, config?: BotConfig) {
    this.binance = binance
    this.config = config
    logger.info('IndicatorsHub', '指标统一获取中心已初始化')
  }

  /**
   * 获取单例实例
   */
  static getInstance(binance: BinanceService, config?: BotConfig): IndicatorsHub {
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
      IndicatorsHub.instance.clearCache()
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

  // ==================== 订阅管理 ====================

  /**
   * 注册策略对指标的需求
   */
  async subscribe(strategyId: StrategyId, subscription: IndicatorSubscription): Promise<void> {
    this.subscriptions.set(strategyId, subscription)

    // 为每个需要的指标组合注册订阅者
    for (const symbol of subscription.symbols) {
      for (const timeframe of subscription.timeframes) {
        for (const indicatorType of subscription.indicatorTypes) {
          const cacheKey = this.buildCacheKey(symbol, timeframe, indicatorType)

          if (!this.subscribers.has(cacheKey)) {
            this.subscribers.set(cacheKey, new Set())
          }
          this.subscribers.get(cacheKey)!.add(strategyId)
        }
      }

      // 统计数据类型
      for (const statsType of subscription.statisticsTypes || []) {
        const cacheKey = this.buildCacheKey(symbol, '1h', statsType)
        if (!this.subscribers.has(cacheKey)) {
          this.subscribers.set(cacheKey, new Set())
        }
        this.subscribers.get(cacheKey)!.add(strategyId)
      }
    }

    logger.info('IndicatorsHub', `策略 ${strategyId} 已订阅指标`)

    // 预加载数据
    await this.preload(strategyId)
  }

  /**
   * 取消订阅
   */
  unsubscribe(strategyId: StrategyId): void {
    const subscription = this.subscriptions.get(strategyId)
    if (!subscription) return

    // 从所有订阅者中移除
    for (const symbol of subscription.symbols) {
      for (const timeframe of subscription.timeframes) {
        for (const indicatorType of subscription.indicatorTypes) {
          const cacheKey = this.buildCacheKey(symbol, timeframe, indicatorType)
          const subs = this.subscribers.get(cacheKey)
          if (subs) {
            subs.delete(strategyId)
            if (subs.size === 0) {
              this.subscribers.delete(cacheKey)
            }
          }
        }
      }
    }

    // 删除订阅配置
    this.subscriptions.delete(strategyId)

    logger.info('IndicatorsHub', `策略 ${strategyId} 已取消订阅`)
  }

  // ==================== 数据获取 ====================

  /**
   * 获取指标数据（自动去重+缓存）
   */
  async getIndicators(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType | StatisticsType,
    candles?: OHLCV[]
  ): Promise<IndicatorData> {
    const cacheKey = this.buildCacheKey(symbol, timeframe, type)
    const cached = this.cache.get(cacheKey)
    const now = Date.now()

    // 如果缓存有效，直接返回
    if (cached && (now - cached.timestamp < cached.ttl)) {
      // 更新 LRU 顺序
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, cached)
      return cached.data as IndicatorData
    }

    // 检查是否有进行中的请求
    const pendingRequest = this.pendingRequests.get(cacheKey)
    if (pendingRequest) {
      return pendingRequest
    }

    // 创建新请求
    const requestPromise = this.fetchAndCacheIndicators(symbol, timeframe, type, candles)
    this.pendingRequests.set(cacheKey, requestPromise)

    try {
      const result = await requestPromise
      return result
    } finally {
      // 清理进行中的请求标记
      this.pendingRequests.delete(cacheKey)
    }
  }

  /**
   * 批量获取指标数据
   */
  async getBatchIndicators(
    symbol: string,
    timeframes: Timeframe[],
    types: (IndicatorType | StatisticsType)[],
    candles?: OHLCV[]
  ): Promise<Map<string, IndicatorData>> {
    const results = new Map<string, IndicatorData>()

    const promises = timeframes.flatMap(tf =>
      types.map(async type => {
        const data = await this.getIndicators(symbol, tf, type, candles)
        const key = `${tf}_${type}`
        results.set(key, data)
      })
    )

    await Promise.allSettled(promises)
    return results
  }

  /**
   * 预加载数据（在策略启动时批量加载）
   */
  async preload(strategyId: StrategyId): Promise<void> {
    const subscription = this.subscriptions.get(strategyId)
    if (!subscription) {
      logger.warn('IndicatorsHub', `策略 ${strategyId} 未订阅任何指标`)
      return
    }

    logger.info('IndicatorsHub', `开始预加载策略 ${strategyId} 的指标数据...`)
    const startTime = Date.now()

    // 并行加载所有需要的指标
    const promises: Promise<void>[] = []

    for (const symbol of subscription.symbols) {
      for (const timeframe of subscription.timeframes) {
        for (const indicatorType of subscription.indicatorTypes) {
          promises.push(
            this.getIndicators(symbol, timeframe, indicatorType)
              .then(() => {})
              .catch(err => logger.warn('IndicatorsHub', `预加载 ${symbol} ${timeframe} ${indicatorType} 失败: ${err.message}`))
          )
        }
      }

      // 统计数据
      for (const statsType of subscription.statisticsTypes || []) {
        promises.push(
          this.getIndicators(symbol, '1h', statsType)
            .then(() => {})
            .catch(err => logger.warn('IndicatorsHub', `预加载 ${symbol} ${statsType} 失败: ${err.message}`))
        )
      }
    }

    await Promise.allSettled(promises)

    const duration = Date.now() - startTime
    logger.info('IndicatorsHub', `策略 ${strategyId} 预加载完成，耗时 ${duration}ms`)
  }

  // ==================== 内部方法 ====================

  /**
   * 获取并缓存指标
   */
  private async fetchAndCacheIndicators(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType | StatisticsType,
    candles?: OHLCV[]
  ): Promise<IndicatorData> {
    try {
      let data: any

      if (type === 'OI') {
        // OI 持仓量
        data = await this.fetchOI(symbol)
      } else if (type === 'Volume') {
        // 成交量
        data = await this.fetchVolume(symbol, candles)
      } else {
        // 技术指标 (EMA, RSI, MACD, ATR)
        data = await this.fetchTechnicalIndicators(symbol, timeframe, type, candles)
      }

      const indicatorData: IndicatorData = {
        symbol,
        timeframe: timeframe as Timeframe,
        timestamp: Date.now(),
        values: data
      }

      // 缓存数据
      this.setCache(symbol, timeframe, type, indicatorData)

      // 通知订阅者
      this.notifySubscribers(symbol, timeframe, type, indicatorData)

      return indicatorData
    } catch (error: any) {
      logger.error('IndicatorsHub', `获取指标失败 ${symbol} ${timeframe} ${type}: ${error.message}`)

      // 尝试返回过期缓存
      const cacheKey = this.buildCacheKey(symbol, timeframe, type)
      const cached = this.cache.get(cacheKey)
      if (cached) {
        logger.warn('IndicatorsHub', `${symbol} 使用过期缓存`)
        return cached.data as IndicatorData
      }

      throw error
    }
  }

  /**
   * 获取技术指标
   */
  private async fetchTechnicalIndicators(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType,
    candles?: OHLCV[]
  ): Promise<any> {
    // 如果没有提供 K 线数据，从交易所获取
    if (!candles) {
      candles = await this.binance.fetchOHLCV(symbol, timeframe, undefined, 300)
    }

    // 调用现有的指标计算函数
    const indicators = await calculateIndicators(this.binance, symbol, this.config, candles)

    // 根据类型返回对应数据
    switch (type) {
      case 'EMA':
        return {
          // 动态EMA配置
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
      case 'MACD':
        // 如果现有指标中没有 MACD，可以在这里扩展
        return { macd: null, signal: null, histogram: null }
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
        return indicators
    }
  }

  /**
   * 获取 OI 持仓量
   */
  private async fetchOI(symbol: string): Promise<any> {
    const oiData = await this.binance.fetchOpenInterest(symbol)
    return {
      value: oiData.openInterest,
      trend: 'flat', // 需要根据历史数据计算
      changePercent: 0
    }
  }

  /**
   * 获取成交量
   */
  private async fetchVolume(symbol: string, candles?: OHLCV[]): Promise<any> {
    if (!candles) {
      candles = await this.binance.fetchOHLCV(symbol, '1h', undefined, 100)
    }

    const currentVolume = candles![candles!.length - 1]?.volume || 0
    const averageVolume = candles!.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20

    return {
      current: currentVolume,
      average: averageVolume,
      ratio: averageVolume > 0 ? currentVolume / averageVolume : 0
    }
  }

  // ==================== 缓存管理 ====================

  /**
   * 设置缓存（带 LRU 淘汰）
   */
  private setCache(
    symbol: string,
    timeframe: Timeframe,
    type: string,
    data: IndicatorData
  ): void {
    const cacheKey = this.buildCacheKey(symbol, timeframe, type)
    const ttl = this.calculateTTL(timeframe)

    // 如果已存在，先删除
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey)
    }

    // 检查缓存大小，超出限制则淘汰最旧的条目
    while (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    // 插入新缓存
    this.cache.set(cacheKey, {
      key: cacheKey,
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * 计算 TTL（根据 K 线周期）
   */
  private calculateTTL(timeframe: Timeframe): number {
    return this.TIMEFRAME_TTL[timeframe] || this.DEFAULT_TTL
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(
    symbol: string,
    timeframe: Timeframe,
    type: string
  ): string {
    return `${symbol}_${timeframe}_${type}`
  }

  /**
   * 清除缓存
   */
  clearCache(symbol?: string): void {
    if (symbol) {
      // 清除指定交易对的所有缓存
      const keysToDelete: string[] = []
      for (const [key] of this.cache) {
        if (key.startsWith(symbol)) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => this.cache.delete(key))
    } else {
      // 清除所有缓存
      this.cache.clear()
      this.pendingRequests.clear()
      logger.info('IndicatorsHub', '已清除所有缓存')
    }
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): {
    size: number
    maxSize: number
    subscribers: number
    pendingRequests: number
  } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      subscribers: this.subscribers.size,
      pendingRequests: this.pendingRequests.size
    }
  }

  // ==================== 事件通知 ====================

  /**
   * 通知订阅者
   */
  private notifySubscribers(
    symbol: string,
    timeframe: Timeframe,
    type: string,
    data: IndicatorData
  ): void {
    const cacheKey = this.buildCacheKey(symbol, timeframe, type)
    const strategyIds = this.subscribers.get(cacheKey)

    if (strategyIds && strategyIds.size > 0) {
      // 触发事件回调
      const callbacks = this.eventCallbacks.get(cacheKey)
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(data)
          } catch (error: any) {
            logger.error('IndicatorsHub', `事件回调执行失败: ${error.message}`)
          }
        })
      }

      logger.info('IndicatorsHub', `已通知 ${strategyIds.size} 个策略: ${cacheKey}`)
    }
  }

  /**
   * 注册事件回调
   */
  on(cacheKey: string, callback: Function): void {
    if (!this.eventCallbacks.has(cacheKey)) {
      this.eventCallbacks.set(cacheKey, [])
    }
    this.eventCallbacks.get(cacheKey)!.push(callback)
  }

  /**
   * 移除事件回调
   */
  off(cacheKey: string, callback: Function): void {
    const callbacks = this.eventCallbacks.get(cacheKey)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
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
      await this.refreshStaleData()
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
   * 刷新过期数据
   */
  private async refreshStaleData(): Promise<void> {
    const now = Date.now()
    const staleKeys: string[] = []

    // 找出过期的缓存
    for (const [key, value] of this.cache) {
      if (now - value.timestamp >= value.ttl) {
        staleKeys.push(key)
      }
    }

    if (staleKeys.length === 0) return

    logger.info('IndicatorsHub', `发现 ${staleKeys.length} 个过期缓存，准备刷新`)

    // 并行刷新（限制并发数）
    const batchSize = 10
    for (let i = 0; i < staleKeys.length; i += batchSize) {
      const batch = staleKeys.slice(i, i + batchSize)
      await Promise.allSettled(
        batch.map(async key => {
          const parts = key.split('_')
          if (parts.length >= 3) {
            const symbol = parts[0]!
            const timeframe = parts[1] as Timeframe
            const type = parts.slice(2).join('_')
            await this.getIndicators(symbol, timeframe, type as any)
          }
        })
      )
    }
  }

  // ==================== 订阅者查询 ====================

  /**
   * 获取策略的订阅配置
   */
  getSubscription(strategyId: StrategyId): IndicatorSubscription | undefined {
    return this.subscriptions.get(strategyId)
  }

  /**
   * 获取所有订阅者
   */
  getAllSubscribers(): Map<StrategyId, IndicatorSubscription> {
    return new Map(this.subscriptions)
  }

  /**
   * 获取指定缓存键的订阅者
   */
  getSubscribers(cacheKey: string): Set<StrategyId> | undefined {
    return this.subscribers.get(cacheKey)
  }
}
