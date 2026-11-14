// ==================== 恐慌贪婪与期权偏斜历史解析 ====================
import type { SkewTenor, TrendPoint } from '../../types/crypto-trends'
import { beijingDate } from '../../app/utils/beijing-time.ts'

/** 统一日期校验与去重；缺失值不补零，期权偏斜允许负值。 */
function dailyPoints(rows: Array<{ timestamp: number; value: number }>, now: number): TrendPoint[] {
  const points = new Map<string, number>()
  for (const row of rows) {
    if (!Number.isFinite(row.timestamp) || row.timestamp <= 0 || row.timestamp * 1000 > now || !Number.isFinite(row.value)) continue
    const date = beijingDate(row.timestamp * 1000)
    if (points.has(date)) throw new Error('同日情绪数据重复')
    points.set(date, row.value)
  }
  if (!points.size) throw new Error('情绪历史为空')
  return [...points].sort(([a], [b]) => a.localeCompare(b)).slice(-400).map(([date, value]) => ({ date, value }))
}

/** Alternative.me 最新值与历史共享一次下载；拒绝空值被 Number 转为零。 */
export function parseFearGreed(data: any, now = Date.now()): TrendPoint[] {
  if (!Array.isArray(data?.data)) throw new Error('恐慌贪婪历史格式异常')
  return dailyPoints(data.data.filter((row: any) => /^\d+$/.test(String(row?.value)) && Number(row.value) <= 100)
    .map((row: any) => ({ timestamp: Number(row.timestamp), value: Number(row.value) })), now)
}

/** 每个到期期限独立取序列，不能像美元持仓那样把不同期限相加。 */
export function parseOptionSkew(data: any, asset: 'btc' | 'eth', tenor: SkewTenor, now = Date.now()): TrendPoint[] {
  const name = `${asset === 'btc' ? 'BTC' : 'ETH'} Twenty Five Delta Option Skew`
  const rows = data?.Series?.[`${tenor} Day Exp`]?.Data
  if (data?.Description !== name || data.Frequency !== 'Daily' || !Array.isArray(rows)) throw new Error('期权偏斜历史格式异常')
  return dailyPoints(rows.map((row: any) => ({ timestamp: row?.Timestamp, value: typeof row?.Result === 'number' ? row.Result : NaN })), now)
}
