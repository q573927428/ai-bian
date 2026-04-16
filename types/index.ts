// 交易方向
export type Direction = 'LONG' | 'SHORT' | 'IDLE'

// 风险等级
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

// 策略模式
export type StrategyMode = 'short_term' | 'medium_term'

// 仓位状态
export enum PositionStatus {
  IDLE = 'IDLE',           // 空仓
  MONITORING = 'MONITORING', // 监控中
  OPENING = 'OPENING',      // 开仓中
  POSITION = 'POSITION',    // 持仓中
  CLOSING = 'CLOSING',      // 平仓中
  HALTED = 'HALTED'        // 熔断停机
}

// 移动止损配置（简化版）
export interface TrailingStopConfig {
  enabled: boolean                // 是否启用移动止损
  activationRatio: number         // 激活盈亏比（默认 0.5，即盈利达到风险的50%时启用）
  trailingDistance: number        // 跟踪距离（ATR倍数，默认 1.5）
  minMovePercent: number          // 最小移动幅度百分比（默认0.2，止损移动超过这个值才更新）
}

// 移动止损数据（简化版，只保存最后一次移动止损信息）
export interface TrailingStopData {
  enabled: boolean                    // 是否启用移动止损
  activationRatio: number             // 激活盈亏比
  trailingDistance: number            // 跟踪距离（ATR倍数）
  minMovePercent: number              // 最小移动幅度百分比
  lastTrailingStopPrice?: number      // 最后一次移动止损价格
  lastTrailingStopUpdateTime?: number // 最后一次移动止损更新时间
  trailingStopCount: number           // 移动止损总次数
}

// EMA周期配置
export interface EMAPeriodsConfig {
  // 短期策略EMA周期
  short_term: {
    fast: number    // 快速EMA周期 (默认 20)
    medium: number  // 中速EMA周期 (默认 30)
    slow: number    // 慢速EMA周期 (默认 60)
  }
  // 中长期策略EMA周期
  medium_term: {
    fast: number    // 快速EMA周期 (默认 50)
    medium: number  // 中速EMA周期 (默认 100)
    slow: number    // 慢速EMA周期 (默认 200)
  }
}

// 持仓量配置
export interface OpenInterestConfig {
  enabled: boolean
  trendPeriod: number
  changePeriod: {
    short_term: number
    medium_term: number
  }
  trendThresholdPercent: number
}

// 技术指标配置
export interface IndicatorsConfig {
  // 计算指标所需K线数量
  requiredCandles: number
  
  // EMA周期配置
  emaPeriods: EMAPeriodsConfig
  
  // 持仓量配置
  openInterest: OpenInterestConfig
}

// 系统配置
export interface BotConfig {
  // 交易对
  symbols: string[]

  // 杠杆倍数
  leverage: number

  // 单笔最大风险比例（%）
  maxRiskPercentage: number

  // 止损ATR倍数
  stopLossATRMultiplier: number

  // 市场扫描间隔（秒）
  scanInterval: number

  // 策略模式
  strategyMode: StrategyMode

  // 风险配置
  riskConfig: RiskConfig

  // 技术指标配置
  indicatorsConfig: IndicatorsConfig
}

// 风险配置
export interface RiskConfig {
  // 止盈配置
  takeProfit: {
    adxSlopePeriod: number          // ADX斜率计算周期
  }
}

// 市场数据
export interface MarketData {
  symbol: string
  price: number
  timestamp: number
  volume: number
}

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
  // EMA动态配置
  emaPeriods: { fast: number, medium: number, slow: number }
  emaNames: { fast: string, medium: string, slow: string }
  emaFast: number
  emaMedium: number
  emaSlow: number
  // EMA历史数组
  emaFastValues: number[]
  emaMediumValues: number[]
  emaSlowValues: number[]
  
  // ADX动态配置
  adxPeriodLabels: { main: string, secondary: string, tertiary: string }
  // ADX (多周期)
  adxMain: number
  adxSecondary: number
  adxTertiary: number
  
  // ADX斜率（当前值 - N周期前的值，负值表示ADX下降）
  adxSlope: number
  
  // RSI
  rsi: number
  
  // ATR
  atr: number
  
  // OI持仓量
  openInterest: number // 当前持仓量
  openInterestChangePercent: number // 持仓量变化率（%）
  openInterestTrend: 'increasing' | 'decreasing' | 'flat' // OI趋势
}

