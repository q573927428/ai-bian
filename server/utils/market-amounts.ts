// ==================== 公开市场持仓、清算与稳定币供应快照 ====================
import type { MarketAmount } from '../../types/market-overview'
import { recordTrendHistory } from './crypto-trends'

export const MARKET_AMOUNT_KEYS = ['btcOi', 'ethOi', 'longLiquidations', 'shortLiquidations', 'stablecoinSupply'] as const
export type MarketAmountKey = typeof MARKET_AMOUNT_KEYS[number]
const sources = {
  btcOi: { file: 'markets_futures_topbitcoinfuturesoi_daily_other.json', name: 'Top Bitcoin Futures OI' },
  ethOi: { file: 'markets_futures_topetherfuturesoi_daily_other.json', name: 'Top Ether Futures OI' },
  longLiquidations: { file: 'markets_futures_longliquidationsbyexchanges_daily_coinglass.json', name: 'Long liquidations by exchanges' },
  shortLiquidations: { file: 'markets_futures_shortliquidationsbyexchanges_daily_coinglass.json', name: 'Short liquidations by exchanges' },
  stablecoinSupply: { file: 'openfinance_stablecoins_totalstablecoinsupply_daily_defillama.json', name: 'Total Stablecoin Supply' },
} as const

/** 校验数据点与日期，拒绝缺失、负持仓和未来错误日期。 */
function validPoint(value: unknown, timestamp: number, absolute: boolean): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (absolute || value >= 0)
    && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 86_400_000
}

/** 从公开图表完整序列取同日有效值；不混合不同日期，也不把历史已结束序列沿用为今日。 */
export function parseAmountSeries(data: any, name: string, absolute = false): MarketAmount {
  if (data?.Description !== name || data.Frequency !== 'Daily' || !data.Series || typeof data.Series !== 'object') throw new Error('市场图表格式异常')
  const rows: Array<{ name: string; value: number; timestamp: number }> = []
  for (const [seriesName, series] of Object.entries(data.Series) as Array<[string, any]>) {
    if (!Array.isArray(series?.Data)) throw new Error('市场图表序列缺失')
    for (const row of series.Data) {
      if (validPoint(row?.Result, row?.Timestamp * 1000, absolute)) rows.push({ name: seriesName, value: absolute ? Math.abs(row.Result) : row.Result, timestamp: row.Timestamp * 1000 })
    }
  }
  return aggregateLatest(rows)
}

/** 汇总同一最新时间点，重复系列和错误值不能静默变成总额。 */
function aggregateLatest(rows: Array<{ name: string; value: number; timestamp: number }>): MarketAmount {
  const latest = rows.reduce((max, row) => Math.max(max, row.timestamp), 0)
  const selected = rows.filter(row => row.timestamp === latest)
  if (!selected.length || new Set(selected.map(row => row.name)).size !== selected.length) throw new Error('市场数据为空或存在重复系列')
  const usd = selected.reduce((sum, row) => sum + row.value, 0)
  if (!Number.isFinite(usd)) throw new Error('市场汇总金额异常')
  return { usd, date: new Date(latest).toISOString().slice(0, 10), coverage: selected.map(row => row.name) }
}

/** OI 公开元数据仅为已披露交易所快照，刻意不把它标为完整全市场总量。 */
export function parseDisclosedOi(html: string, name: string): MarketAmount {
  const rows: Array<{ name: string; value: number; timestamp: number }> = []
  function visit(node: any): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node['@type'] === 'DataFeedItem' && node.item?.name === name) {
      const timestamp = Date.parse(node.dateModified)
      const metrics = node.item.variableMeasured
      if (!Array.isArray(metrics) || !metrics.length || !metrics.every(row => typeof row?.name === 'string' && validPoint(row.value, timestamp, false))) throw new Error('持仓元数据异常')
      for (const row of metrics) rows.push({ name: row.name, value: row.value, timestamp })
    }
    Object.values(node).forEach(visit)
  }
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data: unknown
    try { data = JSON.parse(script[1]!) } catch { continue }
    visit(data)
  }
  return aggregateLatest(rows)
}

/** 仅请求无需凭证的公开资源，各指标失败交给上层缓存处理。 */
export async function fetchMarketAmount(key: MarketAmountKey): Promise<MarketAmount> {
  const source = sources[key]
  const url = `https://data.tbstat.com/dashboard/${source.file}`
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`The Block HTTP ${response.status}`)
  const data = await response.json()
  const value = parseAmountSeries(data, source.name, key === 'longLiquidations' || key === 'shortLiquidations')
  recordTrendHistory(key, data, source.name)
  return value
}
