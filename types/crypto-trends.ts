// ==================== 加密市场趋势看板数据契约 ====================
export type SkewTenor = 7 | 30 | 90
export type CryptoTrendKey = 'btcEtf' | 'ethEtf' | 'btcOi' | 'ethOi' | 'longLiquidations' | 'shortLiquidations' | 'stablecoinSupply' | 'fearGreed' | `btcSkew${SkewTenor}` | `ethSkew${SkewTenor}`
/** 北京时间日期的数值快照，ETF保留交易日；provisional标记盘中，disclosedDate注明沿用值的披露日。缺失日期不补零。 */
export interface TrendPoint { date: string; value: number; provisional?: boolean; disclosedDate?: string }
/** 每个指标独立保存来源、同步状态和实际覆盖范围。 */
export interface TrendHistory {
  points: TrendPoint[]
  updatedAt: string | null
  stale: boolean
  coverage: string[]
}
/** 趋势接口组合本地日线与公开数据历史，不触发上游下载。 */
export interface CryptoTrendsResponse {
  metrics: Record<CryptoTrendKey, TrendHistory>
  prices: { btc: TrendPoint[]; eth: TrendPoint[]; btcdom: TrendPoint[] }
  volumes: { btc: TrendPoint[]; eth: TrendPoint[] }
  volatility: { btc: TrendPoint[]; eth: TrendPoint[] }
  volatilityDays: number // 波动率计算窗口，与全局时间范围一致
  breadth: MarketBreadth
}

/** 固定币种样本的均线上方占比；两个周期使用相同分母，当天估算标记为盘中。 */
export interface MarketBreadth {
  ma20: TrendPoint[]
  ma60: TrendPoint[]
  sampleCount: number
  symbols: string[]
  days: number
}
