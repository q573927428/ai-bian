import type { TechnicalIndicators, BotConfig, OHLCV } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { calculateIndicators } from '../../../utils/indicators'
import { logger } from '../../../utils/logger'

/**
 * 指标缓存服务 - 单例模式
 * 
 * 优化特性：
 * 1. 单例模式 - 确保全局只有一个缓存实例
 * 2. 请求去重 - 防止缓存击穿，同一时刻同一交易对只有一个请求
 * 3. 动态TTL - 配置更新时同步更新缓存过期时间
 * 4. LRU淘汰 - 限制最大缓存条目数，防止内存泄漏
 * 5. 预加载 - 支持启动时预加载所有监控交易对指标
 */
export class IndicatorsCache {
  private static instance: IndicatorsCache | null = null
  
  private binance: BinanceService
  private config?: BotConfig
  
  // 缓存存储
  private cache: Map<string, { indicators: TechnicalIndicators; timestamp: number }> = new Map()
  
  // 进行中的请求（用于去重）
  private pendingRequests: Map<string, Promise<TechnicalIndicators>> = new Map()
  
  // 缓存过期时间（毫秒）- 移除readonly以支持动态更新
  private CACHE_TTL: number
  
  // 最大缓存条目数（LRU策略）
  private readonly MAX_CACHE_SIZE: number = 100

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(binance: BinanceService, config?: BotConfig) {
    this.binance = binance
    this.config = config
    // 使用 positionScanInterval * 1000 作为缓存TTL（毫秒）
    // 确保最小60秒，避免过于频繁的API调用
    const intervalSeconds = config?.positionScanInterval || 60
    this.CACHE_TTL = Math.max(intervalSeconds, 60) * 1000
  }

  /**
   * 获取单例实例
   * @param binance Binance服务实例
   * @param config 机器人配置
   * @returns IndicatorsCache单例
   */
  static getInstance(binance: BinanceService, config?: BotConfig): IndicatorsCache {
    if (!IndicatorsCache.instance) {
      IndicatorsCache.instance = new IndicatorsCache(binance, config)
      logger.info('指标缓存', '指标缓存服务已初始化')
    }
    return IndicatorsCache.instance
  }

  /**
   * 重置单例（仅用于测试或重新初始化）
   */
  static resetInstance(): void {
    if (IndicatorsCache.instance) {
      IndicatorsCache.instance.clearCache()
      IndicatorsCache.instance = null
      logger.info('指标缓存', '指标缓存服务已重置')
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    // 动态更新缓存TTL
    const intervalSeconds = config?.positionScanInterval || 60
    const newTTL = Math.max(intervalSeconds, 60) * 1000
    
    if (newTTL !== this.CACHE_TTL) {
      this.CACHE_TTL = newTTL
      logger.info('指标缓存', `缓存TTL已更新为 ${this.CACHE_TTL / 1000} 秒`)
    }
  }

  /**
   * 更新Binance服务实例
   */
  updateBinance(binance: BinanceService): void {
    this.binance = binance
  }

  /**
   * 获取指标（带缓存和请求去重）
   */
  async getIndicators(symbol: string, candlesMain?: OHLCV[]): Promise<TechnicalIndicators> {
    const cached = this.cache.get(symbol)
    const now = Date.now()

    // 如果缓存有效，直接返回（同时更新访问顺序用于LRU）
    if (cached && (now - cached.timestamp < this.CACHE_TTL)) {
      // 更新LRU顺序：删除后重新插入
      this.cache.delete(symbol)
      this.cache.set(symbol, cached)
      return cached.indicators
    }

    // 检查是否有进行中的请求（防止缓存击穿）
    const pendingRequest = this.pendingRequests.get(symbol)
    if (pendingRequest) {
      return pendingRequest
    }

    // 创建新请求
    const requestPromise = this.fetchAndCacheIndicators(symbol, candlesMain)
    this.pendingRequests.set(symbol, requestPromise)

    try {
      const indicators = await requestPromise
      return indicators
    } finally {
      // 清理进行中的请求标记
      this.pendingRequests.delete(symbol)
    }
  }

  /**
   * 内部方法：获取并缓存指标
   */
  private async fetchAndCacheIndicators(symbol: string, candlesMain?: OHLCV[]): Promise<TechnicalIndicators> {
    try {
      const indicators = await calculateIndicators(this.binance, symbol, this.config, candlesMain)
      this.setCache(symbol, indicators)
      return indicators
    } catch (error: any) {
      // 如果计算失败，尝试返回过期缓存
      const cached = this.cache.get(symbol)
      if (cached) {
        logger.warn('指标缓存', `${symbol} 指标计算失败，使用过期缓存: ${error.message}`)
        return cached.indicators
      }
      throw error
    }
  }

  /**
   * 设置缓存（带LRU淘汰）
   */
  private setCache(symbol: string, indicators: TechnicalIndicators): void {
    // 如果已存在，先删除（用于更新LRU顺序）
    if (this.cache.has(symbol)) {
      this.cache.delete(symbol)
    }

    // 检查缓存大小，超出限制则淘汰最旧的条目
    while (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Map保持插入顺序，第一个就是最旧的
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
        // LRU淘汰日志（静默处理，避免日志过多）
      }
    }

    // 插入新缓存
    this.cache.set(symbol, { indicators, timestamp: Date.now() })
  }

