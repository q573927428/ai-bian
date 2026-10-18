// ==================== 趋势看板派生指标计算 ====================
import type { TrendPoint } from '../../types/crypto-trends'

/** 七个自然日内已披露流量之和；窗口前不足七天时不生成值，不把缺失日声称为零。 */
export function rollingDisclosedFlows(points: TrendPoint[]): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]
  if (!first) return []
  return sorted.filter(p => Date.parse(p.date) - Date.parse(first.date) >= 6 * 86400000).map(p => ({
    date: p.date,
    value: sorted.filter(row => row.date <= p.date && Date.parse(p.date) - Date.parse(row.date) < 7 * 86400000).reduce((sum, row) => sum + row.value, 0),
  }))
}

/** 仅在存在准确的 30 日前基准且非零时计算变化率，不以附近日期代替。 */
export function changeOver30Days(points: TrendPoint[]): TrendPoint[] {
  const lookup = new Map(points.map(p => [p.date, p.value]))
  return points.flatMap(p => {
    const previous = lookup.get(new Date(Date.parse(p.date) - 30 * 86400000).toISOString().slice(0, 10))
    return previous !== undefined && previous > 0 ? [{ date: p.date, value: (p.value / previous - 1) * 100 }] : []
  })
}
