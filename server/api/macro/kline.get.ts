// ==================== 宏观本地 K 线只读接口 ====================
import { MACRO_MARKETS, MACRO_PERIODS, macroStorageSymbol, type MacroPeriod, type MacroKlineResponse } from '../../../types/macro-market'
import { initKLineDb, getSimpleKLineData, getSimpleKLineLastUpdatedAt } from '../../utils/kline-simple-storage'
import { getMacroSyncStatus } from '../../modules/macro-kline-sync'

/** 仅查询宏观白名单，不接受任意上游 URL，也不在页面请求中触发下载。 */
export default defineEventHandler(async (event): Promise<MacroKlineResponse> => {
  const query = getQuery(event)
  const market = MACRO_MARKETS.find(item => item.id === query.market)
  if (!market || !MACRO_PERIODS.includes(query.period as MacroPeriod)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid macro market or period' })
  }
  await initKLineDb()
  const period = query.period as MacroPeriod
  const symbol = macroStorageSymbol(market)
  const status = market.source === 'yahoo' ? getMacroSyncStatus(market.id, period) : undefined
  return {
    data: getSimpleKLineData(symbol, period, { limit: 495 }), source: market.source,
    updatedAt: status?.updatedAt ?? getSimpleKLineLastUpdatedAt(symbol, period), error: status?.error,
  }
})
