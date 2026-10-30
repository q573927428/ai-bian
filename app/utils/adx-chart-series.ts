// ==================== 与服务端同口径的 ADX / DI 图表序列 ====================
import { ADX } from 'technicalindicators'
import type { SimpleKLineData } from '../../types/kline-simple'

/** 按连续有效历史分段计算，预热区间保持空值，避免伪造零值或跨缺口连接。 */
export function calculateAdxChartSeries(bars: SimpleKLineData[], step: number, period = 14) {
  const result: Array<{ adx: number; pdi: number; mdi: number } | null> = bars.map(() => null)
  let start = 0
  while (start < bars.length) {
    const valid = (index: number) => [bars[index]!.h, bars[index]!.l, bars[index]!.c].every(Number.isFinite)
    if (!valid(start)) { start++; continue }
    let end = start + 1
    while (end < bars.length && valid(end) && bars[end]!.t - bars[end - 1]!.t === step) end++
    const segment = bars.slice(start, end)
    const values = ADX.calculate({ period, high: segment.map(bar => bar.h), low: segment.map(bar => bar.l), close: segment.map(bar => bar.c) })
    // technicalindicators 省略预热部分；按结果长度对齐到该连续区间尾部。
    const offset = end - values.length
    values.forEach((value, index) => {
      if ([value.adx, value.pdi, value.mdi].every(Number.isFinite)) result[offset + index] = value
    })
    start = end
  }
  return result
}
