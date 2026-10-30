// ==================== 与服务端同口径的 RSI 图表序列 ====================
import { RSI } from 'technicalindicators'
import type { SimpleKLineData } from '../../types/kline-simple'

/** 连续有效收盘价分段计算 RSI，预热和无效数据留空，不跨历史缺口连线。 */
export function calculateRsiChartSeries(bars: SimpleKLineData[], step: number, period = 14) {
  const result: Array<number | null> = bars.map(() => null)
  let start = 0
  while (start < bars.length) {
    if (!Number.isFinite(bars[start]!.c)) { start++; continue }
    let end = start + 1
    while (end < bars.length && Number.isFinite(bars[end]!.c) && bars[end]!.t - bars[end - 1]!.t === step) end++
    const values = RSI.calculate({ period, values: bars.slice(start, end).map(bar => bar.c) })
    // 库不返回预热区间，按结果长度回填到连续历史尾部以保持时间对齐。
    const offset = end - values.length
    values.forEach((value, index) => { if (Number.isFinite(value)) result[offset + index] = value })
    start = end
  }
  return result
}
