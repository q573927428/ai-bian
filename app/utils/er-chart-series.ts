// ==================== 已收盘趋势效率 ER 图表序列 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import type { Timeframe } from '../../types/strategy'
import { calculateEfficiencyRatio, normalizeERPeriod } from '../../shared/utils/efficiency-ratio.ts'

/** 每点对应该根收盘后的 ER；盘中、预热及断档留空，不借用未来数据。 */
export function calculateErChartSeries(bars: SimpleKLineData[], timeframe: Timeframe, step: number, now = Date.now(), period = 20): Array<number | null> {
  const window = normalizeERPeriod(period)
  return bars.map((bar, index) => {
    if (index < window || (bar.t + step) * 1000 > now) return null
    const candles = bars.slice(index - window, index + 1).map(item => ({
      timestamp: item.t * 1000, open: item.o, high: item.h, low: item.l, close: item.c, volume: item.v
    }))
    const snapshot = calculateEfficiencyRatio(candles, timeframe, { period: window, now: (bar.t + step) * 1000 })
    return snapshot.status === 'ready' ? snapshot.er : null
  })
}
