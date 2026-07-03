// ==================== 核心类型定义 ====================

// 交易方向
export type Direction = 'LONG' | 'SHORT' | 'IDLE'

// 风险等级
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

// 评分拆解
export interface ScoreBreakdown {
  baseScore: number
  hardScore: number
  softScore: number
  penaltyScore: number
  finalScore: number
}

// 仓位状态
export enum PositionStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  OPENING = 'OPENING',
  POSITION = 'POSITION',
  CLOSING = 'CLOSING',
  HALTED = 'HALTED'
}

// ==================== K线与技术指标 ====================

// K线数据
export interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// 技术指标
export interface TechnicalIndicators {
  emaMap: Record<string, number>
  emaList: Array<{ period: number; name: string; value: number; slope?: number }>
  adxPeriodLabel: string
  adx?: number
  adxSlope?: number
  rsi?: number
  macd?: {
    macd: number
    signal: number
    histogram: number
  }
  atr?: number
  openInterest?: number
  openInterestChangePercent?: number
  openInterestTrend?: 'increasing' | 'decreasing' | 'flat'
  squareHeat?: number
  squareHeatPostCount?: number
  squareHeatTrend?: 'increasing' | 'normal' | 'decreasing'
  squareHeatChangePercent?: number
  squareHeatHistoryAvg?: number
  squareHeatBullishPercent?: number
  squareHeatBearishPercent?: number
  squareHeatNeutralCount?: number
  enabledIndicators: {
    ema: boolean
    rsi: boolean
    macd: boolean
    adx: boolean
    atr: boolean
    oi: boolean
    volume: boolean
    squareHeat: boolean
  }
  lastCandle?: OHLCV
  prevCandle?: OHLCV
  volumeCurrent?: number
  volumePrev?: number
  volumeAverage?: number
  volumeEmaAverage?: number
  volumeEmaPeriod?: number
}

// ==================== AI分析结果 ====================

// AI分析结果
export interface AIAnalysis {
  symbol: string
  timestamp: number
  strategyId?: string
  direction: Direction
  confidence: number
  riskLevel: RiskLevel
  isBullish: boolean
  reasoning: string
  // 新增字段
  scoreBreakdown?: ScoreBreakdown
  technicalData: {
    price: number
    rsi: number
    volume: number
    macd?: number
    macdSignal?: number
    macdHistogram?: number
    openInterest?: number
    openInterestChangePercent?: number
    openInterestTrend?: 'increasing' | 'decreasing' | 'flat'
    adx?: number
    adxPeriodLabel?: string
    adxSlope?: number
    support?: number
    resistance?: number
    [key: string]: any
  }
}

// ==================== AI预筛配置 ====================

// AI预筛配置
export interface PreScreenConfig {
  // ADX阈值（趋势强度）
  minAdx?: number // 默认 15
  maxAdx?: number // 默认 60

  // ADX斜率阈值（趋势方向）
  minAdxSlope?: number // 默认 0 (ADX斜率 > 0)

  // ATR阈值（波动率）
  minAtrPercent?: number // 默认 0.002 (0.2%)
  maxAtrPercent?: number // 默认 0.05 (5%)

  // 成交量预估模式：基于K线完成进度预估整根K线成交量后与历史均值比较
  // 解决未收盘K线成交量偏低的问题
  minEstimatedVolumeRatio?: number // 默认 0.3 (预估成交量至少是历史均值的30%)

  // K线完成进度阈值：低于此进度时跳过成交量检查（数据太少不可靠）
  minCandleProgressForVolume?: number // 默认 0.1 (10%)

  // 启用/禁用特定筛选项
  enableAdx?: boolean
  enableAdxSlope?: boolean
  enableAtr?: boolean
  enableVolume?: boolean
}

// ==================== 机器人配置 ====================

// AI分析保存配置
export interface AIAnalysisSaveConfig {
  enabled: boolean
  maxRecords: number
  saveIdle: boolean
  minConfidence?: number
  enableHistorySection?: boolean
}

// 技术指标配置
export interface IndicatorsConfig {
  requiredCandles: number
  adxSlopePeriod: number
  emaSlopePeriod?: number
  emaPeriods?: any
  openInterest?: any
}

