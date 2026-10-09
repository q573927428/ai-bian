// ==================== 策略管理系统类型定义 ====================

// 策略唯一标识
export type StrategyId = string;

// 策略版本号
export type StrategyVersion = number;

// K线周期
export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

// 周期角色类型
export type TimeframeRole = 'trend' | 'confirm' | 'entry';

// 带角色的周期配置
export interface TimeframeWithRole {
  tf: Timeframe;
  role: TimeframeRole;
}

// AI输入数据结构 - 单个周期指标数据
export interface TimeframeData {
  timeframe: string;
  ema?: {
    fast: number;
    medium: number;
    slow: number;
  };
  rsi?: number;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
    previousMacd: number;
    previousSignal: number;
    previousHistogram: number;
    crossover: 'golden' | 'dead' | 'none';
    histogramTrend: 'rising' | 'falling' | 'flat';
  };
  adx?: number;
  adxSlope?: number;
  atr?: number;
  oi?: {
    value: number;
    changePercent: number;
    trend: 'increasing' | 'decreasing' | 'flat';
  };
}

// AI输入数据结构
export interface AIInput {
  symbol: string;
  price: number;
  timeframes: TimeframeData[];
}

// 技术指标类型
export type IndicatorType = 'EMA' | 'RSI' | 'MACD' | 'ATR' | 'ADX';

// 统计数据类型
export type StatisticsType = 'OI' | 'Volume' | 'SquareHeat';

// AI提供商类型
export type AIProvider = 'deepseek' | 'doubao' | 'doubao-agent' | 'qwen' | 'openai';

// AI模型类型
export type AIModel = 'deepseek-flash' | 'deepseek-v4-pro' | string;

// 保证金模式
export type MarginMode = 'cross' | 'isolated';

// 持仓模式
export type PositionMode = 'one-way' | 'hedge';

// 杠杆类型
export type LeverageType = number | 'dynamic';

// 交易方向
 export type TradeDirection = 'long' | 'short' | 'idle';

// 交易动作
export type TradeAction = 'open' | 'close' | 'hold';

// 策略开仓阈值的判定依据；both 表示置信度与 finalScore 必须同时达标
export type EntryThresholdMode = 'confidence' | 'finalScore' | 'both';

// ==================== 策略配置 ====================

// 策略定义
export interface Strategy {
  id: StrategyId;                      // 策略唯一ID (UUID)
  name: string;                        // 策略名称
  version: StrategyVersion;            // 版本号 (从1开始递增)
  createdAt: string;                   // 创建时间
  updatedAt: string;                   // 更新时间
  isActive: boolean;                   // 是否激活
  
  // 市场数据配置
  marketData: MarketDataConfig;
  
  // 技术指标配置
  indicators: IndicatorConfig[];
  
  // 统计数据配置
  statistics: StatisticsConfig[];
  
  // AI 提示词配置
  aiPrompt: AIPromptConfig;
  
  // 风险管理配置
  riskManagement: RiskConfig;
  
  // 执行配置
  executionConfig: ExecutionConfig;
  
  // 结构化规则（可选）
  structuredRules?: any;
  
  // 策略级 AI 预筛配置
  preScreenConfig?: PreScreenConfig;
  // 策略级最小置信度阈值
  minConfidence?: number;
  // 策略级最小最终评分阈值 
  minFinalScore?: number;
  // 开仓时使用的阈值类型，默认使用置信度
  entryThresholdMode?: EntryThresholdMode;
  // 策略级最大风险等级
  maxRiskLevel?: RiskLevel;
  
  // 版本历史
  versionHistory: VersionHistory[];

  // 运行数据
  performance: StrategyPerformance;    // 策略整体表现统计
  tradeRecords?: TradeRecord[];        // 所有交易记录（已移至全局文件，不再在策略文件中保存）
  sessions: StrategySession[];         // 所有运行会话
  currentSessionId?: string;           // 当前运行会话ID
}

// 市场数据配置
export interface MarketDataConfig {
  symbols: string[];                   // 交易对列表 ["BTC/USDT", "ETH/USDT"]
  timeframes: Timeframe[];             // K线周期 "5m",["15m", "1h", "4h", "1d"]
}

// 技术指标配置
export interface IndicatorConfig {
  id: string;                          // 指标唯一ID
  type: IndicatorType;                 // 指标类型
  params: Record<string, any>;         // 参数，如 { period: 14 } 或 { periods: [14, 60, 120] }
  timeframes: Timeframe[];             // 适用的时间周期
  enabled: boolean;                    // 是否启用
}

