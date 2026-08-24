// ==================== K线订单标记接口 ====================
import { getCachedTradeHistory, toTradeMarker } from '../../utils/trade-history-cache'

/** 只返回指定交易对和时间范围内的轻量订单字段。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const symbol = String(query.symbol || '')
  const from = Number(query.from || 0)
  const to = Number(query.to || Number.MAX_SAFE_INTEGER)
  const data = getCachedTradeHistory()
    .filter((trade) => !symbol || trade.symbol.replace('/', '') === symbol.replace('/', ''))
    .filter((trade) => Number(trade.openTime) <= to && Number(trade.closeTime) >= from)
    .map(toTradeMarker)
  return { success: true, data }
})
