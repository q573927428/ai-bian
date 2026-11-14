// ==================== 加密趋势只读历史接口 ====================
import { getTrendHistories } from '../../utils/crypto-trends'
import { initKLineDb, getSimpleKLineData } from '../../utils/kline-simple-storage'
import type { CryptoTrendsResponse } from '../../../types/crypto-trends'
import { realizedVolatility, dailyQuoteVolumes } from '../../../app/utils/relative-market-calculations'
import { getTrendMarketBreadth } from '../../utils/trend-market-breadth'
import { beijingDate } from '../../../app/utils/beijing-time'

export default defineEventHandler(async (event): Promise<CryptoTrendsResponse> => {
  const volatilityDays = Number(getQuery(event).days ?? 90)
  if (![7, 30, 90, 365].includes(volatilityDays)) throw createError({ statusCode: 400, statusMessage: 'Invalid trend days' })
  await initKLineDb()
  // 价格复用本地同步日线，缺失时留空，不在接口中增加币安请求。
  // 使用全部本地日线为长窗口预热；不足window+1根时不缩短窗口冒充完整波动率。
  const btc = getSimpleKLineData('BTCUSDT', '1d', { limit: 495 })
  const eth = getSimpleKLineData('ETHUSDT', '1d', { limit: 495 })
  const btcdom = getSimpleKLineData('BTCDOMUSDT', '1d', { limit: 400 })
  const prices = (bars: typeof btc) => bars.filter(row => Number.isFinite(row.c) && row.c > 0)
    .map(row => ({ date: beijingDate(row.t * 1000), value: row.c, provisional: row.t + 86400 > Date.now() / 1000 }))
  return {
    metrics: getTrendHistories(), prices: { btc: prices(btc), eth: prices(eth), btcdom: prices(btcdom) },
    volumes: { btc: dailyQuoteVolumes(btc), eth: dailyQuoteVolumes(eth) },
    volatilityDays,
    breadth: await getTrendMarketBreadth(volatilityDays),
    volatility: { btc: realizedVolatility(btc, undefined, volatilityDays), eth: realizedVolatility(eth, undefined, volatilityDays) },
  }
})
