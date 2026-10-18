// ==================== 头部市场情绪与市占率 ====================
/** 各来源独立更新；失败保留上次数据并标记过期。 */
export interface MarketMetric<T> {
  value: T | null
  updatedAt: string | null
  stale: boolean
}

/** 本站市场概览接口，不向浏览器暴露上游请求。 */
export interface MarketOverview {
  fearGreed: MarketMetric<{ score: number; timestamp: number }>
  dominance: MarketMetric<{ btc: number; eth: number }>
  btcEtf: MarketMetric<EtfNetFlow>
  ethEtf: MarketMetric<EtfNetFlow>
}

/** 美国现货 ETF 单日净流入（美元）；日期取来源元数据，不推断为今日。 */
export interface EtfNetFlow {
  usd: number
  date: string
}
