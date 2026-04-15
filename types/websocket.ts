// WebSocket相关类型定义

// WebSocket连接状态
export enum WebSocketStatus {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

// 价格数据
export interface PriceData {
  symbol: string
  price: number
  timestamp: number
  volume?: number
  bid?: number
  ask?: number
  bidSize?: number
  askSize?: number
}

// K线数据
export interface KlineData {
  symbol: string
  interval: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: number
  isClosed: boolean
}

// 深度数据
export interface DepthData {
  symbol: string
  bids: [number, number][]  // [价格, 数量]
  asks: [number, number][]
  timestamp: number
}

// 交易数据
export interface TradeData {
  symbol: string
  price: number
  quantity: number
  timestamp: number
  isBuyerMaker: boolean
}

// WebSocket订阅选项
export interface SubscriptionOptions {
  symbols: string[]
  intervals?: string[]  // K线间隔，如['1m', '5m', '15m']
  depthLevel?: number  // 深度级别，如5、10、20
}

// WebSocket事件
export interface WebSocketEvent {
  type: 'price' | 'kline' | 'depth' | 'trade' | 'error' | 'status'
  data: PriceData | KlineData | DepthData | TradeData | string
  timestamp: number
}

// WebSocket配置
export interface WebSocketConfig {
  reconnectInterval: number  // 重连间隔（毫秒）
  maxReconnectAttempts: number  // 最大重连尝试次数
  pingInterval: number  // 心跳间隔（毫秒）
  timeout: number  // 超时时间（毫秒）
}

// WebSocket客户端状态
export interface WebSocketClientState {
  status: WebSocketStatus
  connectedSymbols: string[]
  subscriptions: SubscriptionOptions
  lastActivity: number
  reconnectAttempts: number
}