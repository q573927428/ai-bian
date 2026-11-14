// ==================== 市场广度本地数据装配与短时缓存 ====================
import { getCachedBinanceExchangeInfo } from './binance-exchange-info'
import { getDailyBreadthRows } from './kline-simple-storage'
import { classifyContractAsset } from '../../app/utils/contract-assets'
import { calculateMarketBreadth } from '../../app/utils/trend-market-breadth'
import type { MarketBreadth } from '../../types/crypto-trends'
import { beijingDate } from '../../app/utils/beijing-time'

const cache = new Map<number, { at: number; value: MarketBreadth }>()

/** 复用官方元数据和本地日线，每分钟最多计算一次；不请求交易所或写入数据库。 */
export async function getTrendMarketBreadth(days: number): Promise<MarketBreadth> {
  const now = Date.now()
  const saved = cache.get(days)
  if (saved && now - saved.at < 60_000 && beijingDate(now) === beijingDate(saved.at)) return saved.value
  const info = await getCachedBinanceExchangeInfo()
  // 仅统计可交易的USDT加密永续合约；显式排除币安加密指数及传统资产。
  const symbols = new Set((info?.symbols ?? []).filter(row => row.status === 'TRADING' && row.contractType === 'PERPETUAL'
    && row.symbol.endsWith('USDT') && row.underlyingType !== 'INDEX' && !['BTCDOMUSDT', 'DEFIUSDT'].includes(row.symbol)
    && classifyContractAsset(row) === 'crypto').map(row => row.symbol))
  const today = Math.floor(now / 86400000) * 86400
  const start = Date.parse(beijingDate(now)) / 1000 - (days + 58) * 86400
  const rows = symbols.size ? getDailyBreadthRows(start, today).filter(row => symbols.has(row.symbol)) : []
  const value = calculateMarketBreadth(rows, days, now)
  cache.set(days, { at: now, value })
  return value
}
