// ==================== 趋势看板所选区间统计 ====================
import type { TrendPoint } from '../../types/crypto-trends'
import { beijingDate } from './beijing-time.ts'

/** 区间原始观测的统计；空区间返回null，不将未披露日期或盘中展示快照补入累计。 */
export interface TrendWindowSummary {
  first: TrendPoint | null
  last: TrendPoint | null
  count: number
  total: number | null
  average: number | null
  change: number | null
}

/** 按北京时间可视日历筛选原始数据，变化率比较区间首尾有效值，不借用区间外数据。 */
export function summarizeTrendWindow(points: TrendPoint[], days: number, end = beijingDate()): TrendWindowSummary {
  const start = Date.parse(end) - (days - 1) * 86400000
  const rows = points.filter(point => Number.isFinite(point.value) && Date.parse(point.date) >= start && point.date <= end && !point.disclosedDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  const first = rows[0] ?? null, last = rows.at(-1) ?? null
  const total = rows.length ? rows.reduce((sum, point) => sum + point.value, 0) : null
  return {
    first, last, count: rows.length, total,
    average: total === null ? null : total / rows.length,
    change: rows.length > 1 && first!.value > 0 ? (last!.value / first!.value - 1) * 100 : null,
  }
}

/** 标题美元数值紧凑显示，明确正负净流入；空值不能显示为零。 */
export function formatTrendAmount(value: number | null): string {
  if (value === null) return '--'
  const amount = Math.abs(value)
  const scale = amount >= 1e12 ? 1e12 : amount >= 1e9 ? 1e9 : amount >= 1e6 ? 1e6 : amount >= 1e3 ? 1e3 : 1
  const suffix = scale === 1e12 ? 'T' : scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : ''
  return `${value < 0 ? '-' : ''}$${(amount / scale).toFixed(2)}${suffix}`
}

/** 变化率带方向，百分比和偏斜均值保留各自单位；四舍五入后不显示负零。 */
export function formatTrendNumber(value: number | null, unit = '%', signed = false): string {
  if (value === null) return '--'
  const rounded = Number(value.toFixed(1))
  return `${signed && rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${unit}`
}
