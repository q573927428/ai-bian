import type { IndicatorConfig, StatisticsConfig, Strategy } from '../../types/strategy'

const ALLOWED_EMA_PERIODS = [7, 14, 20, 30, 50, 60, 120, 200]
const DEFAULT_EMA_PERIODS = [14, 50]

function normalizeEmaPeriods(periods: unknown): number[] {
  const raw = Array.isArray(periods) ? periods : DEFAULT_EMA_PERIODS
  const cleaned = raw
    .map(period => Number(period))
    .filter(period => ALLOWED_EMA_PERIODS.includes(period))
    .sort((a, b) => a - b)

  const unique = Array.from(new Set(cleaned)).slice(0, 3)
  if (unique.length >= 2) return unique
  return DEFAULT_EMA_PERIODS
}

export function normalizeIndicatorConfig(indicators: IndicatorConfig[] = []): IndicatorConfig[] {
  return indicators.map((indicator) => {
    if (indicator.type === 'EMA') {
      return {
        ...indicator,
        params: {
          ...indicator.params,
          periods: normalizeEmaPeriods(indicator.params?.periods)
        }
      }
    }
    if (indicator.type === 'RSI') return { ...indicator, params: { ...indicator.params, period: 14 } }
    if (indicator.type === 'ADX') return { ...indicator, params: { ...indicator.params, period: 14 } }
    if (indicator.type === 'ATR') return { ...indicator, params: { ...indicator.params, period: 14 } }
    if (indicator.type === 'MACD') {
      return {
        ...indicator,
        params: {
          ...indicator.params,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9
        }
      }
    }
    return indicator
  })
}

export function normalizeStatisticsConfig(statistics: StatisticsConfig[] = []): StatisticsConfig[] {
  return statistics.map((stat) => {
    if (stat.type === 'OI') {
      return {
        ...stat,
        params: {
          ...stat.params,
          changePeriod: stat.params?.changePeriod ?? 8,
          trendThresholdPercent: stat.params?.trendThresholdPercent ?? 0.4
        }
      }
    }
    if (stat.type === 'Volume') {
      return {
        ...stat,
        params: {
          ...stat.params,
          comparePeriod: 20
        }
      }
    }
    return stat
  })
}

export function normalizeStrategyIndicatorConfig<T extends Partial<Strategy>>(strategy: T): T {
  if (strategy.indicators) {
    strategy.indicators = normalizeIndicatorConfig(strategy.indicators)
  }
  if (strategy.statistics) {
    strategy.statistics = normalizeStatisticsConfig(strategy.statistics)
  }
  return strategy
}
