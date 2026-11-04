// ==================== 已选交易对共享市场广度 API ====================
import { getBotConfig } from '../../utils/storage'
import { getMarketBreadth, formatMarketBreadth } from '../../utils/market-breadth'
import { getStrategyManagerIfAvailable } from '../../modules/strategy-manager'
import { TREND_PERIODS, type TrendPeriod } from '../../../app/utils/environment-confidence'

/** 看板与策略使用同一份聚合快照，不按浏览器重复计算。 */
export default defineEventHandler(async (event) => {
  const hub = getStrategyManagerIfAvailable()?.getIndicatorsHub()
  const snapshot = await getMarketBreadth(await getBotConfig(), false, hub)
  // 预览复用与 AI 完全相同的格式化函数，不调用 AI 或触发交易。
  const query = getQuery(event)
  if (query.format === 'text') {
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    const timeframe = TREND_PERIODS.includes(query.timeframe as TrendPeriod) ? query.timeframe as TrendPeriod : '15m'
    return formatMarketBreadth(snapshot, typeof query.symbol === 'string' ? query.symbol : undefined, timeframe)
  }
  return snapshot
})
