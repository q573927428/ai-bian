// ==================== 趋势效率 ER 快照类型 ====================
import type { Timeframe } from './strategy'

/** ER 计算支持的周期，包含首页图表额外提供的分钟线和周线。 */
export type ERTimeframe = Timeframe | '1m' | '1w'

/** 单个周期的 ER，包含最新未收盘 K 线当前价；缺失用 null 表示，区别于有效 ER=0。 */
export interface EfficiencyRatioSnapshot<T extends ERTimeframe = Timeframe> {
  timeframe: T
  /** N 段价格变化，需要 N+1 个连续 K 线价格（含末根盘中价）。 */
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
  /** K 线开盘时间，单位为毫秒；closedAt 是末根计划收盘时刻，可能晚于 calculatedAt。 */
  firstCandleTimestamp: number | null
  lastCandleTimestamp: number | null
  closedAt: number | null
  calculatedAt: number
  /** 实际已收盘根数；盘中末根也参与计算，因此可能小于 requiredClosedCandles。 */
  availableClosedCandles: number
  /** 保留历史字段名兼容旧快照，表示所需 K 线价格总数，包含盘中价。 */
  requiredClosedCandles: number
  reason?: string
}