// AI分析结果
export interface AIAnalysis {
  symbol: string
  timestamp: number
  strategyId?: string
  direction: Direction
  confidence: number        // 0-100
  score: number            // 0-100
  riskLevel: RiskLevel
  isBullish: boolean
  reasoning: string
  technicalData: {
    price: number
    ema20?: number
    ema60?: number
    rsi: number
    volume: number
    adxMain?: number
    adxSecondary?: number
    adxTertiary?: number
    adxPeriodLabels?: { main: string, secondary: string, tertiary: string }
    support?: number
    resistance?: number
    [key: string]: any // 允许动态EMA字段
  }
}

// 统一交易信号接口（所有信号函数返回格式）
export interface TradingSignal {
  // 核心必填字段
  type: string                              // 信号类型，支持任意扩展
  triggered: boolean                        // 是否触发有效信号
  direction: 'LONG' | 'SHORT' | null        // 信号方向，无方向时为null
  reason: string                            // 信号描述/原因
  
  // 扩展字段，所有信号特有数据都放这里
  data?: Record<string, any>                // 任意自定义扩展数据
}

// 分析检查点结果
export interface AnalysisCheckpoint {
  name: string
  passed: boolean
  details: string
  data?: any
}

// 分析结果
export interface AnalysisResult {
  symbol: string
  timestamp: number
  passed: boolean
  checkpoints: AnalysisCheckpoint[]
  finalSignal?: TradeSignal
  summary: string
}

// 交易信号
export interface TradeSignal {
  symbol: string
  direction: Direction
  price: number
  confidence: number
  indicators: TechnicalIndicators
  aiAnalysis?: AIAnalysis
  timestamp: number
  reason: string
}

// 仓位信息
export interface Position {
  symbol: string
  direction: Direction
  entryPrice: number
  quantity: number
  leverage: number
  stopLoss: number
  initialStopLoss: number  // 初始止损价格（用于TP条件计算）
  takeProfit1: number
  takeProfit2: number
  openTime: number
  highestPrice?: number    // 持仓期间的最高价（多头追踪止损使用）
  lowestPrice?: number     // 持仓期间的最低价（空头追踪止损使用）
  orderId?: string
  stopLossOrderId?: string
  takeProfitOrderId?: string
  stopLossOrderSymbol?: string
  stopLossOrderSide?: 'BUY' | 'SELL'
  stopLossOrderType?: 'STOP_MARKET' | 'STOP_LIMIT' | 'TAKE_PROFIT_MARKET'  | 'MARKET' | 'LIMIT'
  stopLossOrderQuantity?: number
  stopLossOrderStopPrice?: number
  stopLossOrderStatus?: string
  stopLossOrderTimestamp?: number
  lastStopLossUpdate?: number  // 上次止损更新时间（用于移动止损）
  trailingStopData?: TrailingStopData  // 移动止损数据
}

// 订单信息
export interface Order {
  orderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT' | 'TAKE_PROFIT_MARKET'
  quantity: number
  price?: number
  average?: number  // 平均成交价（对于已成交的订单）
  stopPrice?: number
  status: string
  timestamp: number
  info?: any
}

// 交易记录
export interface TradeHistory {
  id: string
  strategyId?: string  // 所属策略ID
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
}

// 策略分析指标
export interface StrategyAnalysisMetrics {
  // 基础信息
  tradeId: string
  symbol: string
  direction: Direction
  
  // 时间信息
  openTime: number
  closeTime: number
  duration: number  // 持仓时长（毫秒）
  
  // 价格信息
  entryPrice: number
  exitPrice: number
  stopLossPrice: number
  takeProfit1Price: number
  takeProfit2Price: number
  
  // MFE/MAE指标
  mfe: number  // 最大浮盈金额
  mfePercentage: number  // 最大浮盈百分比
  mae: number  // 最大浮亏金额
  maePercentage: number  // 最大浮亏百分比
  
  // 风险回报指标
  riskAmount: number  // 风险金额（初始止损对应的风险）
  rewardAmount: number  // 实际盈利金额
  riskRewardRatio: number  // 风险回报比
  
  // 入场指标
  entryRSI: number  // 入场时的RSI值
  entryADX15m: number  // 入场时的15分钟ADX值
  entryADX1h: number  // 入场时的1小时ADX值
  entryADX4h: number  // 入场时的4小时ADX值
  entryEMA20: number  // 入场时的20周期EMA
  entryEMA60: number  // 入场时的60周期EMA
  entryPriceToEMA20Deviation: number  // 价格与EMA20的偏离度
  entryPriceToEMA60Deviation: number  // 价格与EMA60的偏离度
  
  // AI分析指标
  aiConfidence: number  // AI置信度
  aiScore: number  // AI综合评分
  aiRiskLevel: RiskLevel  // AI风险等级
  aiReasoning: string  // AI分析理由
  aiSupport?: number  // AI分析的支撑位
  aiResistance?: number  // AI分析的阻力位
  aiKeyFactors?: string[]  // AI分析的关键因素
  
