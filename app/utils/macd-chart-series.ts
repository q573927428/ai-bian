// ==================== 与服务端同口径的 MACD 图表序列 ====================
import { MACD } from 'technicalindicators'
import type { SimpleKLineData } from '../../types/kline-simple'

/** 按连续收盘价计算 MACD(12,26,9)，预热与缺失值留空；柱值为 DIF−DEA，不乘二。 */
export function calculateMacdChartSeries(bars: SimpleKLineData[], step: number) {
  const result: Array<{ dif: number | null; dea: number | null; histogram: number | null } | null> = bars.map(() => null)
  let start = 0
  const finite = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null
  while (start < bars.length) {
    if (!Number.isFinite(bars[start]!.c)) { start++; continue }
    let end = start + 1
    while (end < bars.length && Number.isFinite(bars[end]!.c) && bars[end]!.t - bars[end - 1]!.t === step) end++
    const values = MACD.calculate({ values: bars.slice(start, end).map(bar => bar.c), fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })
    // DIF 先于 DEA 完成预热，各字段分别保留有效起点并对齐原始时间。
    const offset = end - values.length
    values.forEach((value, index) => { result[offset + index] = { dif: finite(value.MACD), dea: finite(value.signal), histogram: finite(value.histogram) } })
    start = end
  }
  return result
}
