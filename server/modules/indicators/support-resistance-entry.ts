// ==================== 支撑阻力入场摘要 ====================
import type { EntrySupportResistance, PriceZone, SupportResistanceSnapshot } from '../../../types/support-resistance'

/** 只拷贝复盘所需字段，防止完整区域缓存随每笔订单重复落盘。 */
export function summarizeEntrySupportResistance(snapshot?: SupportResistanceSnapshot): EntrySupportResistance | undefined {
  if (!snapshot) return undefined
  const zone = (value: PriceZone | null) => value
    ? { lower: value.lower, upper: value.upper, touches: value.touches } : null
  return {
    timeframe: snapshot.timeframe, referencePrice: snapshot.referencePrice,
    nearestSupport: zone(snapshot.nearestSupport), nearestResistance: zone(snapshot.nearestResistance),
    supportDistancePercent: snapshot.supportDistancePercent, resistanceDistancePercent: snapshot.resistanceDistancePercent,
    supportDistanceATR: snapshot.supportDistanceATR, resistanceDistanceATR: snapshot.resistanceDistanceATR,
    status: snapshot.status
  }
}
