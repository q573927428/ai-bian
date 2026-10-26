// ==================== 交易历史汇总接口 ====================
import { getCachedTradeHistory } from '../../utils/trade-history-cache'

/** 为收益分析返回按日期聚合的数据，避免向浏览器传输完整订单详情。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const strategyId = String(query.strategyId || '')
  const symbol = String(query.symbol || '')
  const startTime = Number(query.startTime)
  const endTime = Number(query.endTime)
  const isIntraday = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
  // 当日使用客户端时区展示时分；自然日边界由客户端传入，避免服务器时区偏差。
  const timeFormat = new Intl.DateTimeFormat('zh-CN', isIntraday
    ? { timeZone: String(query.timeZone || 'Asia/Shanghai'), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { month: 'numeric', day: 'numeric' })
  const records = getCachedTradeHistory()
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .filter((trade) => !symbol || trade.symbol === symbol)
    .filter((trade) => !isIntraday || (Number(trade.closeTime) >= startTime && Number(trade.closeTime) < endTime))
    .sort((a, b) => Number(a.closeTime || 0) - Number(b.closeTime || 0))

  let cumulativePnl = 0
  let wins = 0
  let totalCount = 0
  let totalFee = 0
  let netPnl = 0
  let peakNetPnl = 0
  let maxDrawdown = 0
  const dateMap = new Map<string, any>()
  for (const trade of records) {
    cumulativePnl += Number(trade.pnl || 0)
    totalFee += Number(trade.totalCommission || 0)
    netPnl = cumulativePnl - totalFee
    // 从零收益起逐笔追踪峰谷，避免按日聚合遗漏日内回撤；无本金口径时使用 USDT 金额。
    peakNetPnl = Math.max(peakNetPnl, netPnl)
    maxDrawdown = Math.max(maxDrawdown, peakNetPnl - netPnl)
    if (Number(trade.pnl || 0) > 0) wins++
    totalCount++
    const date = timeFormat.format(new Date(Number(trade.closeTime)))
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
    totalFee,
    netPnl,
    maxDrawdown,
  } }
})
