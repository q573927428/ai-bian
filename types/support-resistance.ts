// ==================== 实时支撑阻力快照 ====================

/** 已确认摆动点聚合的价格区域；触碰次数仅统计独立摆动点。 */
export interface PriceZone {
  lower: number
  upper: number
  touches: number
  firstConfirmedAt: number
  lastConfirmedAt: number
}

/** 入场仅保存最近区域及距离，省去候选列表、算法参数和区域确认历史。 */
export interface EntrySupportResistance extends Pick<SupportResistanceSnapshot,
  'timeframe' | 'referencePrice' | 'supportDistancePercent' | 'resistanceDistancePercent'
  | 'supportDistanceATR' | 'resistanceDistanceATR' | 'status'> {
  nearestSupport: Pick<PriceZone, 'lower' | 'upper' | 'touches'> | null
  nearestResistance: Pick<PriceZone, 'lower' | 'upper' | 'touches'> | null
}

/** 同一行情时刻的结构与距离；null 表示未找到有效区域，不代表不存在障碍。 */
export interface SupportResistanceSnapshot {
  algorithm: 'confirmed-pivots-v1'
  timeframe: string
  calculatedAt: number
  /** 仅更新距离时保持区域计算时间不变，避免把旧区域展示成刚刚识别。 */
  priceUpdatedAt?: number
  sourceCandleTimestamp: number | null
  lastClosedTimestamp: number | null
  referencePrice: number | null
  atr: number | null
  lookback: number
  closedCandles: number
  pivotLeft: number
  pivotRight: number
  mergeDistanceATR: number
  minTouches: number
  breakoutBufferATR: number
  nearestSupport: PriceZone | null
  nearestResistance: PriceZone | null
  supportDistancePercent: number | null
  resistanceDistancePercent: number | null
  supportDistanceATR: number | null
  resistanceDistanceATR: number | null
  supports: PriceZone[]
  resistances: PriceZone[]
  /** 区域缓存保留全部有效区域，价格跨区后可重新选择最近区域。 */
  supportZones?: PriceZone[]
  resistanceZones?: PriceZone[]
  brokenSupport: PriceZone | null
  brokenResistance: PriceZone | null
  status: 'insufficient_data' | 'no_levels' | 'between_levels' | 'at_support' | 'at_resistance'
    | 'breakdown_pending' | 'breakout_pending' | 'breakdown_confirmed' | 'breakout_confirmed'
}
