// ==================== 宏观市场标的与周期配置 ====================
import type { SimpleKLineData } from './kline-simple'

export const MACRO_PERIODS = ['15m', '1h', '4h', '1d', '1w'] as const
export type MacroPeriod = typeof MACRO_PERIODS[number]

/** 宏观卡片的本地存储标识、上游来源及 TradingView 映射。 */
export interface MacroMarket {
  id: string
  name: string
  description: string
  source: 'binance' | 'yahoo'
  symbol: string
  tradingView: string
  yield?: boolean
}

export const MACRO_MARKETS: MacroMarket[] = [
  { id: 'btc', name: '比特币', description: '投机资金风险偏好', source: 'binance', symbol: 'BTCUSDT', tradingView: 'BINANCE:BTCUSDT.P' },
  { id: 'qqq', name: '纳指100（QQQ）', description: '美股科技股资金流向', source: 'binance', symbol: 'QQQUSDT', tradingView: 'BINANCE:QQQUSDT.P' },
  { id: 'gold', name: '黄金', description: '大钱避险资金', source: 'binance', symbol: 'XAUUSDT', tradingView: 'BINANCE:XAUUSDT.P' },
  { id: 'dxy', name: '美元指数', description: '全球美元流动性', source: 'yahoo', symbol: 'DX-Y.NYB', tradingView: 'PEPPERSTONE:USDX' },
  { id: 'tnx', name: '10年期美债收益率', description: '全球流动性闸门', source: 'yahoo', symbol: '^TNX', tradingView: 'PYTH:US10Y', yield: true },
  { id: 'oil', name: '原油 CL', description: '能源供需与通胀冲击', source: 'binance', symbol: 'CLUSDT', tradingView: 'BINANCE:CLUSDT.P' },
  { id: 'nikkei', name: '日经225', description: '亚洲市场风险情绪', source: 'yahoo', symbol: '^N225', tradingView: 'PEPPERSTONE:JPN225' },
  { id: 'cqqq', name: '中国科技（CQQQ）', description: '中国科技股资金风险偏好', source: 'yahoo', symbol: 'CQQQ', tradingView: 'AMEX:CQQQ' },
  { id: 'ewy', name: '韩国 KOSPI（EWY）', description: '芯片 / 存储周期温度', source: 'binance', symbol: 'EWYUSDT', tradingView: 'BINANCE:EWYUSDT.P' },
]

/** 不同上游使用独立键，Yahoo 标的不进入币安交易对白名单。 */
export function macroStorageSymbol(market: MacroMarket): string {
  return market.source === 'yahoo' ? `YAHOO:${market.symbol}` : market.symbol
}

/** 本站宏观查询结果；同步错误与已有缓存可以同时返回。 */
export interface MacroKlineResponse {
  data: SimpleKLineData[]
  source: 'binance' | 'yahoo'
  updatedAt: number | null
  error?: string
}
