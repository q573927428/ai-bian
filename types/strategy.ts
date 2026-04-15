// ==================== 策略管理系统类型定义 ====================

// 策略唯一标识
export type StrategyId = string;

// 策略版本号
export type StrategyVersion = number;

// K线周期
export type Timeframe = '15m' | '1h' | '4h' | '1d';

// 技术指标类型
export type IndicatorType = 'EMA' | 'RSI' | 'MACD' | 'ATR' | 'ADX';

// 统计数据类型
export type StatisticsType = 'OI' | 'Volume';

// AI模型类型
export type AIModel = 'deepseek-chat' | 'deepseek-coder' | string;

// 保证金模式
export type MarginMode = 'cross' | 'isolated';

// 持仓模式
export type PositionMode = 'one-way' | 'hedge';

// 杠杆类型
export type LeverageType = number | 'dynamic';

// 交易方向
export type TradeDirection = 'long' | 'short';

// 交易动作
export type TradeAction = 'open' | 'close' | 'hold';

// ==================== 策略配置 ====================

// 策略定义
export interface Strategy {
  id: StrategyId;                      // 策略唯一ID (UUID)
  name: string;                        // 策略名称
  description: string;                 // 策略描述
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
  
  // 版本历史
  versionHistory: VersionHistory[];
}

// 市场数据配置
export interface MarketDataConfig {
  symbols: string[];                   // 交易对列表 ["BTC/USDT", "ETH/USDT"]
  timeframes: Timeframe[];             // K线周期 ["15m", "1h", "4h", "1d"]
  klineLimit: number;                  // K线获取数量 (默认300)
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
  systemPrompt: string;                // 系统提示词（固定部分）
  userPrompt: string;                  // 用户提示词（交易逻辑）
  temperature: number;                 // AI 温度 (0-1)
  maxTokens: number;                   // 最大token数
  model: AIModel;                      // AI模型
}

// 风险管理配置
export interface RiskConfig {
  maxRiskPercentage: number;           // 单笔最大风险 (%)
  stopLossATRMultiplier: number;       // 止损ATR倍数
  takeProfitRatios: number[];          // 止盈盈亏比 [2.5, 3.5]
  maxDailyTrades: number;              // 每日最大交易次数
  maxDailyLoss: number;                // 每日最大亏损 (%)
  trailingStop: TrailingStopConfig;
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
  scanInterval: number;                // 扫描间隔 (秒)
  leverage: LeverageType;              // 杠杆 (固定值或动态)
  marginMode: MarginMode;              // 保证金模式
  positionMode: PositionMode;          // 持仓模式
}

// 版本历史
export interface VersionHistory {
  version: StrategyVersion;            // 版本号
  updatedAt: string;                   // 更新时间
  changes: string;                     // 变更说明
  snapshot: Strategy;                  // 该版本的完整配置快照
}

// ==================== 策略操作输入 ====================

// 创建策略输入
export interface CreateStrategyInput {
  name: string;
  description: string;
  marketData: MarketDataConfig;
  indicators: IndicatorConfig[];
  statistics: StatisticsConfig[];
  aiPrompt: AIPromptConfig;
  riskManagement: RiskConfig;
  executionConfig: ExecutionConfig;
}

// 更新策略输入
export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  marketData?: MarketDataConfig;
  indicators?: IndicatorConfig[];
  statistics?: StatisticsConfig[];
  aiPrompt?: AIPromptConfig;
  riskManagement?: RiskConfig;
  executionConfig?: ExecutionConfig;
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
