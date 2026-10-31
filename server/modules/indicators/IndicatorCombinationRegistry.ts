import type {
  IndicatorData,
  IndicatorType,
  StatisticsType,
  Strategy,
  StrategyId,
  Timeframe
} from '../../../types/strategy'
import { shortHash, stableStringify } from '../../utils/stable-hash'

export interface IndicatorCombination {
  key: string
  symbol: string
  timeframe: Timeframe
  type: IndicatorType | StatisticsType
  params: Record<string, any>
}

export interface StrategyIndicatorBinding {
  strategyId: StrategyId
  symbol: string
  mainTimeframe: Timeframe
  keys: {
    ema?: string
    rsi?: string
    adx?: string
    macd?: string
    atr?: string
    oi?: string
    volume?: string
    squareHeat?: string
  }
}

const timeframeOrder: Record<Timeframe, number> = {
  '5m': 1,
  '15m': 2,
  '1h': 3,
  '4h': 4,
  '1d': 5
}

function pickMainTimeframe(timeframes: Timeframe[] = []): Timeframe {
  return [...timeframes].sort((a, b) => timeframeOrder[a] - timeframeOrder[b])[0] || '15m'
}

function keyPartFromParams(params: Record<string, any>): string {
  return shortHash(params, 16)
}

export class IndicatorCombinationRegistry {
  private combinations = new Map<string, IndicatorCombination>()
  private bindings = new Map<string, StrategyIndicatorBinding>()

  rebuildFromStrategies(strategies: Strategy[]): void {
    this.combinations.clear()
    this.bindings.clear()

    for (const strategy of strategies.filter(strategy => strategy.isActive)) {
      const mainTimeframe = pickMainTimeframe(strategy.marketData.timeframes)
      for (const symbol of strategy.marketData.symbols || []) {
        const binding: StrategyIndicatorBinding = {
          strategyId: strategy.id,
          symbol,
          mainTimeframe,
          keys: {}
        }

        for (const indicator of strategy.indicators.filter(indicator => indicator.enabled)) {
          // ER 按扫描时刻即时判断已收盘窗口，不进入五分钟预计算缓存。
          if (indicator.type === 'ER') continue
          // 支撑阻力在下方按主周期及看板默认周期统一注册。
          if (indicator.type === 'SupportResistance') continue
          const timeframe = indicator.timeframes?.[0] || mainTimeframe
          const params = this.normalizeIndicatorParams(indicator.type, indicator.params)
          const key = this.register(symbol, timeframe, indicator.type, params)
          if (indicator.type === 'EMA') binding.keys.ema = key
          if (indicator.type === 'RSI') binding.keys.rsi = key
          if (indicator.type === 'ADX') binding.keys.adx = key
          if (indicator.type === 'MACD') binding.keys.macd = key
          if (indicator.type === 'ATR') binding.keys.atr = key
        }

        // 看板提供五周期结构，全部按默认参数预计算；相同组合跨策略自动去重。
        for (const timeframe of Object.keys(timeframeOrder) as Timeframe[]) {
          this.register(symbol, timeframe, 'SupportResistance', {})
        }
        const structure = strategy.indicators.find(i => i.type === 'SupportResistance')
        if (structure?.enabled) this.register(symbol, mainTimeframe, 'SupportResistance', structure.params)

        for (const stat of strategy.statistics.filter(stat => stat.enabled)) {
          const timeframe = stat.type === 'SquareHeat'
            ? mainTimeframe
            : (stat.timeframes?.[0] || mainTimeframe)
          const params = this.normalizeStatisticParams(stat.type, {
            ...stat.params,
            maxHoldTimeMinutes: strategy.riskManagement?.maxHoldTimeMinutes
          }, timeframe)
          const key = this.register(symbol, timeframe, stat.type, params)
          if (stat.type === 'OI') binding.keys.oi = key
          if (stat.type === 'Volume') binding.keys.volume = key
          if (stat.type === 'SquareHeat') binding.keys.squareHeat = key
        }

        this.bindings.set(this.bindingKey(strategy.id, symbol), binding)
      }
    }
  }

  getCombinations(): IndicatorCombination[] {
    return Array.from(this.combinations.values())
  }

  getBinding(strategyId: StrategyId, symbol: string): StrategyIndicatorBinding | undefined {
    return this.bindings.get(this.bindingKey(strategyId, symbol))
  }

  removeStrategy(strategyId: StrategyId): void {
    for (const key of Array.from(this.bindings.keys())) {
      if (key.startsWith(`${strategyId}:`)) {
        this.bindings.delete(key)
      }
    }
  }

  private bindingKey(strategyId: StrategyId, symbol: string): string {
    return `${strategyId}:${symbol}`
  }

  private register(
    symbol: string,
    timeframe: Timeframe,
    type: IndicatorType | StatisticsType,
    params: Record<string, any>
  ): string {
    const key = `${symbol}:${timeframe}:${type}:${keyPartFromParams(params)}`
    if (!this.combinations.has(key)) {
      this.combinations.set(key, { key, symbol, timeframe, type, params })
    }
    return key
  }

  private normalizeIndicatorParams(type: IndicatorType, params: Record<string, any> = {}): Record<string, any> {
    if (type === 'EMA') {
      const periods = Array.isArray(params.periods) ? params.periods : [14]
      return {
        periods: periods
          .map((period: any) => Number(period))
          .filter((period: number) => Number.isFinite(period) && period >= 2)
          .map((period: number) => Math.floor(period))
          .sort((a: number, b: number) => a - b)
      }
    }
    if (type === 'RSI') return { rsiPeriod: Number(params.period ?? 14) }
    if (type === 'ADX') return { adxPeriod: Number(params.period ?? 14) }
    if (type === 'ATR') return { atrPeriod: Number(params.period ?? 14) }
    if (type === 'MACD') {
      return {
        macdFastPeriod: Number(params.fastPeriod ?? 12),
        macdSlowPeriod: Number(params.slowPeriod ?? 26),
        macdSignalPeriod: Number(params.signalPeriod ?? 9)
      }
    }
    return JSON.parse(stableStringify(params))
  }

  private normalizeStatisticParams(
    type: StatisticsType,
    params: Record<string, any> = {},
    timeframe: Timeframe
  ): Record<string, any> {
    if (type === 'OI') {
      const changePeriod = Math.max(1, Number(params.changePeriod ?? 8))
      return {
        changePeriod,
        lookbackMinutes: changePeriod * this.timeframeToMinutes(timeframe),
        trendThresholdPercent: Number(params.trendThresholdPercent ?? 0.003)
      }
    }
    if (type === 'Volume') return { comparePeriod: Number(params.comparePeriod ?? 20) }
    if (type === 'SquareHeat') {
      const windowMinutes = Number(params.maxHoldTimeMinutes ?? 24 * 60)
      return {
        scope: 'symbol',
        lookbackMinutes: Number.isFinite(windowMinutes) && windowMinutes > 0
          ? Math.floor(windowMinutes)
          : 24 * 60
      }
    }
    return JSON.parse(stableStringify(params))
  }

  private timeframeToMinutes(timeframe: Timeframe): number {
    const minutes: Record<Timeframe, number> = {
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440
    }
    return minutes[timeframe] || 15
  }
}

export const indicatorCombinationRegistry = new IndicatorCombinationRegistry()