// 统计数据配置
export interface StatisticsConfig {
  id: string;                          // 统计项唯一ID
  type: StatisticsType;                // 统计类型
  params: Record<string, number>;      // 参数
  timeframes: Timeframe[];             // 适用的时间周期
  enabled: boolean;                    // 是否启用
}

// AI 提示词配置
export interface AIPromptConfig {
  userPrompt: string;                  // 用户提示词（交易逻辑）
  thinkingEnabled?: boolean;            // 思考模式开关（模型不支持时忽略）
  temperature: number;                 // AI 温度 (0-1)
  maxTokens: number;                   // 最大token数
  model: AIModel;                      // AI模型
  provider: AIProvider;                // AI提供商
  // OpenAI 兼容自定义配置（当 provider 为 openai 时可选）
  apiUrl?: string;                     // 自定义 API URL
  apiKey?: string;                     // 自定义 API Key
}

// 风险管理配置
export interface RiskConfig {
  maxRiskPercentage: number;           // 单笔最大风险 (%)
  stopLossATRMultiplier: number;       // 止损ATR倍数
  takeProfitRatios: number[];          // 止盈盈亏比 [2.5, 3.5]
  maxDailyTrades: number;              // 每日最大交易次数
  maxDailyLoss: number;                // 每日最大亏损 (%)
  maxHoldTimeMinutes?: number;         // 最大持仓时间 (分钟)
  trailingStop: TrailingStopConfig;
  rsiExtreme?: { long: number; short: number };
}

// 移动止损配置
export interface TrailingStopConfig {
  enabled: boolean;                    // 是否启用移动止损
  activationRatio: number;             // 激活盈亏比
  trailDistance: number;               // 跟踪距离 (ATR倍数)
  minMoveDistance: number;             // 最小移动距离 (%)
}

// 执行配置
export interface ExecutionConfig {
  scanInterval: number;                // 扫描间隔 (分钟，必须为5的倍数)
  leverage: LeverageType;              // 杠杆 (固定值或动态)
  marginMode: MarginMode;              // 保证金模式
  positionMode: PositionMode;          // 持仓模式
  dynamicLeverageMin?: number;         // 动态杠杆最小杠杆（仅当 leverage === 'dynamic' 时生效），默认 1
  dynamicLeverageMax?: number;         // 动态杠杆最大杠杆（仅当 leverage === 'dynamic' 时生效），默认 50
}

// 版本历史
export interface VersionHistory {
  version: StrategyVersion;            // 版本号
  updatedAt: string;                   // 更新时间
  changes: string;                     // 变更说明
  snapshot: Strategy;                  // 该版本的完整配置快照
}

// ==================== 策略操作输入 ====================

import type { PreScreenConfig, RiskLevel } from './index'

// 创建策略输入
export interface CreateStrategyInput {
  name: string;
  marketData: MarketDataConfig;
  indicators: IndicatorConfig[];
  statistics: StatisticsConfig[];
  aiPrompt: AIPromptConfig;
  riskManagement: RiskConfig;
  executionConfig: ExecutionConfig;
  structuredRules?: any;
  /** 策略级 AI 预筛配置（覆盖全局 bot-config.preScreenConfig），表单始终提供默认值 */
  preScreenConfig: PreScreenConfig;
  /** 策略级最小置信度阈值（覆盖全局 bot-config.minConfidence），未配置时回退到全局 */
  minConfidence?: number;
  /** 策略级最小最终评分阈值（覆盖全局 bot-config.minFinalScore），未配置时回退到全局 */
  minFinalScore?: number;
  /** 开仓阈值类型，默认使用 confidence */
  entryThresholdMode?: EntryThresholdMode;
  /** 策略级最大风险等级（覆盖全局 bot-config.maxRiskLevel），未配置时回退到全局 */
  maxRiskLevel?: RiskLevel;
}

