// ==================== 已选交易对市场广度快照 ====================
export type BreadthPeriod = '1h' | '4h' | '24h'

/** 单周期统计；占比以有效样本（含持平）为分母，缺失行情不按零处理。 */
export interface BreadthStatistics {
  validCount: number
  upCount: number
  downCount: number
  flatCount: number
  missingCount: number
  upRatioPct: number | null
  medianChangePct: number | null
  referenceTime: number | null
  changes: Record<string, number | null>
  /** 本地历史开盘价，供看板结合实时价格计算；不作为 AI 的逐币种输入。 */
  bases: Record<string, number>
}

/** 同一计算时刻的三周期市场背景，时间字段均为毫秒，范围仅限全局已选交易对。 */
export interface MarketBreadthSnapshot {
  scope: 'selected_symbols'
  selectedCount: number
  symbols: string[]
  computedAt: number
  expiresAt: number
  periods: Record<BreadthPeriod, BreadthStatistics>
}
