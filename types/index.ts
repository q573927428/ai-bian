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

// 动态杠杆配置（极简版）
export interface DynamicLeverageConfig {
  enabled: boolean                    // 启用动态杠杆
  minLeverage: number                 // 最小杠杆倍数 (2)
  maxLeverage: number                 // 最大杠杆倍数 (20)
  baseLeverage: number                // 基础杠杆倍数 (5)
  riskLevelMultipliers: Record<RiskLevel, number> // 风险等级乘数
}

// 移动止损配置（简化版）
export interface TrailingStopConfig {
  enabled: boolean                // 是否启用移动止损
  activationRatio: number         // 激活盈亏比（默认 0.5，即盈利达到风险的50%时启用）
  trailingDistance: number        // 跟踪距离（ATR倍数，默认 1.5）
  minMovePercent: number          // 最小移动幅度百分比（默认0.2，止损移动超过这个值才更新）
}

// 策略分析器持久化数据（用于项目重启时恢复）
export interface StrategyAnalyzerData {
  tradeId: string
  symbol: string
  direction: Direction
  entryPrice: number
  openTime: number
  stopLossPrice: number
  takeProfit1Price: number
  takeProfit2Price: number
  quantity: number
  leverage: number
  
  // MFE/MAE跟踪
  maxFavorableExcursion: number
  maxFavorableExcursionPercentage: number
  maxAdverseExcursion: number
  maxAdverseExcursionPercentage: number
  
  // 最高价和最低价跟踪
  highestPrice: number
  lowestPrice: number
  lastPrice: number
  
  // 入场指标（可选，因为可能在记录前重启）
  entryIndicators?: {
    rsi: number
    adx15m: number
    adx1h: number
    adx4h: number
    ema20: number
    ema30: number
    ema60: number
    emaFastValues: number[]
    emaMediumValues: number[]
    emaSlowValues: number[]
    atr: number
    adxSlope: number
    openInterest: number
    openInterestChangePercent: number
    openInterestTrend: 'increasing' | 'decreasing' | 'flat'
  }
  
  // AI分析指标（可选）
  aiAnalysis?: {
    confidence: number
    score: number
    riskLevel: RiskLevel
    reasoning: string
    support?: number
    resistance?: number
  }
  
  // ATR增量计算数据（用于计算平均ATR）
  atrSum: number
  atrCount: number
  
  // 更新时间
  lastUpdateTime: number
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

// 价格突破配置
export interface PriceBreakoutConfig {
  enabled: boolean           // 是否启用价格突破指标
  period: number            // 突破周期（默认5）
  requireConfirmation: boolean // 是否需要收盘价确认（可配置开关）
  confirmationCandles: number // 确认K线数量（默认1）
}

// 波动率过滤配置
export interface VolatilityFilterConfig {
  enabled: boolean           // 是否启用波动率过滤
  minATRPercent: number      // 最小ATR百分比阈值（默认 0.5%）
  skipSymbols: string[]      // 跳过波动率检查的交易对列表
}

// 价格行为(PA)策略配置
export interface PriceActionConfig {
  enabled: boolean               // 启用价格行为(PA)策略
  skipOtherChecks: boolean       // 满足PA条件直接开仓，跳过所有其他检查
  pinBarEnabled: boolean         // 启用Pin Bar针形K线检测
  shadowBodyRatio: number        // Pin Bar影线/实体比例阈值
  maxBodyRatio: number           // Pin Bar实体最大占比阈值
  engulfingEnabled: boolean      // 启用吞没形态检测
  minEngulfRatio: number         // 吞没形态最小实体比例阈值
}

// 预判交叉配置
export interface PredictiveCrossConfig {
  enabled: boolean               // 预判交叉总开关
  distancePercent: number        // EMA快慢线距离小于此百分比时触发预判（默认0.08%）
  onlyTrend: boolean             // 只在顺势时预判（默认true）
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

// 技术指标配置
export interface IndicatorsConfig {
  // 计算指标所需K线数量
  requiredCandles: number
  
  // EMA周期配置
  emaPeriods: EMAPeriodsConfig

  // EMA交叉直接入场开关（统一控制金叉做多/死叉做空）
  crossEntryEnabled: boolean
  
  // 是否显示交叉失败原因，默认false（生产模式不显示，日志更简洁）
  showCrossFailureReason?: boolean
  
  // 预判交叉配置
  predictiveCross: PredictiveCrossConfig
  
  // ADX趋势检查配置
  adxTrend: {
    adx1hThreshold: number        // 1小时ADX阈值 (默认 25)
    adx4hThreshold: number        // 4小时ADX阈值 (默认 28)
    adx15mThreshold: number       // 15分钟ADX阈值 (默认 30)
    enableAdx15mVs1hCheck: boolean // 启用15分钟ADX > 1小时ADX检查 (默认 true)
  }
  
