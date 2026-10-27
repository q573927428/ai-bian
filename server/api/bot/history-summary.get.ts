// ==================== 交易历史汇总接口 ====================
import { getCachedTradeHistory } from '../../utils/trade-history-cache'
import { getTradeHistoryOptions } from '../../utils/trade-history-query'

/** 为收益分析返回按日期聚合的数据，避免向浏览器传输完整订单详情。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const strategyId = String(query.strategyId || '')
  const symbol = String(query.symbol || '')
  const startTime = Number(query.startTime)
  const endTime = Number(query.endTime)
  const hasTimeRange = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
  // 时间范围与聚合粒度分开处理，避免多日筛选把不同日期的同一分钟合并。
  // 未指定粒度的旧客户端仍沿用单日展示方式。
  const isIntraday = hasTimeRange && (query.granularity === 'minute' || (!query.granularity && endTime - startTime <= 25 * 60 * 60 * 1000))
  const timeFormat = new Intl.DateTimeFormat('zh-CN', isIntraday
    ? { timeZone: String(query.timeZone || 'Asia/Shanghai'), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { timeZone: String(query.timeZone || 'Asia/Shanghai'), year: 'numeric', month: 'numeric', day: 'numeric' })
  const allRecords = getCachedTradeHistory()
  const records = allRecords
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .filter((trade) => !symbol || trade.symbol === symbol)
    .filter((trade) => !hasTimeRange || (Number(trade.closeTime) >= startTime && Number(trade.closeTime) < endTime))
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
    // 历史记录 pnl 已扣除交易手续费并计入已结算资金费；手续费仅汇总展示，不能再次扣减。
    netPnl = cumulativePnl
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
  return { success: true, data: Array.from(dateMap.values()), options: getTradeHistoryOptions(allRecords), stats: {
    totalTrades: records.length,
    totalPnl: cumulativePnl,
    winRate: records.length ? (wins / records.length) * 100 : 0,
    totalFee,
    netPnl,
    maxDrawdown,
  } }
})
