// ==================== 服务端五周期环境快照 ====================
import type { IndicatorsHub } from '../modules/indicators/IndicatorsHub'
import type { MarketBreadthSnapshot } from '../../types/market-breadth'
import { TREND_PERIODS, periodTrend, buildEnvironmentContext, type PeriodSignals } from '../../app/utils/environment-confidence'

/** 仅使用指标中心本地技术指标，失败保留缺失；不依赖看板打开或额外外部统计请求。 */
export async function loadEnvironmentContext(hub: IndicatorsHub | undefined, symbol: string, breadth: MarketBreadthSnapshot | undefined) {
  const periods: PeriodSignals = {}
  if (hub) {
    await Promise.all(TREND_PERIODS.map(async timeframe => {
      try {
        const [adx, macd] = await Promise.all([
          hub.getIndicators(symbol, timeframe, 'ADX', { adxPeriod: 14 }),
          hub.getIndicators(symbol, timeframe, 'MACD', { macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9 })
        ])
        periods[timeframe] = periodTrend(adx.values, macd.values)
      } catch {
        // 缺失与中性分离，不能让AI将缺失周期当作无方向的有效样本。
        periods[timeframe] = '--'
      }
    }))
  }
  return buildEnvironmentContext(periods, breadth, symbol)
}