  // 统一入场条件配置（PA风格，不再区分多空）
  entryConfig: {
    emaDeviationThreshold: number  // EMA偏离阈值 (默认 0.005 = 0.5%)
    emaDeviationEnabled: boolean   // 是否启用EMA偏离检查 (默认 true)
    emaSlowDeviationThreshold: number  // 慢速EMA偏离阈值 (默认 0.05 = 5%)，根据策略模式动态变化
    emaSlowDeviationEnabled: boolean   // 是否启用慢速EMA偏离检查 (默认 true)，根据策略模式动态变化
    rsiMin: number                 // RSI最小值 (默认 40)
    rsiMax: number                 // RSI最大值 (默认 57.5，函数内部根据方向动态调整)
    candleShadowThreshold: number  // K线影线阈值 (默认 0.005 = 0.5%)
    volumeConfirmation: boolean    // 成交量确认 (默认 true)
    volumeEMAPeriod: number        // EMA成交量周期 (默认 10)
    volumeEMAMultiplier: number    // EMA成交量倍数 (默认 1.2)
    minScoreThreshold: number      // 入场最低评分阈值 (默认 70)
  }
  
  // 价格突破配置
  priceBreakout: PriceBreakoutConfig
  
  // 波动率过滤配置
  volatility: VolatilityFilterConfig
  
  // 价格行为(PA)策略配置
  priceAction: PriceActionConfig
  
  // OI持仓量配置
  openInterest: {
    enabled: boolean // 是否启用OI分析
    trendPeriod: number // OI趋势计算周期（默认10）
    trendThresholdPercent: number // OI趋势变化阈值百分比（默认2%）
    changePeriod: Record<StrategyMode, number> // OI变化率计算周期（根据策略模式）
  }
}

// 系统配置
export interface BotConfig {
  // 交易对
  symbols: string[]
  
  // 杠杆倍数（静态杠杆，当动态杠杆禁用时使用）
  leverage: number
  
  // 单笔最大风险比例（%）
  maxRiskPercentage: number
  
  // 止损ATR倍数
  stopLossATRMultiplier: number
  
  // 最大止损比例（%）
  maxStopLossPercentage: number
  
  // 持仓超时时间（小时）
  positionTimeoutHours: number
  
  // 市场扫描间隔（秒）- 用于寻找交易机会
  scanInterval: number
  
  // 持仓扫描间隔（秒）- 用于监控持仓状态
  positionScanInterval: number
  
  // 交易冷却时间间隔（秒）- 两次交易之间的最小间隔时间
  tradeCooldownInterval: number
  
  // 策略模式
  strategyMode: StrategyMode
  
  // AI分析配置
  aiConfig: AIConfig
  
  // 风险配置
  riskConfig: RiskConfig
  
  // 动态杠杆配置
  dynamicLeverageConfig: DynamicLeverageConfig
  
  // 移动止损配置
  trailingStopConfig: TrailingStopConfig
  
  // 技术指标配置
  indicatorsConfig: IndicatorsConfig
}

// 风险配置
export interface RiskConfig {
  // 熔断配置
  circuitBreaker: {
    dailyLossThreshold: number      // 当日亏损阈值（%）
    consecutiveLossesThreshold: number // 连续止损阈值（次）
  }
  
  // 强制平仓时间
  forceLiquidateTime: {
    enabled: boolean    // 是否启用强制平仓
    hour: number    // 小时（0-23）
    minute: number  // 分钟（0-59）
  }
  
  // 止盈配置
  takeProfit: {
    tp1RiskRewardRatio: number      // TP1盈亏比（1:1）
    tp2RiskRewardRatio: number      // TP2盈亏比（1:2）
    tp1MinProfitRatio: number       // TP2最小盈利比例（默认1R）
    rsiExtreme: {
      long: number   // 多头RSI极值
      short: number  // 空头RSI极值
    }
    adxDecreaseThreshold: number    // ADX下降阈值
    adxSlopePeriod: number          // ADX斜率计算周期（默认3）
  }
  
  // 每日交易限制
  dailyTradeLimit: number
}

// AI配置
export type AIConditionMode = 'SCORE_ONLY' | 'SCORE_AND_CONFIDENCE'
export type AITechnicalPostAdjustmentMode = 'PENALTY_ONLY' | 'BALANCED'

export interface AIConfig {
  enabled: boolean          // 启用AI分析
  analysisInterval?: number // AI分析间隔（秒）
  minConfidence: number     // 最小置信度（0-100）
  minScore: number          // 最小得分（0-100）   
  maxRiskLevel: RiskLevel   // 最大风险等级
  useForEntry: boolean      // 用于开仓决策
  useForExit: boolean       // 用于平仓决策
  cacheDuration: number     // 缓存时长（分钟）
  conditionMode?: AIConditionMode // 入场判定模式：仅score或score+confidence
  technicalPostAdjustmentMode?: AITechnicalPostAdjustmentMode // AI后处理模式：惩罚优先/平衡
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
  // EMA
  ema20: number
  ema30: number
  ema60: number
  // EMA历史数组
  emaFastValues: number[]
  emaMediumValues: number[]
  emaSlowValues: number[]
  
  // ADX (多周期)
  adx15m: number
  adx1h: number
  adx4h: number
  
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
  direction: Direction
  confidence: number        // 0-100
  score: number            // 0-100
  riskLevel: RiskLevel
  isBullish: boolean
  reasoning: string
  technicalData: {
    price: number
    ema20: number
    ema60: number
    rsi: number
    volume: number
    support?: number
    resistance?: number
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
  // 策略分析器持久化数据（用于项目重启时恢复）
  strategyAnalyzerData?: StrategyAnalyzerData
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