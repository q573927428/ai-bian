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
  /** Binance 原始汇率：1 USD 对应的日元及人民币数量。 */
  jpyUsd: MarketMetric<number>
  cnyUsd: MarketMetric<number>
  dominance: MarketMetric<{ btc: number; eth: number }>
  btcEtf: MarketMetric<EtfNetFlow>
  ethEtf: MarketMetric<EtfNetFlow>
  btcOi: MarketMetric<MarketAmount>
  ethOi: MarketMetric<MarketAmount>
  longLiquidations: MarketMetric<MarketAmount>
  shortLiquidations: MarketMetric<MarketAmount>
  stablecoinSupply: MarketMetric<MarketAmount>
}

/** 美元计价的来源快照；coverage 说明实际汇总的交易所或币种，避免误称全市场。 */
export interface MarketAmount {
  usd: number
  date: string
  coverage: string[]
}

/** 美国现货 ETF 单日净流入（美元）；日期取来源元数据，不推断为今日。 */
export interface EtfNetFlow {
  usd: number
  date: string
}
