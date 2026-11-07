// ==================== 按完整 5m K 线聚合看板成交额 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import type { BreadthPeriod } from '../../types/market-breadth'

/** 汇总截至 windowEnd（毫秒、不含）的滚动成交额；必须逐根连续且 q 有效，不使用币数量估算。 */
export function calculatePeriodVolumes(bars: SimpleKLineData[], windowEnd: number): Record<BreadthPeriod, number | null> {
  const byTime = new Map(bars.map(bar => [bar.t, bar]))
  const endSeconds = Math.floor(windowEnd / 1000)
  const windows = { '5m': 1, '15m': 3, '1h': 12, '4h': 48, '24h': 288 } as const
  const result = {} as Record<BreadthPeriod, number | null>
  for (const period of Object.keys(windows) as BreadthPeriod[]) {
    let total = 0
    let complete = true
    for (let index = 1; index <= windows[period]; index++) {
      const quoteVolume = byTime.get(endSeconds - index * 300)?.q
      // 缺额、缺根或负数不能当作零；真实零成交额仍是有效数据。
      if (typeof quoteVolume !== 'number' || !Number.isFinite(quoteVolume) || quoteVolume < 0) {
        complete = false
        break
      }
      total += quoteVolume
    }
    result[period] = complete && Number.isFinite(total) ? total : null
  }
  return result
}
