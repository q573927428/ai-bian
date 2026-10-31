// ==================== 趋势效率 ER 快照类型 ====================
import type { Timeframe } from './strategy'

/** 单个周期的已收盘 ER；缺失用 null 表示，不能与有效的 ER=0 混淆。 */
export interface EfficiencyRatioSnapshot {
  timeframe: Timeframe
  /** N 段收盘价变化，需要 N+1 个连续收盘价。 */
  period: number
  status: 'ready' | 'insufficient_data' | 'invalid_data' | 'stale_data'
  er: number | null
  /** 仅表示窗口内净位移方向，不是对下一根 K 线的预测。 */
  direction: 'up' | 'down' | 'flat' | null
  netChange: number | null
  netChangePercent: number | null
  pathLength: number | null
  startClose: number | null
  endClose: number | null
  /** K 线开盘时间，单位为毫秒；closedAt 才是末根的收盘时刻。 */
  firstCandleTimestamp: number | null
  lastCandleTimestamp: number | null
  closedAt: number | null
  calculatedAt: number
  availableClosedCandles: number
  requiredClosedCandles: number
  reason?: string
}
