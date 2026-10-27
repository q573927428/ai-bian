// ==================== 核心类型定义 ====================
import type { MarketBreadthSnapshot } from './market-breadth'
import type { EntrySupportResistance, SupportResistanceSnapshot } from './support-resistance'
import type { EnvironmentContext } from '../app/utils/environment-confidence'

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

/**
 * 入场时的币安广场社区情绪快照
 *
 * 原始帖子计数与当时的派生指标同时保存，确保历史订单不受后续采集数据和算法调整影响。
 */
export interface EntryCommunitySentiment {
  /** 社区情绪统计窗口，单位为分钟 */
  windowMinutes: number
  /** 社区数据实际采集时间，毫秒时间戳 */
  dataUpdatedAt: number
  /** 币安广场热度值，当前等于统计窗口内帖子总数 */
  heat: number
  /** 统计窗口内帖子总数 */
  postCount: number
  /** 同标的、同窗口的历史平均帖子数 */
  historyAveragePostCount: number
  /** 当前热度相对历史均值的变化率 */
  heatChangePercent: number
  /** 热度变化趋势 */
  heatTrend: 'increasing' | 'normal' | 'decreasing'
  /** 明确看涨的帖子数量 */
  bullishCount: number
  /** 明确看跌的帖子数量 */
  bearishCount: number
  /** 未表达明确方向的帖子数量 */
  neutralCount: number
  /** 有明确方向的帖子占全部帖子的比例 */
  directionalCoveragePercent: number
  /** 看涨与看跌样本的净倾向，范围为 -100~100 */
  netDirectionalSentimentPercent: number
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
  /** 计价资产成交额与主动买入额；旧数据或非币安数据源可能缺失。 */
  quoteVolume?: number
  takerBuyQuoteVolume?: number
}

