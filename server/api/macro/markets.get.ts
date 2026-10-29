// ==================== 宏观看板本地可选市场目录 ====================
import { MACRO_PERIODS, localMacroMarket, type LocalMacroMarket, type MacroPeriod } from '../../../types/macro-market'
import { initKLineDb, getSimpleStoredSymbols } from '../../utils/kline-simple-storage'

/** 只枚举数据库中实际存在的 K 线，不请求上游、不添加订阅。 */
export default defineEventHandler(async (): Promise<LocalMacroMarket[]> => {
  await initKLineDb()
  const markets = new Map<string, LocalMacroMarket>()
  for (const row of getSimpleStoredSymbols()) {
    if (row.count <= 0 || !MACRO_PERIODS.includes(row.timeframe as MacroPeriod)) continue
    const market = localMacroMarket(row.symbol)
    if (!market) continue
    const entry = markets.get(market.id) ?? { ...market, periods: [] }
    entry.periods.push(row.timeframe as MacroPeriod)
    markets.set(market.id, entry)
  }
  return [...markets.values()]
})
