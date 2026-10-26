// ==================== K线订单标记接口 ====================
import { getCachedTradeHistory, toTradeMarker } from '../../utils/trade-history-cache'

/** 只返回指定交易对和时间范围内的轻量订单字段。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const symbol = String(query.symbol || '')
  const from = Number(query.from || 0)
  const to = Number(query.to || Number.MAX_SAFE_INTEGER)
  const records = getCachedTradeHistory()
  // 从全部历史建立唯一策略周期映射，保持旧订单跨交易对推断规则。
  const timeframes = new Map<string, Set<string>>()
  for (const record of records) {
    if (!record.strategyId || !record.mainTimeframe) continue
    const values = timeframes.get(record.strategyId) || new Set<string>()
    values.add(record.mainTimeframe)
    timeframes.set(record.strategyId, values)
  }
  const data = records
    .filter((trade) => !symbol || trade.symbol.replace('/', '') === symbol.replace('/', ''))
    .filter((trade) => Number(trade.openTime) <= to && Number(trade.closeTime) >= from)
    .map(trade => {
      const values = timeframes.get(trade.strategyId)
      return { ...toTradeMarker(trade), inferredTimeframe: !trade.mainTimeframe && values?.size === 1 ? [...values][0] : undefined }
    })
  return { success: true, data }
})
