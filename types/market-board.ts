// 币安USDT本位合约全市场看板类型定义

export type TimeRange = '24h'

// 单个交易对的看板数据
export interface MarketSymbolData {
  symbol: string              // 交易对名称，如 'BTCUSDT'
  baseAsset: string           // 基础资产，如 'BTC'
  quoteAsset: string          // 报价资产，如 'USDT'

  // 价格数据
  currentPrice: number        // 当前价格
  priceChange: number         // 价格变化（根据时间范围）
  priceChangePercent: number  // 涨跌幅（%，根据时间范围）

  // 成交量
  volume: number              // 成交量（币数，根据时间范围）
  quoteVolume: number         // 成交额（USDT，根据时间范围）

  // 未平仓合约量
  openInterest: number        // 未平仓合约量（币数）
  openInterestValue: number   // 未平仓合约价值（USDT）= openInterest * currentPrice

  // 市值估算
  marketCapEstimate: number   // 市值估算 = 当前价格 * 未平仓合约量（简化估算）

  // 资金费率
  fundingRate: number         // 当前资金费率
  nextFundingTime: number     // 下次资金费率时间戳

  // 币安广场热度
  squareHeat: number          // 广场热度指数（0-100）
  squarePostCount: number     // 相关帖子数量

  // 时间戳
  lastUpdated: number         // 数据最后更新时间戳
}

// 市场看板聚合数据
export interface MarketBoardData {
  symbols: MarketSymbolData[]
  totalSymbols: number
  lastUpdated: number
  timeRange: TimeRange
}

// 历史K线数据缓存
export interface KlineCacheEntry {
  symbol: string
  timeframe: string
  data: Array<{
    timestamp: number
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  lastUpdated: number
  expiresAt: number
}

// 币安广场热度数据
export interface SquareHeatData {
  symbol: string
  heat: number
  postCount: number
  lastUpdated: number
}

// API 响应格式
export interface MarketBoardApiResponse {
  success: boolean
  message?: string
  data?: MarketBoardData
}

export interface MarketSymbolsApiResponse {
  success: boolean
  message?: string
  data?: {
    symbols: Array<{
      symbol: string
      baseAsset: string
      quoteAsset: string
      status: string
    }>
    total: number
  }
}

export interface SymbolHeatApiResponse {
  success: boolean
  message?: string
  data?: SquareHeatData
}

// WebSocket ticker 数据（币安格式）
export interface BinanceTickerData {
  e: string        // 事件类型
  E: number        // 事件时间戳
  s: string        // 交易对
  p: string        // 24h 价格变化
  P: string        // 24h 涨跌幅（%）
  w: string        // 24h 加权平均价
  x: string        // 24h 前第一笔成交价
  c: string        // 最新成交价
  Q: string        // 最新成交数量
  b: string        // 买一价
  B: string        // 买一量
  a: string        // 卖一价
  A: string        // 卖一量
  o: string        // 24h 开盘价
  h: string        // 24h 最高价
  l: string        // 24h 最低价
  v: string        // 24h 成交量（币数）
  q: string        // 24h 成交额（USDT）
  O: number        // 24h 统计开始时间戳
  C: number        // 24h 统计结束时间戳
  F: number        // 24h 第一笔成交ID
  L: number        // 24h 最后一笔成交ID
  n: number        // 24h 成交笔数
}