// 机器人并发池配置（供 BotConfig 使用）
export interface BotConcurrencyConfig {
  indicator: { maxConcurrency: number }
  ai: { maxConcurrency: number }
  tradeApi: { maxConcurrency: number }
}

// 图表标记控制配置
export interface ChartMarkerConfig {
  showEMAMarkers?: boolean
  showOrderMarkers?: boolean
  showEMALines?: boolean
}

// 机器人系统配置
export interface BotConfig {
  symbols: string[]
  monitorInterval: number
  indicatorsConfig: IndicatorsConfig
  emaPeriods: number[]
  volumeEmaPeriod?: number
  aiCacheTtlMinutes: number
  aiAnalysisConfig: AIAnalysisSaveConfig
  defaultTimeframe?: string
  defaultCandleProgress: number
  commissionRate: number
  concurrencyPool?: BotConcurrencyConfig
  chartMarkerConfig?: ChartMarkerConfig
  /** 初始本金（USDT），用于计算年化收益率。未设置时年化显示为 0 */
  initialCapital?: number
}

// ==================== 仓位与订单 ====================

// 仓位信息
export interface Position {
  symbol: string
  direction: Direction
  entryPrice: number
  quantity: number
  leverage: number
  stopLoss: number
  initialStopLoss: number
  takeProfit1: number
  takeProfit2: number
  openTime: number
  highestPrice?: number
  lowestPrice?: number
  orderId?: string
  stopLossOrderId?: string
  lastStopLossUpdate?: number
  trailingStopData?: any
  entryCommission?: number
}

// 订单信息
export interface Order {
  orderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  quantity: number
  price?: number
  average?: number
  stopPrice?: number
  status: string
  timestamp: number
  info?: any
}

// ==================== 账户信息 ====================

// 账户信息
export interface AccountInfo {
  balance: number
  availableBalance: number
  totalPnL: number
  positions: any[]
}

// 加密货币余额
export interface CryptoBalance {
  asset: string
  free: number
  locked: number
  total: number
}

// ==================== 日志 ====================

// 日志条目
export interface LogEntry {
  timestamp: number
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
  category: string
  message: string
  data?: any
}

// ==================== API响应 ====================

// 通用API响应
export interface ApiResponse<T = any> {
  success: boolean
  message?: string
  data?: T
}

// 机器人状态响应数据
interface StatusResponseData {
  state: {
    isRunning: boolean
    runningStrategies: string[]
    totalStrategies: number
    activeStrategies: number
    currentPositions: number
  }
  config: {
    strategies: any[]
  }
  logs: LogEntry[]
  cryptoBalances: CryptoBalance[]
  positions: Position[]
}

// 机器人状态响应
export interface StatusResponse {
  success: boolean
  message?: string
  data?: StatusResponseData
}

// ==================== 交易历史 ====================

// 交易历史记录
export interface TradeHistory {
  id: string
  strategyId?: string
  symbol: string
  direction: Direction
  entryPrice: number
  exitPrice: number
  quantity: number
  leverage: number
  pnl: number
  pnlPercentage: number
  openTime: number
  closeTime: number
  reason: string
  totalCommission?: number
  
  // 入场信息
  entryConfidence?: number
  entryScore?: number
  entryRiskLevel?: string
  stopLossPrice?: number
  takeProfit1Price?: number
  takeProfit2Price?: number
  
  // 入场技术指标（动态）
  entryIndicators?: Record<string, number>
  
  // AI分析信息
  aiReasoning?: string
  
  // 持仓统计
  highestPrice?: number
  lowestPrice?: number
  maxFloatingProfit?: number
  maxFloatingProfitPercent?: number
  maxFloatingLoss?: number
  maxFloatingLossPercent?: number
  holdingMinutes?: number
  
  // 平仓分类
  closeCategory?: 'stop_loss' | 'take_profit' | 'timeout' | 'manual' | 'trailing_stop' | 'unknown'
}

// ==================== 机器人状态 ====================

// 熔断状态
export interface CircuitBreaker {
  isTriggered: boolean
  reason: string
  timestamp: number
  dailyLoss: number
  consecutiveLosses: number
}

// 机器人状态
export interface BotState {
  status: PositionStatus
  circuitBreaker: CircuitBreaker
  dailyPnL: number
  isRunning: boolean
  lastTradeTime?: number
}