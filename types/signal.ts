// ==================== 交易信号类型定义 ====================

import type { StrategyId, TradeDirection, TradeAction } from './strategy';
import type { Timeframe } from './strategy';

// ==================== 标准交易信号 ====================

// AI 返回的标准交易信号
export interface TradeSignal {
  strategyId: StrategyId;              // 触发策略ID
  symbol: string;                      // 交易对
  direction: TradeDirection;           // 方向: 'long' | 'short'
  action: TradeAction;                 // 动作: 'open' | 'close' | 'hold'
  price: number;                       // 当前价格
  stopLoss: number;                    // 止损价
  takeProfit?: number[];               // 止盈价数组
  confidence: number;                  // 置信度 (0-100)
  leverage?: number;                   // 建议杠杆
  positionSize?: number;               // 建议仓位大小
  reasoning: string;                   // AI 决策理由
  indicators: IndicatorValues;         // 触发时的指标值
  timestamp: string;                   // 信号时间
}

// ==================== 指标值 ====================

// 指标值（AI返回的结构化数据）
export interface IndicatorValues {
  ema?: EMAValues;
  rsi?: number;
  macd?: MACDValues;
  atr?: number;
  oi?: OIValues;
  volume?: VolumeValues;
}

// EMA 指标值
export interface EMAValues {
  fast: number;                        // 快线 EMA
  medium?: number;                     // 中线 EMA
  slow: number;                        // 慢线 EMA
  trend?: 'bullish' | 'bearish';       // 趋势方向
}

// MACD 指标值
export interface MACDValues {
  macd: number;                        // MACD 线
  signal: number;                      // 信号线
  histogram: number;                   // 柱状图
  trend?: 'bullish' | 'bearish';       // 趋势方向
}

// OI 持仓量值
export interface OIValues {
  value: number;                       // 当前持仓量
  trend: 'increasing' | 'decreasing' | 'flat'; // OI趋势
  changePercent?: number;              // 变化率 (%)
}

// 成交量值
export interface VolumeValues {
  current: number;                     // 当前成交量
  average: number;                     // 平均成交量
  ratio?: number;                      // 量比
}

// ==================== 信号验证 ====================

// 信号验证结果
export interface SignalValidationResult {
  isValid: boolean;                    // 是否有效
  errors?: string[];                   // 错误列表
  warnings?: string[];                 // 警告列表
}

// ==================== 信号缓存 ====================

// 信号缓存项
export interface SignalCacheItem {
  key: string;                         // 缓存键
  signal: TradeSignal;                 // 信号
  timestamp: number;                   // 缓存时间
  ttl: number;                         // 存活时间 (毫秒)
}

// ==================== AI 分析输入输出 ====================

// AI 分析输入数据
export interface AIAnalysisInput {
  strategyId: StrategyId;              // 策略ID
  symbol: string;                      // 交易对
  timeframe: Timeframe;                // 时间周期
  systemPrompt: string;                // 系统提示词
  userPrompt: string;                  // 用户交易逻辑
  indicators: IndicatorValues;         // 指标数据
  marketData: MarketDataInput;         // 市场数据
  temperature: number;                 // AI 温度
  maxTokens: number;                   // 最大token数
  model: string;                       // AI模型
}

// 市场数据输入
export interface MarketDataInput {
  symbol: string;                      // 交易对
  price: number;                       // 当前价格
  change24h?: number;                  // 24小时涨跌幅
  volume24h?: number;                  // 24小时成交量
  high24h?: number;                    // 24小时最高价
  low24h?: number;                     // 24小时最低价
  timestamp: string;                   // 时间戳
}

// AI 分析原始响应
export interface AIAnalysisRawResponse {
  rawText: string;                     // AI 原始返回文本
  parsedJson: any;                     // 解析后的 JSON
  isValid: boolean;                    // 是否有效
  parseError?: string;                 // 解析错误
}

// ==================== 信号生成上下文 ====================

// 信号生成上下文
export interface SignalGenerationContext {
  strategyId: StrategyId;              // 策略ID
  symbol: string;                      // 交易对
  indicators: IndicatorValues;         // 指标数据
  marketData: MarketDataInput;         // 市场数据
  aiPrompt: {                          // AI 提示词
    systemPrompt: string;
    userPrompt: string;
  };
  riskLimits: {                        // 风险限制
    maxRiskPercentage: number;
    stopLossATRMultiplier: number;
    maxDailyTrades: number;
    maxDailyLoss: number;
  };
  currentPosition?: {                  // 当前持仓（如果有）
    direction: TradeDirection;
    entryPrice: number;
    quantity: number;
  };
}

// ==================== 信号执行结果 ====================

// 信号执行结果
export interface SignalExecutionResult {
  success: boolean;                    // 是否成功
  signal: TradeSignal;                 // 执行的信号
  orderId?: string;                    // 订单ID
  error?: string;                      // 错误信息
  timestamp: string;                   // 执行时间
}
