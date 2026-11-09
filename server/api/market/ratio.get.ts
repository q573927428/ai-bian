// ==================== 本地合约收盘价格比值接口 ====================
import { initKLineDb, getSimpleKLineData } from '../../utils/kline-simple-storage'
import { ratioClosingPrices } from '../../../app/utils/relative-market-calculations'
import type { KLineTimeframe } from '../../../types/kline-simple'

const periods: { timeframe: KLineTimeframe; seconds: number }[] = [
  { timeframe: '5m', seconds: 300 }, { timeframe: '15m', seconds: 900 },
  { timeframe: '1h', seconds: 3600 }, { timeframe: '4h', seconds: 14400 },
  { timeframe: '1d', seconds: 86400 }, { timeframe: '1w', seconds: 604800 },
]

/** 只读取所选周期的两个市场，按相同时间匹配收盘价；不请求上游、不额外读取子周期。 */
export default defineEventHandler(async event => {
  const query = getQuery(event)
  const left = String(query.left ?? ''), right = String(query.right ?? '')
  const period = periods.find(entry => entry.timeframe === query.timeframe)
  if (!period || !/^[A-Z0-9]+USDT$/.test(left) || !/^[A-Z0-9]+USDT$/.test(right) || left === right) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ratio symbols or timeframe' })
  }
  await initKLineDb()
  const read = (symbol: string, timeframe: KLineTimeframe) => getSimpleKLineData(symbol, timeframe, { limit: 495 })
  return { points: ratioClosingPrices(read(left, period.timeframe), read(right, period.timeframe)) }
})
