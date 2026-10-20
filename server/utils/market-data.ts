// ==================== The Block 日频市场数据来源与解析 ====================
import type { MarketAmount, EtfNetFlow } from '../../types/market-overview'
import { recordTrendHistory } from './crypto-trends'

export const MARKET_AMOUNT_KEYS = ['btcOi', 'ethOi', 'longLiquidations', 'shortLiquidations', 'stablecoinSupply'] as const
export type MarketAmountKey = typeof MARKET_AMOUNT_KEYS[number]
export const MARKET_DATA_SOURCES = {
  btcOi: { file: 'markets_futures_topbitcoinfuturesoi_daily_other.json', name: 'Top Bitcoin Futures OI' },
  ethOi: { file: 'markets_futures_topetherfuturesoi_daily_other.json', name: 'Top Ether Futures OI' },
  longLiquidations: { file: 'markets_futures_longliquidationsbyexchanges_daily_coinglass.json', name: 'Long liquidations by exchanges' },
  shortLiquidations: { file: 'markets_futures_shortliquidationsbyexchanges_daily_coinglass.json', name: 'Short liquidations by exchanges' },
  stablecoinSupply: { file: 'openfinance_stablecoins_totalstablecoinsupply_daily_defillama.json', name: 'Total Stablecoin Supply' },
  btcEtf: { file: 'markets_structuredproducts_btcspotetftotalnetflows_daily_other.json', name: 'BTC Spot ETF Total Net Flows' },
  ethEtf: { file: 'markets_structuredproducts_ethspotetftotalnetflows_daily_other.json', name: 'ETH Spot ETF Total Net Flows' },
} as const
export type MarketDataKey = keyof typeof MARKET_DATA_SOURCES

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

/** 校验美元单日净流入序列；最新日期空值报错保留缓存，不冒充零或回退历史数据。 */
export function parseEtfFlow(data: any, name: string): EtfNetFlow {
  const series = data?.Series?.['Total Net Flow']
  if (data?.Description !== name || data.Frequency !== 'Daily' || !Array.isArray(series?.Data)) throw new Error(`${name} JSON 数据格式异常`)
  let latest: { Timestamp: number; Result: number } | undefined
  for (const row of series.Data) {
    if (typeof row?.Timestamp !== 'number' || !Number.isFinite(row.Timestamp) || row.Timestamp <= 0 || row.Timestamp * 1000 > Date.now() + 86_400_000) continue
    if (!latest || row.Timestamp > latest.Timestamp) latest = row
  }
  if (!latest || typeof latest.Result !== 'number' || !Number.isFinite(latest.Result)) throw new Error(`${name} 缺少有效净流入数据`)
  return { usd: latest.Result, date: new Date(latest.Timestamp * 1000).toISOString().slice(0, 10) }
}

/** 按指标返回对应快照类型，ETF 不包含交易所覆盖字段。 */
export function fetchMarketData(key: MarketAmountKey): Promise<MarketAmount>
export function fetchMarketData(key: 'btcEtf' | 'ethEtf'): Promise<EtfNetFlow>
/** 统一下载公开日频 JSON；解析及历史记录保留各指标独立口径，失败由上层保留缓存。 */
export async function fetchMarketData(key: MarketDataKey): Promise<MarketAmount | EtfNetFlow> {
  const source = MARKET_DATA_SOURCES[key]
  const isEtf = key === 'btcEtf' || key === 'ethEtf'
  const response = await fetch(`https://data.tbstat.com/dashboard/${source.file}`, {
    signal: AbortSignal.timeout(isEtf ? 15_000 : 20_000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!response.ok) throw new Error(`The Block JSON HTTP ${response.status}`)
  const data = await response.json()
  // ETF 仅取单日净流入，允许负值；持仓和供应汇总分项，清算转换为金额绝对值。
  const value = isEtf
    ? parseEtfFlow(data, source.name)
    : parseAmountSeries(data, source.name, key === 'longLiquidations' || key === 'shortLiquidations')
  recordTrendHistory(key, data, source.name)
  return value
}