// 更新策略输入
export interface UpdateStrategyInput {
  name?: string;
  marketData?: MarketDataConfig;
  indicators?: IndicatorConfig[];
  statistics?: StatisticsConfig[];
  aiPrompt?: AIPromptConfig;
  riskManagement?: RiskConfig;
  executionConfig?: ExecutionConfig;
  structuredRules?: any;
  /** 策略级 AI 预筛配置（覆盖全局 bot-config.preScreenConfig），未配置时回退到全局 */
  preScreenConfig?: PreScreenConfig;
  /** 策略级最小置信度阈值（覆盖全局 bot-config.minConfidence），未配置时回退到全局 */
  minConfidence?: number;
  /** 策略级最小最终评分阈值（覆盖全局 bot-config.minFinalScore），未配置时回退到全局 */
  minFinalScore?: number;
  /** 开仓阈值类型，默认使用 confidence */
  entryThresholdMode?: EntryThresholdMode;
  /** 策略级最大风险等级（覆盖全局 bot-config.maxRiskLevel），未配置时回退到全局 */
  maxRiskLevel?: RiskLevel;
}

// ==================== 策略状态 ====================

// 策略运行状态
export interface StrategyStatus {
  id: StrategyId;
  name: string;
  version: StrategyVersion;
  isActive: boolean;
  isRunning: boolean;                  // 是否正在运行
  lastScanTime?: string;               // 上次扫描时间
  lastSignalTime?: string;             // 上次信号时间
  totalSignals: number;                // 总信号数
  totalTrades: number;                 // 总交易数
  winRate: number;                     // 胜率
  currentPositions: number;            // 当前持仓数
  error?: string;                      // 错误信息
}

// ==================== 指标订阅 ====================

// 指标订阅配置
export interface IndicatorSubscription {
  symbols: string[];
  timeframes: Timeframe[];
  indicatorTypes: IndicatorType[];
  statisticsTypes: StatisticsType[];
}

// ==================== 缓存数据 ====================

// 缓存的数据项
export interface CachedData {
  key: string;
  data: any;
  timestamp: number;
  ttl: number;                         // 存活时间 (毫秒)
}

// ==================== 指标数据 ====================

// 指标数据
export interface IndicatorData {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;
  values: Record<string, any>;         // 指标值，如 { ema: [...], rsi: 45.2 }
}

// ==================== 策略运行数据 ====================

// 开单记录
export interface TradeRecord {
  id: string; // 记录唯一ID
  strategyId: StrategyId; // 策略ID
  strategyVersion: StrategyVersion; // 策略版本
  symbol: string; // 交易对
  direction: TradeDirection; // 交易方向
  action: TradeAction; // 交易动作
  entryPrice: number; // 入场价格
  exitPrice?: number; // 出场价格
  quantity: number; // 数量
  leverage: number; // 实际使用杠杆
  marginMode: MarginMode; // 保证金模式
  positionMode: PositionMode; // 持仓模式
  openTime: string; // 开仓时间
  closeTime?: string; // 平仓时间
  profitLoss?: number; // 盈亏金额（毛利，未扣除手续费）
  profitLossPercentage?: number; // 盈亏百分比（毛利）
  netProfitLoss?: number; // 净利金额（已扣除手续费）
  netProfitLossPercentage?: number; // 净利百分比（已扣除手续费）
  totalCommission?: number; // 总手续费
  status: 'open' | 'closed' | 'canceled'; // 订单状态
  reason?: string; // 开/平仓原因
  txHash?: string; // 交易哈希
}

// 策略运行统计
export interface StrategyPerformance {
  strategyId: StrategyId,
  totalTrades: number,
  totalWins: number,
  totalLosses: number,
  winRate: number,
  totalProfit: number,
  totalLoss: number,
  netProfit: number,
  profitFactor: number,
  maxDrawdown: number,
  averageProfitPerTrade: number,
  averageLossPerTrade: number,
  largestWin: number,
  largestLoss: number,
  averageHoldTime: number,
  consecutiveWins: number,
  consecutiveLosses: number,
  maxConsecutiveWins: number,
  maxConsecutiveLosses: number,
  dailyPnL: number,
  todayTrades: number,
  updatedAt: string,
}

// 策略运行会话
export interface StrategySession {
  id: string;                          // 会话ID
  strategyId: StrategyId;              // 策略ID
  strategyVersion: StrategyVersion;    // 策略版本
  startTime: string;                   // 启动时间
  endTime?: string;                    // 停止时间
  status: 'running' | 'stopped' | 'error'; // 会话状态
  totalSignals: number;                // 本次会话产生的信号数
  totalTrades: number;                 // 本次会话交易次数
  sessionProfit: number;               // 本次会话盈利
  errorMessage?: string;               // 错误信息
}

