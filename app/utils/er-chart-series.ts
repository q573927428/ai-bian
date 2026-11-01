// ==================== 趋势效率 ER 图表序列 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import type { ERTimeframe } from '../../types/efficiency-ratio'
import { calculateEfficiencyRatio, normalizeERPeriod } from './efficiency-ratio.ts'

/** 同一 ER 窗口的趋势效率和有方向的区间涨跌幅。 */
export interface ErChartMetrics {
  er: number | null
  netChangePercent: number | null
}

/** 默认包含盘中 ER；显式 includeOpen=false 可仅展示已收盘柱，预热、未来及断档留空。 */
export function calculateErChartSeries(bars: SimpleKLineData[], timeframe: ERTimeframe, step: number, now = Date.now(), period = 20, options: { includeOpen?: boolean } = {}): Array<number | null> {
  return calculateErChartMetricsSeries(bars, timeframe, step, now, period, options).map(value => value?.er ?? null)
}

/** 一次计算并保留同一窗口的 ER 和净涨跌幅，供默认行情、实时刷新及历史悬停共用。 */
export function calculateErChartMetricsSeries(bars: SimpleKLineData[], timeframe: ERTimeframe, step: number, now = Date.now(), period = 20, options: { includeOpen?: boolean } = {}): Array<ErChartMetrics | null> {
  const window = normalizeERPeriod(period)
  return bars.map((bar, index) => {
    if (index < window || bar.t * 1000 > now || (options.includeOpen === false && (bar.t + step) * 1000 > now)) return null
    const candles = bars.slice(index - window, index + 1).map(item => ({
      timestamp: item.t * 1000, open: item.o, high: item.h, low: item.l, close: item.c, volume: item.v
    }))
    // 历史柱按当时收盘时刻计算，盘中柱使用真实快照时刻，前后端共用同一规则。
    const snapshot = calculateEfficiencyRatio(candles, timeframe, { period: window, now: Math.min(now, (bar.t + step) * 1000) })
    return snapshot.status === 'ready' ? { er: snapshot.er, netChangePercent: snapshot.netChangePercent } : null
  })
}
