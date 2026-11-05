// ==================== 实时盘口快照 ====================

/** 普通可见订单簿；覆盖范围以外未知，不能解释成没有挂单。 */
export interface OrderBookSnapshot {
  symbol: string
  status: 'syncing' | 'live' | 'disconnected' | 'stale'
  updatedAt: number
  receivedAt: number
  coverage: { lower: number; upper: number } | null
  bids: [number, number][]
  asks: [number, number][]
}

/** Binance USD-M 深度增量，数量为价格档的绝对值。 */
export interface DepthUpdate {
  e: 'depthUpdate'
  s: string
  E: number
  U: number
  u: number
  pu: number
  b: [string, string][]
  a: [string, string][]
}

/** REST 快照用于与先缓存的 WebSocket 更新衔接。 */
export interface DepthSnapshot {
  lastUpdateId: number
  E: number
  bids: [string, string][]
  asks: [string, string][]
}
