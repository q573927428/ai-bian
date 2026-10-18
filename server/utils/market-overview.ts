// ==================== 市场概览定时同步与缓存 ====================
import type { MarketOverview } from '../../types/market-overview'
import { fetchEtfFlow } from './etf-flow'
import { fetchMarketAmount, MARKET_AMOUNT_KEYS } from './market-amounts'

export const MARKET_REFRESH_MS = 60 * 60_000
const cache: MarketOverview = {
  fearGreed: { value: null, updatedAt: null, stale: true },
  dominance: { value: null, updatedAt: null, stale: true },
  btcEtf: { value: null, updatedAt: null, stale: true },
  ethEtf: { value: null, updatedAt: null, stale: true },
  btcOi: { value: null, updatedAt: null, stale: true },
  ethOi: { value: null, updatedAt: null, stale: true },
  longLiquidations: { value: null, updatedAt: null, stale: true },
  shortLiquidations: { value: null, updatedAt: null, stale: true },
  stablecoinSupply: { value: null, updatedAt: null, stale: true },
}
let pending: Promise<void> | undefined

/** 超时及 HTTP 错误均视为同步失败，保留已有缓存。 */
async function readJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** 各项独立同步，并合并重叠的定时任务，避免单个来源故障拖累其他指标。 */
export function refreshMarketOverview(): Promise<void> {
  if (pending) return pending
  pending = Promise.allSettled([
    ...MARKET_AMOUNT_KEYS.map(async (key) => {
      try {
        const value = await fetchMarketAmount(key)
        // 来源缓存日期倒退时保留已有较新数据。
        if (cache[key].value && value.date < cache[key].value!.date) throw new Error('来源数据日期倒退')
        cache[key] = { value, updatedAt: new Date().toISOString(), stale: false }
      } catch (error) {
        cache[key].stale = true
        console.warn(`[MarketOverview] ${key} 同步失败:`, error instanceof Error ? error.message : error)
      }
    }),
    ...(['btc', 'eth'] as const).map(async (asset) => {
      const key = asset === 'btc' ? 'btcEtf' : 'ethEtf'
      try {
        const value = await fetchEtfFlow(asset)
        // 上游缓存倒退时不覆盖较新数据。
        if (cache[key].value && value.date < cache[key].value!.date) throw new Error('ETF 来源数据日期倒退')
        cache[key] = { value, updatedAt: new Date().toISOString(), stale: false }
      } catch (error) {
        cache[key].stale = true
        console.warn(`[MarketOverview] ${asset.toUpperCase()} ETF 同步失败:`, error instanceof Error ? error.message : error)
      }
    }),
    (async () => {
      try {
        const data = await readJson('https://api.alternative.me/fng/?limit=1')
        const row = data?.data?.[0]
        const score = Number(row?.value)
        const timestamp = Number(row?.timestamp)
        if (!row || !Number.isInteger(score) || score < 0 || score > 100 || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error('恐慌贪婪数据格式异常')
        cache.fearGreed = { value: { score, timestamp }, updatedAt: new Date().toISOString(), stale: false }
      } catch (error) {
        cache.fearGreed.stale = true
        console.warn('[MarketOverview] Alternative.me 同步失败:', error instanceof Error ? error.message : error)
      }
    })(),
    (async () => {
      try {
        const data = await readJson('https://api.coingecko.com/api/v3/global')
        const btc = data?.data?.market_cap_percentage?.btc
        const eth = data?.data?.market_cap_percentage?.eth
        if (![btc, eth].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error('市占率数据格式异常')
        cache.dominance = { value: { btc, eth }, updatedAt: new Date().toISOString(), stale: false }
      } catch (error) {
        cache.dominance.stale = true
        console.warn('[MarketOverview] CoinGecko 同步失败:', error instanceof Error ? error.message : error)
      }
    })(),
  ]).then(() => { pending = undefined })
  return pending
}

/** HTTP 接口只读取缓存；前端轮询不会触发额外上游请求。 */
export function getMarketOverview(): MarketOverview {
  return structuredClone(cache)
}
