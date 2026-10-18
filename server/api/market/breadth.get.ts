// ==================== 已选交易对共享市场广度 API ====================
import { getBotConfig } from '../../utils/storage'
import { getMarketBreadth, formatMarketBreadth } from '../../utils/market-breadth'

/** 看板与策略使用同一份聚合快照，不按浏览器重复计算。 */
export default defineEventHandler(async (event) => {
  const snapshot = await getMarketBreadth(await getBotConfig())
  // 预览复用与 AI 完全相同的格式化函数，不调用 AI 或触发交易。
  if (getQuery(event).format === 'text') {
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return formatMarketBreadth(snapshot)
  }
  return snapshot
})
