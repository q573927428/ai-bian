// ==================== 已选交易对多周期成交额 API ====================
import type { MarketPeriodVolumes } from '../../../types/market-period-volumes'
import { getBotConfig } from '../../utils/storage'
import { getSimpleKLineData, initKLineDb } from '../../utils/kline-simple-storage'
import { calculatePeriodVolumes } from '../../utils/market-period-volumes'

let cached: MarketPeriodVolumes | null = null
let pending: { key: string; promise: Promise<MarketPeriodVolumes> } | null = null

/** 只读本地已收盘 5m 数据；共享一分钟缓存并合并并发请求，不触发交易所补数。 */
export default defineEventHandler(async () => {
  const config = await getBotConfig()
  const symbols = [...new Set((config.symbols || []).map(symbol => symbol.replace('/', '').trim().toUpperCase()).filter(Boolean))].sort()
  const now = Date.now()
  const windowEnd = Math.floor(now / 300000) * 300000
  const key = JSON.stringify([symbols, windowEnd])
  if (cached && cached.windowEnd === windowEnd && cached.expiresAt > now && JSON.stringify(cached.symbols) === JSON.stringify(symbols)) return cached
  if (pending?.key === key) return pending.promise
  const promise = (async (): Promise<MarketPeriodVolumes> => {
    await initKLineDb()
    const periods: MarketPeriodVolumes['periods'] = { '5m': {}, '15m': {}, '1h': {}, '4h': {}, '24h': {} }
    for (const symbol of symbols) {
      // 一次读最近 24 小时，复用给五个周期，避免按周期重复访问数据库。
      const bars = getSimpleKLineData(symbol, '5m', { from: windowEnd / 1000 - 86400, to: windowEnd / 1000 - 300, limit: 288 })
      const amounts = calculatePeriodVolumes(bars, windowEnd)
      for (const period of Object.keys(periods) as (keyof typeof periods)[]) periods[period][symbol] = amounts[period]
    }
    return { symbols, computedAt: now, expiresAt: Math.min(now + 60000, windowEnd + 300000), windowEnd, periods }
  })()
  pending = { key, promise }
  try {
    const result = await promise
    // 配置变化期间发出的旧请求不得覆盖新配置的缓存。
    if (pending?.promise === promise) cached = result
    return result
  } finally {
    if (pending?.promise === promise) pending = null
  }
})
