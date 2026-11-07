// ==================== 看板多周期成交额快照 ====================
import type { BreadthPeriod } from './market-breadth'

/** 已选交易对最近完整周期的计价资产成交额；缺失 K 线或成交额字段时返回 null。 */
export interface MarketPeriodVolumes {
  symbols: string[]
  computedAt: number
  expiresAt: number
  /** 滚动窗口结束时间（毫秒），对齐最近已收盘的 5m K 线。 */
  windowEnd: number
  periods: Record<BreadthPeriod, Record<string, number | null>>
}
