// ==================== 宏观本地 K 线只读接口 ====================
import { MACRO_MARKETS, MACRO_PERIODS, macroStorageSymbol, localMacroMarket, type MacroPeriod, type MacroKlineResponse } from '../../../types/macro-market'
import { initKLineDb, getSimpleKLineData, getSimpleKLineLastUpdatedAt, getSimpleKLineCount } from '../../utils/kline-simple-storage'
import { getMacroSyncStatus } from '../../modules/macro-kline-sync'

/** 查询默认宏观市场或本地已有合约，不在页面请求中触发下载。 */
export default defineEventHandler(async (event): Promise<MacroKlineResponse> => {
  const query = getQuery(event)
  const marketId = typeof query.market === 'string' ? query.market : ''
  const market = MACRO_MARKETS.find(item => item.id === marketId)
    ?? (marketId.startsWith('local:') ? localMacroMarket(marketId.slice(6)) : undefined)
  if (!market || !MACRO_PERIODS.includes(query.period as MacroPeriod)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid macro market or period' })
  }
  await initKLineDb()
  const period = query.period as MacroPeriod
  const symbol = macroStorageSymbol(market)
  // 用户自选合约必须在所请求周期已有本地数据，不能用任意名称触发远端请求。
  if (marketId.startsWith('local:') && getSimpleKLineCount(symbol, period) === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Local kline data not found' })
  }
  const status = market.source === 'yahoo' ? getMacroSyncStatus(market.id, period) : undefined
  return {
    data: getSimpleKLineData(symbol, period, { limit: 495 }), source: market.source,
    updatedAt: status?.updatedAt ?? getSimpleKLineLastUpdatedAt(symbol, period), error: status?.error,
  }
})
