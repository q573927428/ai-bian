// ==================== 加密市场趋势看板数据契约 ====================
export type CryptoTrendKey = 'btcEtf' | 'ethEtf' | 'btcOi' | 'ethOi' | 'longLiquidations' | 'shortLiquidations' | 'stablecoinSupply'
/** UTC 日期的美元快照；缺失日期不补零。 */
export interface TrendPoint { date: string; value: number }
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
  prices: { btc: TrendPoint[]; eth: TrendPoint[] }
}
