// ==================== 基于交易对聚合的调度器 ====================

import type { Strategy, StrategyId, Timeframe, IndicatorType, StatisticsType } from '../../../types/strategy'
import type { OHLCV } from '../../../types'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'

/**
 * 市场快照：单个交易对的完整市场数据快照
 */
export interface MarketSnapshot {
  symbol: string
  timestamp: number
  price: number
  // 按时间周期分组的指标数据
  indicatorsByTimeframe: Map<Timeframe, Map<string, any>>
  // K线数据
  klinesByTimeframe: Map<Timeframe, OHLCV[]>
}

/**
 * 策略订阅信息
 */
interface StrategySubscription {
  strategy: Strategy
  // 该策略需要的所有时间周期
  requiredTimeframes: Set<Timeframe>
  // 该策略需要的指标类型
  requiredIndicators: Set<IndicatorType | StatisticsType>
}

/**
 * 基于交易对聚合的调度器
 *
 * 核心思想：
 * 1. 先按交易对收集所有订阅的策略
 * 2. 为每个交易对统一构建一次市场快照
 * 3. 将快照扇出给所有订阅该交易对的策略
 *
 * 收益：
 * - 避免重复获取K线和指标
 * - 避免重复调用价格API
 * - 更高效的并发控制
 */
export class SymbolBasedScheduler {
  // 策略订阅关系：symbol -> strategyId[]
  private symbolToStrategies: Map<string, Set<StrategyId>> = new Map()
  
  // 策略订阅详情：strategyId -> StrategySubscription
  private strategySubscriptions: Map<StrategyId, StrategySubscription> = new Map()
  
  // 价格缓存：symbol -> {price, timestamp}
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map()
  
  // 价格缓存有效期（毫秒）
  private readonly PRICE_CACHE_TTL = 5000 // 5秒
  
  private indicatorsHub: IndicatorsHub
  private binance: BinanceService

  constructor(indicatorsHub: IndicatorsHub, binance: BinanceService) {
    this.indicatorsHub = indicatorsHub
    this.binance = binance
  }

  /**
   * 订阅策略
   */
  subscribeStrategy(strategy: Strategy): void {
    const subscription = this.buildStrategySubscription(strategy)
    this.strategySubscriptions.set(strategy.id, subscription)

    // 为每个交易对建立订阅关系
    for (const symbol of strategy.marketData.symbols) {
      if (!this.symbolToStrategies.has(symbol)) {
        this.symbolToStrategies.set(symbol, new Set())
      }
      this.symbolToStrategies.get(symbol)!.add(strategy.id)
    }

    logger.info('SymbolBasedScheduler', `策略已订阅: ${strategy.name} (${strategy.id})`)
  }

  /**
   * 取消订阅策略
   */
  unsubscribeStrategy(strategyId: StrategyId): void {
    const subscription = this.strategySubscriptions.get(strategyId)
    if (!subscription) {
      return
    }

    // 从所有交易对的订阅中移除
    for (const symbol of subscription.strategy.marketData.symbols) {
      this.symbolToStrategies.get(symbol)?.delete(strategyId)
      if (this.symbolToStrategies.get(symbol)?.size === 0) {
        this.symbolToStrategies.delete(symbol)
      }
    }

    this.strategySubscriptions.delete(strategyId)
    logger.info('SymbolBasedScheduler', `策略已取消订阅: ${strategyId}`)
  }

  /**
   * 构建策略订阅详情
   */
  private buildStrategySubscription(strategy: Strategy): StrategySubscription {
    const mainTimeframe = strategy.marketData.timeframes[0] || '15m'
    const requiredTimeframes = new Set<Timeframe>([mainTimeframe])

    // 添加统计数据配置的时间周期
    strategy.statistics
      .filter(s => s.enabled)
      .forEach(s => {
        s.timeframes?.forEach(tf => requiredTimeframes.add(tf))
      })

    const requiredIndicators = new Set<IndicatorType | StatisticsType>([
      ...strategy.indicators.filter(i => i.enabled && i.type !== 'EMA').map(i => i.type),
      ...strategy.statistics.filter(s => s.enabled && s.type !== 'OI').map(s => s.type)
    ])

    return {
      strategy,
      requiredTimeframes,
      requiredIndicators
    }
  }

  /**
   * 获取所有需要处理的交易对
   */
  getActiveSymbols(): string[] {
    return Array.from(this.symbolToStrategies.keys())
  }

  /**
   * 获取订阅某个交易对的所有策略ID
   */
  getStrategiesForSymbol(symbol: string): StrategyId[] {
    const strategyIds = this.symbolToStrategies.get(symbol)
    return strategyIds ? Array.from(strategyIds) : []
  }

  /**
   * 获取策略订阅详情
   */
  getStrategySubscription(strategyId: StrategyId): StrategySubscription | undefined {
    return this.strategySubscriptions.get(strategyId)
  }

  /**
   * 为单个交易对构建市场快照
   */
  async buildMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
    const price = await this.getPrice(symbol)
    // 在价格请求完成后固定取数时点，后续K线进度不随排队和AI等待继续增长。
    const timestamp = Date.now()

    // 获取所有订阅该交易对的策略，合并需要的时间周期。
    // 指标由 StrategyEngine 按策略参数从预计算缓存精确装配，避免在这里执行
    // “全部周期 × 全部指标”的笛卡尔积计算后又被策略级计算覆盖。
    const allTimeframes = new Set<Timeframe>()

    for (const strategyId of this.getStrategiesForSymbol(symbol)) {
      const subscription = this.strategySubscriptions.get(strategyId)
      if (subscription) {
        subscription.requiredTimeframes.forEach(tf => allTimeframes.add(tf))
      }
    }

    const indicatorsByTimeframe = new Map<Timeframe, Map<string, any>>()
    const klinesByTimeframe = new Map<Timeframe, OHLCV[]>()

    // 获取K线数据
    for (const timeframe of allTimeframes) {
      const klines = this.indicatorsHub.getKlines(symbol, timeframe)
      if (klines) {
        // 固定本轮数据，避免后台更新引用后将新指标拼到旧K线中。
        klinesByTimeframe.set(timeframe, klines.map(candle => ({ ...candle })))
      }
    }

    return {
      symbol,
      timestamp,
      price,
      indicatorsByTimeframe,
      klinesByTimeframe
    }
  }

  /**
   * 获取价格（带缓存）
   */
  private async getPrice(symbol: string): Promise<number> {
    const cached = this.priceCache.get(symbol)
    const now = Date.now()

    if (cached && (now - cached.timestamp < this.PRICE_CACHE_TTL)) {
      return cached.price
    }

    const price = await this.binance.fetchPrice(symbol)
    this.priceCache.set(symbol, { price, timestamp: now })
    return price
  }

  /**
   * 清空价格缓存
   */
  clearPriceCache(): void {
    this.priceCache.clear()
  }

  /**
   * 更新策略订阅（策略配置变更时调用）
   */
  updateStrategySubscription(strategy: Strategy): void {
    this.unsubscribeStrategy(strategy.id)
    this.subscribeStrategy(strategy)
  }
}
