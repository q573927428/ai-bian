// ==================== 历史订单服务端分页接口 ====================
import { getCachedTradeHistory } from '../../utils/trade-history-cache'
import { queryTradeHistory } from '../../utils/trade-history-query'

/** 筛选、排序与汇总在完整历史上执行，仅传输当前页。 */
export default defineEventHandler((event) => {
  try {
    return { success: true, ...queryTradeHistory(getCachedTradeHistory(), getQuery(event)) }
  } catch (error: any) {
    return { success: false, message: error.message || '获取历史失败' }
  }
})
