// ==================== 单笔交易详情接口 ====================
import { getCachedTradeHistory } from '../../../utils/trade-history-cache'

/** 按订单 ID 查询完整历史详情，列表和图表无需携带大字段。 */
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const record = getCachedTradeHistory().find((trade) => String(trade.id) === String(id))
  if (!record) throw createError({ statusCode: 404, statusMessage: '交易记录不存在' })
  return { success: true, data: record }
})
