// ==================== ETF 公开 JSON 净流入同步 ====================
import type { EtfNetFlow } from '../../types/market-overview'
import { recordTrendHistory } from './crypto-trends'

export const ETF_FLOW_SOURCES = {
  btc: { url: 'https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetftotalnetflows_daily_other.json', name: 'BTC Spot ETF Total Net Flows' },
  eth: { url: 'https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetftotalnetflows_daily_other.json', name: 'ETH Spot ETF Total Net Flows' },
} as const

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

/** 直读公开 JSON，不依赖主站网页及 Cloudflare 验证。 */
export async function fetchEtfFlow(asset: keyof typeof ETF_FLOW_SOURCES): Promise<EtfNetFlow> {
  const source = ETF_FLOW_SOURCES[asset]
  const response = await fetch(source.url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`The Block JSON HTTP ${response.status}`)
  const data = await response.json()
  const value = parseEtfFlow(data, source.name)
  recordTrendHistory(asset === 'btc' ? 'btcEtf' : 'ethEtf', data, source.name)
  return value
}