// 技术指标
export interface TechnicalIndicators {
  /** 五分钟预计算区域与本次行情价格更新后的距离快照。 */
  supportResistance?: SupportResistanceSnapshot
  /** 本轮已选交易对市场广度，供 AI 作为整体方向背景参考。 */
  marketBreadth?: MarketBreadthSnapshot
  emaMap: Record<string, number>
  emaList: Array<{ period: number; name: string; value: number; slope?: number }>
  adxPeriodLabel: string
  adx?: number
  adxSlope?: number
  /** 正向方向指标（+DI），与 MDI 比较用于判断多空方向 */
  pdi?: number
  /** 负向方向指标（-DI），与 PDI 比较用于判断多空方向 */
  mdi?: number
  /** 上一根 K 线的 +DI，与当前实时值比较 */
  previousPdi?: number
  /** 上一根 K 线的 -DI，用于识别方向交叉 */
  previousMdi?: number
  /** 有符号方向差值 PDI - MDI，正数多头占优，负数空头占优 */
  diSpread?: number
  /** 绝对差距较上一根 K 线的变化，正数扩大，负数收窄 */
  diGapChange?: number
  rsi?: number
  macd?: {
    macd: number
    signal: number
    histogram: number
    /** 上一根 K 线对应的 MACD 线，用于识别实时交叉 */
    previousMacd: number
    /** 上一根 K 线对应的信号线 */
    previousSignal: number
    /** 上一根 K 线对应的柱体值 */
    previousHistogram: number
    /** 当前未收盘 K 线相对上一根 K 线产生的交叉状态 */
    crossover: 'golden' | 'dead' | 'none'
    /** 当前柱体相对上一根柱体的变化方向 */
    histogramTrend: 'rising' | 'falling' | 'flat'
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
  squareHeatBullishCount?: number
  squareHeatBearishCount?: number
  squareHeatNeutralCount?: number
  squareHeatDirectionalCoveragePercent?: number
  squareHeatNetDirectionalSentimentPercent?: number
  squareHeatDataUpdatedAt?: number
  /** 社区情绪统计窗口，单位为分钟，来源于策略 maxHoldTimeMinutes */
  squareHeatWindowMinutes?: number
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
  /** 提供给AI的环境置信度参考快照。 */
  environmentContext?: EnvironmentContext
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
    previousMacd?: number
    previousMacdSignal?: number
    previousMacdHistogram?: number
    macdCrossover?: 'golden' | 'dead' | 'none'
    macdHistogramTrend?: 'rising' | 'falling' | 'flat'
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

  // OI 变化率阈值（百分数，例如 0.2 表示 0.2%）
  minOiChangePercent?: number // 默认 0.2%
  maxOiChangePercent?: number // 默认 10%

  // 成交量预估模式：基于K线完成进度预估整根K线成交量后与历史均值比较
  // 解决未收盘K线成交量偏低的问题
  minEstimatedVolumeRatio?: number // 默认 0.3 (预估成交量至少是历史均值的30%)

  // K线完成进度阈值：低于此进度时跳过成交量检查（数据太少不可靠）
  minCandleProgressForVolume?: number // 默认 0.1 (10%)

  // 启用/禁用特定筛选项
  enableAdx?: boolean
  enableAdxSlope?: boolean
  enableAtr?: boolean
  enableOi?: boolean
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

export interface BotStrategySchedulerConfig {
  symbolBatchSize: number
  symbolBatchDelayMs: number
  maxLoopDurationMs: number
}

export interface BotAIRateLimitConfig {
  maxConcurrent: number
  maxRequestsPerMinute: number
  maxRequestsPerScan: number
  timeoutMs: number
  cooldownAfterErrorMs: number
}

export interface BotBinanceRateLimitConfig {
  marketDataConcurrency: number
  accountConcurrency: number
  tradeConcurrency: number
  maxUsedWeight1mRatio: number
  retryBaseMs: number
  retryMaxMs: number
}

export interface BotIndicatorPrecomputeConfig {
  enabled: boolean
  intervalMs: number
  maxConcurrency: number
  staleTtlMs: number
  computeOnStrategyChange: boolean
  technicalIndicatorIntervalMs?: number
  oiFastIntervalMs?: number
  oiSlowIntervalMs?: number
  squareHeatIntervalMs?: number
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
  /** 保存交易对列表时是否同步更新所有策略的交易对。 */
  syncSymbolsToStrategies?: boolean
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
  strategyScheduler?: BotStrategySchedulerConfig
  aiRateLimit?: BotAIRateLimitConfig
  binanceRateLimit?: BotBinanceRateLimitConfig
  indicatorPrecompute?: BotIndicatorPrecomputeConfig
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
  entryCommissionAsset?: string
  entryCommissionRaw?: number
  entryOrderId?: string
  entryDataSource?: 'binance' | 'estimated'
}

/**
 * 币安订单成交汇总
 *
 * 用于把一个可能包含多笔撮合的订单归并为系统可持久化的真实成交结果。
 */
export interface OrderExecutionSummary {
  orderId: string
  symbol: string
  averagePrice: number
  executedQuantity: number
  quoteQuantity: number
  realizedPnl: number
  commissionInUsdt: number
  commissions: Array<{
    asset: string
    amount: number
    amountInUsdt: number
  }>
  tradeIds: string[]
  timestamp: number
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
  /** 合约账户未实现盈亏，优先采用交易所原始资产数据。 */
  unrealizedProfit?: number
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
  /** 账户标识，用于多账户场景下隔离和汇总交易记录 */
  accountId?: string
  strategyId?: string
  symbol: string
  direction: Direction
  entryPrice: number
  exitPrice: number
  quantity: number
  leverage: number
  /** 入场指标使用的主时间周期 */
  mainTimeframe?: string
  pnl: number
  pnlPercentage: number
  openTime: number
  closeTime: number
  reason: string
  /** 实际出场收益相对于入场初始风险的倍数（R），亏损时为负数 */
  riskRewardRatio?: number
  totalCommission?: number
  /** 持仓期间实际资金费，正数表示收到，负数表示支付 */
  fundingFee?: number
  /** 币安平仓成交返回的已实现毛盈亏 */
  grossRealizedPnl?: number
  entryCommission?: number
  exitCommission?: number
  entryCommissionAsset?: string
  exitCommissionAsset?: string
  entryCommissionRaw?: number
  exitCommissionRaw?: number
  entryOrderId?: string
  /** 币安条件止损算法订单ID，用于查询触发状态和实际出场订单 */
  stopLossOrderId?: string
  /** 真实出场订单ID，可用于查询成交明细 */
  exitOrderId?: string
  executionTradeIds?: string[]
  /** binance 表示真实成交结算，estimated 表示兼容回退计算 */
  settlementSource?: 'binance' | 'estimated'
  reconciliationStatus?: 'confirmed' | 'estimated'
  
  // 入场信息
  entryConfidence?: number
  entryScore?: number
  /** 入场评分明细，用于分析各评分维度与最终收益的关系 */
  entryScoreBreakdown?: ScoreBreakdown
  entryRiskLevel?: string
  /** 入场时设置的初始止损价 */
  stopLossPrice?: number
  /** 平仓前最后生效的止损价，可与初始止损价对比移动止损效果 */
  finalStopLossPrice?: number
  /** 持仓期间止损价实际向盈利方向移动的次数 */
  trailingStopCount?: number
  takeProfit1Price?: number
  takeProfit2Price?: number
  
  // 入场技术指标（动态）
  entryIndicators?: Record<string, number>
  /** AI 决策时的完整结构快照，开仓后冻结，供历史复盘。 */
  entrySupportResistance?: EntrySupportResistance

  /** AI 分析并决定入场时的 K 线完成进度，以百分比表示 */
  candleProgressPercent?: number

  /** 入场时的社区情绪快照，仅在策略启用 SquareHeat 时保存 */
  entryCommunitySentiment?: EntryCommunitySentiment
  
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
