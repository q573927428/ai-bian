// ==================== 加密趋势只读历史接口 ====================
import { getTrendHistories } from '../../utils/crypto-trends'
import { initKLineDb, getSimpleKLineData } from '../../utils/kline-simple-storage'
import type { CryptoTrendsResponse } from '../../../types/crypto-trends'

export default defineEventHandler(async (): Promise<CryptoTrendsResponse> => {
  await initKLineDb()
  // 价格复用本地同步日线，缺失时留空，不在接口中增加币安请求。
  const prices = (symbol: string) => getSimpleKLineData(symbol, '1d', { limit: 400 })
    .map(row => ({ date: new Date(row.t * 1000).toISOString().slice(0, 10), value: row.c }))
  return { metrics: getTrendHistories(), prices: { btc: prices('BTCUSDT'), eth: prices('ETHUSDT') } }
})
