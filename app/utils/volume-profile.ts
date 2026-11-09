// ==================== K线估算价位成交分布 ====================
import type { SimpleKLineData } from '../../types/kline-simple'

/** 等宽价位桶；净额缺失时保留总成交额，禁止把未知方向当成买卖平衡。 */
export interface VolumeProfileBin {
  lower: number
  upper: number
  amount: number
  delta: number | null
}

/** 统计可见K线的成交分布；validBars 用于提示缺失成交额的覆盖范围。 */
export interface VolumeProfile {
  bins: VolumeProfileBin[]
  validBars: number
  totalBars: number
  peakIndex: number
  zone: { lower: number; upper: number } | null
}

/**
 * 将每根K线成交额按价格重叠长度均匀分摊到等宽价位桶。
 * OHLC 无法还原逐笔成交价，因此总额守恒，但分布和主动净额仅为估算。
 */
export function calculateVolumeProfile(bars: SimpleKLineData[], binCount = 48): VolumeProfile {
  const valid = bars.filter(bar => Number.isFinite(bar.l) && Number.isFinite(bar.h) && bar.l > 0
    && bar.h >= bar.l && typeof bar.q === 'number' && Number.isFinite(bar.q) && bar.q >= 0)
  const empty: VolumeProfile = { bins: [], validBars: valid.length, totalBars: bars.length, peakIndex: -1, zone: null }
  if (!valid.length) return empty
  const low = Math.min(...valid.map(bar => bar.l))
  const high = Math.max(...valid.map(bar => bar.h))
  // 全部同价时只需要一个桶，不人为制造不存在的价格范围。
  const count = high === low ? 1 : Math.max(1, Math.min(120, Number.isFinite(binCount) ? Math.floor(binCount) : 48))
  const step = (high - low) / count
  const bins: VolumeProfileBin[] = Array.from({ length: count }, (_, i) => ({
    lower: low + step * i, upper: i === count - 1 ? high : low + step * (i + 1), amount: 0, delta: 0
  }))
  for (const bar of valid) {
    const quote = bar.q!
    const hasDirection = typeof bar.bq === 'number' && Number.isFinite(bar.bq) && bar.bq >= 0 && bar.bq <= quote
    const delta = hasDirection ? 2 * bar.bq! - quote : null
    const pointIndex = step === 0 ? 0 : Math.min(count - 1, Math.floor((bar.l - low) / step))
    for (let i = 0; i < count; i++) {
      const bin = bins[i]!
      const weight = bar.h === bar.l ? (i === pointIndex ? 1 : 0)
        : Math.max(0, Math.min(bar.h, bin.upper) - Math.max(bar.l, bin.lower)) / (bar.h - bar.l)
      if (weight <= 0 || quote === 0) continue
      bin.amount += quote * weight
      // 任一有成交的贡献缺少主动买入额，该桶的完整净额就不可知。
      if (delta === null) bin.delta = null
      else if (bin.delta !== null) bin.delta += delta * weight
    }
  }
  const maxAmount = Math.max(...bins.map(bin => bin.amount))
  if (maxAmount <= 0) return { ...empty, bins }
  const peakIndex = bins.findIndex(bin => bin.amount === maxAmount)
  let first = peakIndex
  let last = peakIndex
  // 只突出最大峰周围连续达到峰值60%的区域，避免把低成交间隙连成密集带。
  while (first > 0 && bins[first - 1]!.amount >= maxAmount * 0.6) first--
  while (last < count - 1 && bins[last + 1]!.amount >= maxAmount * 0.6) last++
  return { bins, validBars: valid.length, totalBars: bars.length, peakIndex,
    zone: { lower: bins[first]!.lower, upper: bins[last]!.upper } }
}
