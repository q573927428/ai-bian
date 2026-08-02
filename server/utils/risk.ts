import type { Position } from '../../types'
import type { RiskConfig as StrategyRiskConfig } from '../../types/strategy'
import dayjs from 'dayjs'

/**
 * 熔断配置（独立于策略风险配置）
 */
export interface CircuitBreakerConfig {
  dailyLossThreshold: number
  consecutiveLossesThreshold: number
}

/**
 * 止盈配置（独立于策略风险配置）
 */
export interface TakeProfitConfig {
  tp1RiskRewardRatio: number
  tp2RiskRewardRatio: number
  rsiExtreme: { long: number; short: number }
}

/**
 * 兼容的风险配置类型（用于现有代码过渡）
 */
export interface CompatibleRiskConfig {
  circuitBreaker?: CircuitBreakerConfig
  takeProfit?: TakeProfitConfig
  dailyTradeLimit?: number
}


/**
 * 检查持仓超时
 * @param position 持仓信息
 * @param timeoutMinutes 超时时间（分钟）
 * @param isADXDecreasing ADX是否走弱
 * @returns 是否超时
 */
export function isPositionTimeout(
  position: Position, 
  timeoutMinutes: number = 1440, 
  isADXDecreasing: boolean
): boolean {
  if (!position.openTime) return false

  // 仅当ADX走弱时才检查超时
  if (!isADXDecreasing) {
    return false
  }

  const holdTimeMs = Date.now() - position.openTime
  if (holdTimeMs < 0) return false
  const holdTimeMinutes = holdTimeMs / (1000 * 60)

  return holdTimeMinutes >= timeoutMinutes
}

/**
 * 检查是否达到TP1条件（整合保护机制：盈亏比或RSI极值）
 * 必须达到盈亏比（riskRewardTriggered）才允许触发
 */
export function checkTP1Condition(
  position: Position,
  currentPrice: number,
  indicators: any,
  takeProfitConfig: TakeProfitConfig
): { shouldClose: boolean; reason: string } {
  const rsi = indicators.rsi
  const adxSlope = indicators.adxSlope
  const emaSlope = indicators.emaSlope
  const { entryPrice, initialStopLoss, direction } = position
  const risk = Math.abs(entryPrice - initialStopLoss)
  
  let profit = 0
  if (direction === 'LONG') {
    profit = currentPrice - entryPrice
  } else {
    profit = entryPrice - currentPrice
  }
  
  const riskRewardRatio = risk > 0 ? profit / risk : 0
  const requiredRiskRewardRatio = takeProfitConfig.tp1RiskRewardRatio
  
  const riskRewardTriggered = profit >= risk * requiredRiskRewardRatio
  const rsiTriggered = (direction === 'LONG' && rsi >= takeProfitConfig.rsiExtreme.long) ||
                      (direction === 'SHORT' && rsi <= takeProfitConfig.rsiExtreme.short)
  
  // 辅助条件：ADX走弱、EMA走弱或RSI触发
  const auxiliaryCondition = adxSlope < 0 || emaSlope < 0 || rsiTriggered
  
  const triggered = riskRewardTriggered && auxiliaryCondition
  
  let reason = ''
  if (triggered) {
    const reasons: string[] = []
    reasons.push(`盈亏比 ${riskRewardRatio.toFixed(2)}:1`)
    if (adxSlope < 0) reasons.push(`ADX走弱`)
    if (emaSlope < 0) reasons.push(`EMA走弱`)
    if (rsiTriggered) reasons.push(`RSI ${rsi.toFixed(1)}`)
    reason = `达到TP1条件：${reasons.join('，')}`
  } else {
    reason = `未达到TP1条件${!riskRewardTriggered ? '（盈亏比未达标）' : ''}`
  }
  
  return { shouldClose: triggered, reason }
}

/**
 * 检查是否达到TP2条件（高阶止盈，仅盈亏比3.6R触发）
 */
