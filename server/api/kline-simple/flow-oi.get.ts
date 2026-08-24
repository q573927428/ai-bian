// ==================== 资金流与 OI 图表接口 ====================
import { getSimpleKLineData } from '../../utils/kline-simple-storage'
import { classifyFlowOI } from '../../utils/flow-oi-classifier'
import type { KLineTimeframe } from '../../../types/kline-simple'

/** 返回图表副图所需的资金流、OI 和联合状态数据。 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const symbol = String(query.symbol || '')
  const timeframe = String(query.timeframe || '') as KLineTimeframe
  const valid = ['5m', '15m', '1h', '4h', '1d', '1w']
  if (!symbol || !valid.includes(timeframe)) {
    throw createError({ statusCode: 400, statusMessage: 'symbol 和 timeframe 参数无效' })
  }
  const limitRaw = Number(query.limit || 2233)
  const data = getSimpleKLineData(symbol, timeframe, { limit: Math.min(2233, Math.max(1, limitRaw)) })
  const classified = classifyFlowOI(data, timeframe)
  return {
    success: true,
    data: classified.map(item => ({
      t: item.t, c: item.c, quoteVolume: item.quoteVolume ?? null,
      activeBuyAmount: item.activeBuyAmount ?? null, activeSellAmount: item.activeSellAmount ?? null,
      activeDelta: item.activeDelta ?? null, activeDeltaRatio: item.activeDeltaRatio ?? null,
      activeFlowDeviation: item.activeFlowDeviation ?? null,
      oiValue: item.oiValue ?? null, oiChange: item.oiChange ?? null,
      oiChangePercent: item.oiChangePercent ?? null, state: item.state ?? 'unavailable',
      provisional: item.oiProvisional ?? false
    }))
  }
})