  // 出场指标
  exitRSI: number  // 出场时的RSI值
  exitADX15m: number  // 出场时的15分钟ADX值
  exitADX1h: number  // 出场时的1小时ADX值
  exitADX4h: number  // 出场时的4小时ADX值
  exitEMA20: number  // 出场时的20周期EMA
  exitEMA60: number  // 出场时的60周期EMA
  
  // 波动性指标
  averageATR: number  // 持仓期间平均ATR
  priceRangePercentage: number  // 价格波动范围百分比
  maxDrawdownPercentage: number  // 最大回撤百分比
  
  // 资金管理指标
  positionSizePercentage: number  // 仓位大小百分比
  actualLeverage: number  // 实际使用的杠杆倍数
  marginUsed: number  // 使用的保证金
  
  // 交易结果
  pnl: number
  pnlPercentage: number
  exitReason: string
  exitReasonCategory: 'TP1' | 'TP2' | 'STOP_LOSS' | 'TIMEOUT' | 'FORCE_LIQUIDATE' | 'TRAILING_STOP' | 'MANUAL_CLOSE' | 'OTHER'
  
  // 时间特征
  tradeHour: number  // 交易小时（0-23）
  tradeDayOfWeek: number  // 星期几（0-6，0=周日）
  tradeMonth: number  // 月份（1-12）
  
  // 价格历史（可选，用于详细分析）
  priceHistory?: Array<{
    timestamp: number
    price: number
    pnl: number
    pnlPercentage: number
  }>
  
  // 移动止损指标
  trailingStopEnabled?: boolean                    // 是否启用移动止损
  trailingStopActivationRatio?: number            // 移动止损激活盈亏比
  trailingStopDistance?: number                   // 移动止损跟踪距离（ATR倍数）
  trailingStopMinMovePercent?: number             // 移动止损最小移动幅度百分比
  lastTrailingStopPrice?: number                  // 最后一次移动止损价格
  lastTrailingStopUpdateTime?: number             // 最后一次移动止损更新时间
  trailingStopCount?: number                      // 移动止损总次数
  
  // 创建时间
  createdAt: number
}

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
  currentPosition: Position | null
  circuitBreaker: CircuitBreaker
  todayTrades: number
  dailyPnL: number
  lastResetDate: string
  monitoringSymbols: string[]
  isRunning: boolean  // 是否正在运行（扫描循环）
  allowNewTrades: boolean  // 是否允许新交易（用于每日交易限制控制）
  lastTradeTime?: number   // 上次交易时间（用于冷却时间检查）
  currentPrice?: number  // 当前价格（仅当有持仓时有效）
  currentPnL?: number    // 当前盈亏金额（仅当有持仓时有效）
  currentPnLPercentage?: number  // 当前盈亏百分比（仅当有持仓时有效）
  // 总统计数据
  totalTrades?: number
  totalPnL?: number
  winRate?: number
  // 优化相关字段
  lastIndicatorUpdate?: number  // 上次指标计算时间
  lastPrice?: number           // 上次计算指标时的价格
}

// 加密货币余额
export interface CryptoBalance {
  asset: string
  free: number
  locked: number
  total: number
  usdValue?: number
}

// 账户信息
export interface AccountInfo {
  balance: number
  availableBalance: number
  totalPnL: number
  positions: Position[]
  cryptoBalances?: CryptoBalance[]
}

// 日志条目
export interface LogEntry {
  timestamp: number
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
  category: string
  message: string
  data?: any
}

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean
  message?: string
  data?: T
  state?: BotState
  config?: BotConfig
}

// 状态响应数据
export interface StatusResponseData {
  state: BotState
  config: BotConfig
  logs: LogEntry[]
  cryptoBalances?: CryptoBalance[]
}

// 历史统计数据
export interface HistoryStats {
  totalTrades: number
  totalPnL: number
  winRate: number
}

// 历史响应数据
export interface HistoryResponseData extends Array<TradeHistory> {}

// 分页信息
export interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// 状态响应
export type StatusResponse = ApiResponse<StatusResponseData>

// 历史响应
export interface HistoryResponse {
  success: boolean
  message?: string
  data?: HistoryResponseData
  stats?: HistoryStats
  pagination?: PaginationInfo
}

// 启动/停止响应
export interface StartStopResponse {
  success: boolean
  message?: string
  state?: BotState
}

// 配置更新响应
export interface ConfigResponse {
  success: boolean
  message?: string
  config?: BotConfig
}