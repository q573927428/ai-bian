// ==================== 已确认价格摆动点与合约 CVD 背离 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import { calculateContractFlow } from './contract-order-flow.ts'

/** 价格摆动点上的常规背离；confirmedIndex 是右侧三根收盘后实际可知的时间。 */
export interface CvdDivergence {
  kind: 'bearish' | 'bullish'
  from: number
  to: number
  confirmedIndex: number
  priceFrom: number
  priceTo: number
  cvdFrom: number
  cvdTo: number
}

/**
 * 比较相邻同类价格摆动点对应的 CVD，不要求 CVD 自身也是局部极值。
 * 高低点左右各三根严格确认，相隔 6～60 根；全部确认窗口必须位于同一完整成交区间。
 * 价格与 CVD 均需通过幅度过滤，阈值为展示降噪规则，不代表统计显著性。
 * 仅识别价格创新高/CVD 降低、价格创新低/CVD 抬高，不推断反转或生成交易信号。
 */
export function detectCvdDivergences(bars: SimpleKLineData[], intervalSeconds: number, nowSeconds: number): CvdDivergence[] {
  const flow = calculateContractFlow(bars, intervalSeconds)
  const result: CvdDivergence[] = []
  const wing = 3
  let previousHigh: number | undefined
  let previousLow: number | undefined
  for (let i = wing; i + wing < bars.length; i++) {
    const confirm = i + wing
    if (bars[confirm]!.t + intervalSeconds > nowSeconds) break
    const segment = flow.segmentStarts[i]!
    if (segment < 0 || flow.segmentStarts[i - wing] !== segment || flow.segmentStarts[confirm] !== segment) continue
    const current = bars[i]!
    const neighbors = bars.slice(i - wing, confirm + 1).filter((_, offset) => offset !== wing)
    const high = Number.isFinite(current.h) && neighbors.every(bar => Number.isFinite(bar.h) && current.h > bar.h)
    const low = Number.isFinite(current.l) && neighbors.every(bar => Number.isFinite(bar.l) && current.l < bar.l)
    const compare = (previous: number | undefined, kind: CvdDivergence['kind']) => {
      if (previous == null || i - previous < 6 || i - previous > 60 || flow.segmentStarts[previous] !== segment) return
      const priceFrom = kind === 'bearish' ? bars[previous]!.h : bars[previous]!.l
      const priceTo = kind === 'bearish' ? current.h : current.l
      const cvdFrom = flow.cvd[previous]!, cvdTo = flow.cvd[i]!
      // 采用当前已知的最多14根真实波幅均值作尺度，不使用确认时刻之后的数据。
      const volatilityStart = Math.max(segment, i - 13)
      const ranges = bars.slice(volatilityStart, i + 1).map((bar, offset) => {
        const previousClose = bars[volatilityStart + offset - 1]?.c ?? bar.o
        return Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose))
      })
      const meanRange = ranges.reduce((sum, value) => sum + value, 0) / ranges.length
      const priceThreshold = Math.max(Math.abs(priceFrom) * .0015, meanRange * .25)
      const between = flow.delta.slice(previous + 1, i + 1)
      const meanDelta = between.reduce<number>((sum, value) => sum + Math.abs(value!), 0) / between.length
      const turnover = bars.slice(previous + 1, i + 1).reduce((sum, bar) => sum + bar.q!, 0)
      // 不对累计 CVD 本身求百分比，避免累计起点和过零导致阈值失真。
      const cvdThreshold = Math.max(meanDelta * 2, turnover * .03)
      if (!Number.isFinite(priceThreshold) || !Number.isFinite(cvdThreshold)
        || Math.abs(priceTo - priceFrom) < priceThreshold
        || Math.abs(cvdTo - cvdFrom) < cvdThreshold) return
      if (kind === 'bearish' ? priceTo > priceFrom && cvdTo < cvdFrom : priceTo < priceFrom && cvdTo > cvdFrom) {
        result.push({ kind, from: previous, to: i, confirmedIndex: confirm, priceFrom, priceTo, cvdFrom, cvdTo })
      }
    }
    if (high) { compare(previousHigh, 'bearish'); previousHigh = i }
    if (low) { compare(previousLow, 'bullish'); previousLow = i }
  }
  return result
}
