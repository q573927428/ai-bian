// ==================== 宏观区间收益比较与收盘最大回撤 ====================

/** 按实际经过秒数格式化间隔，一年按 365 天折算，未满一年保持原显示。 */
export function formatMacroDuration(seconds: number): string {
  const minutes = Math.floor(Math.abs(seconds) / 60)
  const days = Math.floor(minutes / 1440)
  const years = Math.floor(days / 365)
  return `${years ? `${years}年` : ''}${years ? days % 365 : days}天${Math.floor(minutes % 1440 / 60)}小时${minutes % 60}分钟`
}

/** 按时间顺序计算收盘价峰值至后续谷值的最大跌幅，返回正百分数；无效价格不生成结果。 */
export function maxCloseDrawdown(closes: number[]): number | null {
  if (!closes.length || closes.some(close => !Number.isFinite(close) || close <= 0)) return null
  let peak = closes[0]!
  let maximum = 0
  for (const close of closes) {
    peak = Math.max(peak, close)
    maximum = Math.max(maximum, (peak - close) / peak * 100)
  }
  return maximum
}

/** 计算本市场/BTC 比值的区间涨跌百分比；BTC 必须精确覆盖同一起止日期。 */
export function relativeToBtc(returnPercent: number | undefined, start: number | undefined, end: number | undefined, btc: Map<number, number>): number | null {
  if (returnPercent == null || !Number.isFinite(returnPercent) || start == null || end == null) return null
  const from = btc.get(start), to = btc.get(end)
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null
  return ((1 + returnPercent / 100) / (to / from) - 1) * 100
}
