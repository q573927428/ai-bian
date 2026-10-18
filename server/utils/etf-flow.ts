// ==================== 免费公开页面 ETF 净流入解析 ====================
import type { EtfNetFlow } from '../../types/market-overview'

export const ETF_FLOW_SOURCES = {
  btc: { url: 'https://www.theblock.co/data/etfs/bitcoin-etf/spot-bitcoin-etf-total-net-flow', name: 'Spot Bitcoin ETF Total Net Flows' },
  eth: { url: 'https://www.theblock.co/data/etfs/ethereum-etfs/spot-ethereum-etf-total-net-flows', name: 'Spot Ethereum ETF Total Net Flows' },
} as const

/** 只解析公开 JSON-LD 的美元单日合计，避免误取成交量、累计流量或币本位数值。 */
export function parseEtfFlow(html: string, name: string): EtfNetFlow {
  const values: Array<EtfNetFlow & { timestamp: number }> = []
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    const record = node as Record<string, any>
    if (record['@type'] === 'DataFeedItem' && record.item?.name === name) {
      const timestamp = Date.parse(record.dateModified)
      const metrics = record.item.variableMeasured
      const metric = Array.isArray(metrics) ? metrics.find(row => row?.name === 'Total Net Flow' && row.unitText === 'USD') : undefined
      if (metric && typeof metric.value === 'number' && Number.isFinite(metric.value) && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 86_400_000) {
        values.push({ usd: metric.value, date: new Date(timestamp).toISOString().slice(0, 10), timestamp })
      }
    }
    Object.values(record).forEach(visit)
  }
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    // 无关结构化数据损坏不影响其余脚本；完全没有有效指标则报错保留旧值。
    try { visit(JSON.parse(script[1]!)) } catch { /* 继续检查下一个脚本。 */ }
  }
  const latest = values.sort((a, b) => b.timestamp - a.timestamp)[0]
  if (!latest) throw new Error(`${name} 页面缺少有效净流入数据`)
  return { usd: latest.usd, date: latest.date }
}

/** 无需 API Key 获取公开页面；不尝试绕过验证，失败交由缓存保留旧数据。 */
export async function fetchEtfFlow(asset: keyof typeof ETF_FLOW_SOURCES): Promise<EtfNetFlow> {
  const source = ETF_FLOW_SOURCES[asset]
  const response = await fetch(source.url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`The Block HTTP ${response.status}`)
  return parseEtfFlow(await response.text(), source.name)
}
