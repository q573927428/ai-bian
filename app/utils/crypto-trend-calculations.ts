// ==================== 趋势看板派生指标计算 ====================
import type { TrendPoint } from '../../types/crypto-trends'
import { beijingDate } from './beijing-time.ts'

/**
 * 北京时间凌晨为仍在更新的币安日线追加今日盘中快照，保留原柱及全部历史。
 * 只投影仍在交易的前一日柱；外部日频指标须显式标记为沿用最近披露值。
 * 此函数仅用于显示，不参与收益、波动率、均线或累计流量的计算。
 */
export function trendDisplayPoints(points: TrendPoint[], now = Date.now(), latestDisclosure = false): TrendPoint[] {
  const last = points.at(-1)
  const today = beijingDate(now)
  if (!last || last.date >= today) return points
  if (latestDisclosure) return [...points, { date: today, value: last.value, disclosedDate: last.date }]
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
  return last.provisional && last.date === yesterday ? [...points, { date: today, value: last.value, provisional: true }] : points
}

/** 在可视区间内取共同有效日期作为零点，避免不同起点造成 BTC / ETH 强弱误判。 */
export function relativePriceChanges(btc: TrendPoint[], eth: TrendPoint[], days: number, end = beijingDate()): [TrendPoint[], TrendPoint[]] {
  const start = Date.parse(end) - (days - 1) * 86400000
  const valid = (rows: TrendPoint[]) => rows.filter(p => Date.parse(p.date) >= start && p.date <= end && Number.isFinite(p.value) && p.value > 0).sort((a, b) => a.date.localeCompare(b.date))
  const left = valid(btc), right = valid(eth)
  const rightDates = new Set(right.map(p => p.date))
  const base = left.find(p => rightDates.has(p.date))?.date
  if (!base) return [[], []]
  // 基准日必须双方都有实际价格；缺失日继续留空，不以前值填补。
  const changes = (rows: TrendPoint[]) => {
    const initial = rows.find(p => p.date === base)!.value
    return rows.filter(p => p.date >= base).map(p => ({ ...p, value: (p.value / initial - 1) * 100 }))
  }
  return [changes(left), changes(right)]
}

/** 相对最新有效日的自然日涨跌幅；准确基准日缺失时返回空值。 */
export function latestDayChange(points: TrendPoint[], days: number): number | null {
  const last = points.at(-1)
  if (!last || !Number.isFinite(last.value) || last.value <= 0) return null
  const date = new Date(Date.parse(last.date) - days * 86400000).toISOString().slice(0, 10)
  const base = points.find(p => p.date === date)
  return base && Number.isFinite(base.value) && base.value > 0 ? (last.value / base.value - 1) * 100 : null
}

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
