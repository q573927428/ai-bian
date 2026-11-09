// ==================== 同期价格比值与实现波动率计算 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import type { TrendPoint } from '../../types/crypto-trends'

/** 同期收盘价格比值；t为周期起始秒数，未结束周期的value使用本地盘中收盘价。 */
export interface RatioPoint { t: number; value: number }

/** 仅比较时间完全一致的有效收盘价；缺失点不插值，零分母和未来行情不参与。 */
export function ratioClosingPrices(left: SimpleKLineData[], right: SimpleKLineData[], now = Date.now() / 1000): RatioPoint[] {
  const valid = (bar: SimpleKLineData) => Number.isFinite(bar.t) && bar.t <= now && Number.isFinite(bar.c) && bar.c > 0
  const denominators = new Map(right.filter(valid).map(bar => [bar.t, bar]))
  return [...new Map(left.filter(valid).flatMap(bar => {
    const other = denominators.get(bar.t)
    if (!other) return []
    const value = bar.c / other.c
    return Number.isFinite(value) && value > 0 ? [[bar.t, { t: bar.t, value }] as const] : []
  })).values()].sort((a, b) => a.t - b.t)
}

/** windowDays个连续日收益的样本标准差，需多一根日线，按365天年化；当日为盘中估算。 */
export function realizedVolatility(bars: SimpleKLineData[], now = Date.now() / 1000, windowDays = 30): TrendPoint[] {
  if (!Number.isInteger(windowDays) || windowDays < 2) return []
  const sorted = [...new Map(bars.map(bar => [bar.t, bar])).values()].sort((a, b) => a.t - b.t)
  return sorted.flatMap((bar, index) => {
    if (index < windowDays || bar.t > now) return []
    const window = sorted.slice(index - windowDays, index + 1)
    if (window.some((row, i) => !Number.isFinite(row.c) || row.c <= 0 || (i > 0 && row.t - window[i - 1]!.t !== 86400))) return []
    const returns = window.slice(1).map((row, i) => Math.log(row.c / window[i]!.c))
    const mean = returns.reduce((sum, value) => sum + value, 0) / windowDays
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (windowDays - 1)
    return [{ date: new Date(bar.t * 1000).toISOString().slice(0, 10), value: Math.sqrt(variance * 365) * 100, provisional: bar.t + 86400 > now }]
  })
}

/** 真实计价资产成交额；当天为累计值，缺失字段不补零，也不用成交量乘收盘价代替。 */
export function dailyQuoteVolumes(bars: SimpleKLineData[], now = Date.now() / 1000): TrendPoint[] {
  return bars.filter(row => row.t <= now && typeof row.q === 'number' && Number.isFinite(row.q) && row.q >= 0)
    .map(row => ({ date: new Date(row.t * 1000).toISOString().slice(0, 10), value: row.q!, provisional: row.t + 86400 > now }))
}
