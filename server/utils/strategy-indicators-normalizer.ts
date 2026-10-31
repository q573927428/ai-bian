import type { IndicatorConfig, StatisticsConfig, Strategy, Timeframe } from '../../types/strategy'
import { normalizeERPeriod, normalizeERTimeframes } from '../../shared/utils/efficiency-ratio'

const ALLOWED_EMA_PERIODS = [7, 14, 20, 30, 50, 60, 120, 200]
const DEFAULT_EMA_PERIODS = [14, 50]
const OI_MAX_LOOKBACK_MINUTES = 24 * 60
const OI_UI_MAX_CHANGE_PERIOD = 60
const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440
}

/**
 * 获取指定 OI 周期在 24 小时历史覆盖内允许的最大回看周期数。
 */
export function getMaxOIChangePeriod(timeframe: Timeframe = '1h'): number {
  return Math.max(
    1,
    Math.min(OI_UI_MAX_CHANGE_PERIOD, Math.floor(OI_MAX_LOOKBACK_MINUTES / TIMEFRAME_MINUTES[timeframe]))
  )
}

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
    if (indicator.type === 'ER') {
      return { ...indicator, params: { ...indicator.params, period: normalizeERPeriod(indicator.params?.period) } }
    }
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
      const timeframe = stat.timeframes?.[0] || '1h'
      const maxChangePeriod = getMaxOIChangePeriod(timeframe)
      const rawChangePeriod = Number(stat.params?.changePeriod ?? 8)
      const changePeriod = Number.isFinite(rawChangePeriod)
        ? Math.max(1, Math.min(maxChangePeriod, Math.floor(rawChangePeriod)))
        : Math.min(8, maxChangePeriod)
      return {
        ...stat,
        params: {
          ...stat.params,
          // 后端再次限制总回看窗口，防止 API 请求绕过前端动态上限。
          changePeriod,
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
    // ER 只以策略勾选周期为准；覆盖旧版独立配置，避免保存或回滚后恢复额外周期。
    const mainTimeframe = strategy.marketData?.timeframes?.[0] || '15m'
    strategy.indicators = strategy.indicators.map(indicator => indicator.type === 'ER'
      ? { ...indicator, timeframes: normalizeERTimeframes(strategy.marketData?.timeframes, mainTimeframe) }
      : indicator)
  }
  if (strategy.statistics) {
    strategy.statistics = normalizeStatisticsConfig(strategy.statistics)
  }
  return strategy
}