  /**
   * 预加载指标（并行请求所有交易对）
   * @param symbols 交易对列表
   */
  async preloadIndicators(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return

    logger.info('指标缓存', `开始预加载 ${symbols.length} 个交易对的指标数据...`)
    
    const startTime = Date.now()
    const results = await Promise.allSettled(
      symbols.map(symbol => this.getIndicators(symbol))
    )

    // 统计结果
    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    const duration = Date.now() - startTime

    logger.info('指标缓存', 
      `预加载完成: 成功 ${successful}/${symbols.length}, 失败 ${failed}, 耗时 ${duration}ms`
    )
  }

  /**
   * 批量获取指标
   * @param symbols 交易对列表
   * @returns 交易对到指标的映射
   */
  async getBatchIndicators(symbols: string[]): Promise<Map<string, TechnicalIndicators>> {
    const results = new Map<string, TechnicalIndicators>()
    
    await Promise.allSettled(
      symbols.map(async symbol => {
        try {
          const indicators = await this.getIndicators(symbol)
          results.set(symbol, indicators)
        } catch (error) {
          // 忽略单个交易对的错误
        }
      })
    )

    return results
  }

  /**
   * 清除缓存
   */
  clearCache(symbol?: string): void {
    if (symbol) {
      this.cache.delete(symbol)
      // 单个缓存清除（静默处理，避免日志过多）
    } else {
      const size = this.cache.size
      this.cache.clear()
      this.pendingRequests.clear()
      logger.info('指标缓存', `已清除所有缓存 (共 ${size} 条)`)
    }
  }

  /**
   * 使缓存失效（标记为过期但不删除）
   * 下次请求时会重新获取，但如果获取失败可以使用旧数据
   */
  invalidateCache(symbol?: string): void {
    const now = Date.now()
    
    if (symbol) {
      const cached = this.cache.get(symbol)
      if (cached) {
        // 将时间戳设为很久以前，使其过期
        cached.timestamp = 0
      }
    } else {
      // 使所有缓存失效
      for (const [, value] of this.cache) {
        value.timestamp = 0
      }
    }
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { 
    size: number
    maxSize: number
    ttl: number
    pendingRequests: number
    entries: Array<{ symbol: string; age: number; isExpired: boolean }> 
  } {
    const now = Date.now()
    const entries = Array.from(this.cache.entries()).map(([symbol, data]) => ({
      symbol,
      age: now - data.timestamp,
      isExpired: now - data.timestamp >= this.CACHE_TTL
    }))

    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.CACHE_TTL,
      pendingRequests: this.pendingRequests.size,
      entries
    }
  }

  /**
   * 检查特定交易对的缓存是否有效
   */
  isCacheValid(symbol: string): boolean {
    const cached = this.cache.get(symbol)
    if (!cached) return false
    return Date.now() - cached.timestamp < this.CACHE_TTL
  }

  /**
   * 获取缓存的剩余有效时间（毫秒）
   */
  getCacheRemainingTTL(symbol: string): number {
    const cached = this.cache.get(symbol)
    if (!cached) return 0
    
    const remaining = this.CACHE_TTL - (Date.now() - cached.timestamp)
    return Math.max(0, remaining)
  }
}
