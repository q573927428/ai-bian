// ==================== 已选交易对市场广度快照 ====================
export type BreadthPeriod = '5m' | '15m' | '1h' | '4h' | '24h'
export type BreadthAssetCategory = 'crypto' | 'tradfi' | 'unknown'

/** 指标详情的同类市场聚合表格；仅传当前交易对涨跌幅，不展开其他标的明细。 */
export interface MarketBreadthSummary {
  selectedCount: number
  computedAt: number
  expiresAt: number
  /** 主周期ATR归一化排名；过期或有效样本不足时为空。 */
  ranking: { position: number; sampleCount: number; tiedCount: number } | null
  rows: (Pick<BreadthStatistics, 'upCount' | 'downCount' | 'flatCount' | 'upRatioPct' | 'medianChangePct' | 'validCount' | 'missingCount'> & {
    period: BreadthPeriod
    changePct: number | null
    /** 当前窗口同类资产ATR归一化排名；兼容旧响应，缺失不借用其他窗口。 */
    ranking?: MarketBreadthSummary['ranking']
  })[]
}

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
  /** ATR(14)含当前未收盘K线；24h使用1d，旧快照允许缺失。 */
  atrs?: Record<string, number>
  /** ATR除以快照价格得到的百分比，供归一化复盘。 */
  atrPercents?: Record<string, number>
  /** 原始窗口涨跌幅除以ATR百分比；缺失样本不参与相对强弱排名。 */
  normalizedChanges?: Record<string, number | null>
  /** 个币无法排名的原因，仅供快照诊断，不传入 AI 提示词；旧快照允许缺失。 */
  rankingUnavailableReasons?: Record<string, string>
}

/** 同一计算时刻的多周期市场背景，时间字段均为毫秒，范围仅限全局已选交易对。 */
export interface MarketBreadthSnapshot {
  scope: 'selected_symbols'
  selectedCount: number
  symbols: string[]
  /** 固定快照中的资产分类；旧快照允许缺失，新评分不使用未分类样本。 */
  assetCategories?: Record<string, BreadthAssetCategory>
  /** 分组视图的类别；整体快照不设置。 */
  assetCategory?: BreadthAssetCategory
  computedAt: number
  expiresAt: number
  periods: Record<BreadthPeriod, BreadthStatistics>
}
