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

/** 列表使用的最新已确认背离；时间为秒，确认时间取右侧确认柱的收盘时刻。 */
export interface LatestCvdDivergence {
  kind: CvdDivergence['kind']
  confirmedAt: number
  pivotAt: number
}

/** 与图表复用检测规则，仅返回最新确认的一次背离，不把摆动点时间当作发现时间。 */
export function latestCvdDivergence(bars: SimpleKLineData[], intervalSeconds: number, nowSeconds: number): LatestCvdDivergence | undefined {
  const latest = detectCvdDivergences(bars, intervalSeconds, nowSeconds).at(-1)
  if (!latest) return undefined
  return { kind: latest.kind, confirmedAt: bars[latest.confirmedIndex]!.t + intervalSeconds, pivotAt: bars[latest.to]!.t }
}

/** 最近 N 根按当前周期的已收盘时间窗口计数；行情断档不会让历史背离一直保持“最新”。 */
export function isRecentCvdDivergence(signal: LatestCvdDivergence | undefined, intervalSeconds: number, nowSeconds: number, windowBars: number): boolean {
  if (!signal || intervalSeconds <= 0 || windowBars < 1) return false
  const latestClose = Math.floor(nowSeconds / intervalSeconds) * intervalSeconds
  return signal.confirmedAt <= latestClose && signal.confirmedAt > latestClose - windowBars * intervalSeconds
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
