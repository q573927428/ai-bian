// ==================== 首页交易统计接口 ====================
import { getCachedTradeHistory } from '../../utils/trade-history-cache'

/** 今日边界由浏览器传入，完整统计不受分页上限影响。 */
export default defineEventHandler(event => {
  const query = getQuery(event)
  const start = Number(query.startTime)
  const end = Number(query.endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid day range' })
  }
  const records = getCachedTradeHistory()
  let totalPnl = 0, wins = 0, todayTrades = 0, todayPnl = 0, todayWins = 0
  for (const record of records) {
    const pnl = Number(record.pnl || 0)
    totalPnl += pnl
    if (pnl > 0) wins++
    if (record.closeTime >= start && record.closeTime < end) {
      todayTrades++
      todayPnl += pnl
      if (pnl > 0) todayWins++
    }
  }
  return { success: true, data: {
    totalTrades: records.length, totalPnl, winRate: records.length ? wins / records.length * 100 : 0,
    todayTrades, todayPnl, todayWinRate: todayTrades ? todayWins / todayTrades * 100 : 0,
  } }
})