export function checkTP2Condition(
  position: Position,
  currentPrice: number,
  indicators: any,
  takeProfitConfig: TakeProfitConfig
): { shouldClose: boolean; reason: string } {
  const { entryPrice, initialStopLoss, direction } = position
  const risk = Math.abs(entryPrice - initialStopLoss)
  
  let profit = 0
  if (direction === 'LONG') {
    profit = currentPrice - entryPrice
  } else {
    profit = entryPrice - currentPrice
  }
  
  const requiredRiskRewardRatio = takeProfitConfig.tp2RiskRewardRatio
  const triggered = profit > 0 && profit >= risk * requiredRiskRewardRatio
  const riskRewardRatio = risk > 0 ? profit / risk : 0
  
  let reason = ''
  if (triggered) {
    reason = `达到TP2条件：盈亏比 ${riskRewardRatio.toFixed(2)}:1`
  } else {
    reason = `未达到TP2条件`
  }
  
  return { shouldClose: triggered, reason }
}

/**
 * 检查止损是否被触发
 */
export function isStopLossTriggered(
  currentPrice: number,
  position: Position
): boolean {
  const { stopLoss, direction } = position
  
  if (direction === 'LONG') {
    return currentPrice <= stopLoss
  } else {
    return currentPrice >= stopLoss
  }
}

/**
 * 检查止盈是否被触发
 */
export function isTakeProfitTriggered(
  currentPrice: number,
  position: Position,
  level: 1 | 2
): boolean {
  const targetPrice = level === 1 ? position.takeProfit1 : position.takeProfit2
  const { direction } = position
  
  if (direction === 'LONG') {
    return currentPrice >= targetPrice
  } else {
    return currentPrice <= targetPrice
  }
}

/**
 * 验证交易参数
 */
export function validateTradeParams(
  symbol: string,
  quantity: number,
  price: number,
  stopLoss: number,
  takeProfit: number
): { valid: boolean; reason: string } {
  if (!symbol || symbol.trim() === '') {
    return { valid: false, reason: '交易对不能为空' }
  }
  
  if (quantity <= 0) {
    return { valid: false, reason: '数量必须大于0' }
  }
  
  if (price <= 0) {
    return { valid: false, reason: '价格必须大于0' }
  }
  
  if (stopLoss <= 0) {
    return { valid: false, reason: '止损价格必须大于0' }
  }
  
  if (takeProfit <= 0) {
    return { valid: false, reason: '止盈价格必须大于0' }
  }
  
  return { valid: true, reason: '' }
}

/**
 * 检查每日交易次数限制
 */
export function checkDailyTradeLimit(
  todayTrades: number,
  dailyTradeLimit: number
): boolean {
  return todayTrades < dailyTradeLimit
}

/**
 * 从策略风险配置转换到兼容的配置格式
 * 用于现有代码的平滑过渡
 */
export function convertStrategyRiskConfig(strategyRiskConfig: StrategyRiskConfig): {
  circuitBreaker: CircuitBreakerConfig
  takeProfit: TakeProfitConfig
  dailyTradeLimit: number
} {
  // 从策略配置中提取熔断和止盈信息
  // 注意：策略配置中可能没有完整的熔断和止盈配置，需要提供默认值
  return {
    circuitBreaker: {
      dailyLossThreshold: strategyRiskConfig.maxDailyLoss || 10,
      consecutiveLossesThreshold: 3
    },
    takeProfit: {
      tp1RiskRewardRatio: strategyRiskConfig.takeProfitRatios?.[0] || 2,
      tp2RiskRewardRatio: strategyRiskConfig.takeProfitRatios?.[1] || 3,
      rsiExtreme: strategyRiskConfig.rsiExtreme || { long: 80, short: 20 }
    },
    dailyTradeLimit: strategyRiskConfig.maxDailyTrades || 5
  }
}