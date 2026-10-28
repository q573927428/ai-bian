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
  let losses = 0
  let totalProfit = 0
  let totalLoss = 0
  let totalCount = 0
  let totalFee = 0
  let netPnl = 0
  let peakNetPnl = 0
  let maxDrawdown = 0
  let totalHoldDurationMs = 0
  let validHoldCount = 0
  let consecutiveLosses = 0
  let maxConsecutiveLosses = 0
  const dateMap = new Map<string, any>()
  for (const trade of records) {
    cumulativePnl += Number(trade.pnl || 0)
    totalFee += Number(trade.totalCommission || 0)
    // 历史记录 pnl 已扣除交易手续费并计入已结算资金费；手续费仅汇总展示，不能再次扣减。
    netPnl = cumulativePnl
    // 从零收益起逐笔追踪峰谷，避免按日聚合遗漏日内回撤；无本金口径时使用 USDT 金额。
    peakNetPnl = Math.max(peakNetPnl, netPnl)
    maxDrawdown = Math.max(maxDrawdown, peakNetPnl - netPnl)
    const pnl = Number(trade.pnl || 0)
    // 连亏仅按筛选结果的平仓顺序统计；盈利或保本都会中断连续亏损。
    consecutiveLosses = pnl < 0 ? consecutiveLosses + 1 : 0
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
    const openTime = Number(trade.openTime)
    const closeTime = Number(trade.closeTime)
    // 平仓时间决定是否入选，但持仓时长保留完整区间；缺失或异常时间不参与平均。
    if (trade.openTime != null && trade.openTime !== '' && Number.isFinite(openTime) && Number.isFinite(closeTime) && closeTime >= openTime) {
      totalHoldDurationMs += closeTime - openTime
      validHoldCount++
    }
    // 保本交易不参与平均盈利或平均亏损，费用沿用已结算净盈亏口径。
    if (pnl > 0) {
      wins++
      totalProfit += pnl
    } else if (pnl < 0) {
      losses++
      totalLoss += -pnl
    }
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
    // 仅有盈利时用 null 表示无穷大，避免 Infinity 经 JSON 序列化后丢失含义。
    payoffRatio: losses > 0 ? (wins > 0 ? (totalProfit / wins) / (totalLoss / losses) : 0) : (wins > 0 ? null : 0),
    netPnl,
    maxDrawdown,
    averagePnl: records.length ? cumulativePnl / records.length : 0,
    averageHoldDurationMs: validHoldCount ? totalHoldDurationMs / validHoldCount : 0,
    validHoldCount,
    maxConsecutiveLosses,
  } }
})
