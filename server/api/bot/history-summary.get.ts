// ==================== 交易历史汇总接口 ====================
import { getCachedTradeHistory } from '../../utils/trade-history-cache'

/** 为盈亏走势返回按日期聚合的数据，避免向浏览器传输完整订单详情。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const strategyId = String(query.strategyId || '')
  const symbol = String(query.symbol || '')
  const records = getCachedTradeHistory()
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .filter((trade) => !symbol || trade.symbol === symbol)
    .sort((a, b) => Number(a.closeTime || 0) - Number(b.closeTime || 0))

  let cumulativePnl = 0
  let wins = 0
  let totalCount = 0
  const dateMap = new Map<string, any>()
  for (const trade of records) {
    cumulativePnl += Number(trade.pnl || 0)
    if (Number(trade.pnl || 0) > 0) wins++
    totalCount++
    const date = new Date(Number(trade.closeTime)).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    dateMap.set(date, {
      time: date,
      pnl: Number(cumulativePnl.toFixed(2)),
      winRate: Number(((wins / totalCount) * 100).toFixed(2)),
      tradeCount: totalCount,
    })
  }
  return { success: true, data: Array.from(dateMap.values()), stats: {
    totalTrades: records.length,
    totalPnl: cumulativePnl,
    winRate: records.length ? (wins / records.length) * 100 : 0,
    totalFee: records.reduce((sum, trade) => sum + Number(trade.totalCommission || 0), 0),
  } }
})
