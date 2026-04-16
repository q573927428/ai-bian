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
  tp1MinProfitRatio: number
  rsiExtreme: { long: number; short: number }
  adxDecreaseThreshold: number
  adxSlopePeriod: number
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
 * 检查熔断条件
 */
export function checkCircuitBreaker(
  dailyPnL: number,
  consecutiveLosses: number,
  accountBalance: number,
  circuitBreakerConfig: CircuitBreakerConfig
): any {
  const dailyLossPercent = (Math.abs(dailyPnL) / accountBalance) * 100

  // 当日亏损 >= 配置阈值
  if (dailyPnL < 0 && dailyLossPercent >= circuitBreakerConfig.dailyLossThreshold) {
    return {
      isTriggered: true,
      reason: `当日亏损达到${dailyLossPercent.toFixed(2)}%，触发熔断`,
      timestamp: Date.now(),
      dailyLoss: dailyLossPercent,
      consecutiveLosses,
    }
  }

  // 连续止损达到配置阈值
  if (consecutiveLosses >= circuitBreakerConfig.consecutiveLossesThreshold) {
    return {
      isTriggered: true,
      reason: `连续${consecutiveLosses}笔止损，触发熔断`,
      timestamp: Date.now(),
      dailyLoss: dailyLossPercent,
      consecutiveLosses,
    }
  }

  return {
    isTriggered: false,
    reason: '',
    timestamp: Date.now(),
    dailyLoss: dailyLossPercent,
    consecutiveLosses,
  }
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

  const holdTimeMs = Date.now() - position.openTime
  const holdTimeMinutes = holdTimeMs / (1000 * 60)

  // 仅当ADX走弱时才检查超时
  if (!isADXDecreasing) {
    return false
  }

  return holdTimeMinutes >= timeoutMinutes
}

/**
 * 检查是否达到TP1条件（整合保护机制：盈亏比，或RSI极值，或ADX走弱）
 * 必须至少达到最小盈利才允许触发
 */
export function checkTP1Condition(
  position: Position,
  currentPrice: number,
  indicators: any,
  takeProfitConfig: TakeProfitConfig
): { shouldClose: boolean; reason: string; data: any } {
  const rsi = indicators.rsi
  const adxSlope = indicators.adxSlope
  const { entryPrice, initialStopLoss, stopLoss, direction } = position
  // 使用初始止损计算风险，而不是当前止损
  const risk = Math.abs(entryPrice - initialStopLoss)
  
  let profit = 0
  if (direction === 'LONG') {
    profit = currentPrice - entryPrice
  } else {
    profit = entryPrice - currentPrice
  }
  
  const riskRewardRatio = risk > 0 ? profit / risk : 0
  const requiredRiskRewardRatio = takeProfitConfig.tp1RiskRewardRatio
  
  // 检查各个条件
  const riskRewardTriggered = profit >= risk * requiredRiskRewardRatio
  const rsiTriggered = (direction === 'LONG' && rsi >= takeProfitConfig.rsiExtreme.long) ||
                      (direction === 'SHORT' && rsi <= takeProfitConfig.rsiExtreme.short)
  // 使用ADX斜率判断走弱（负斜率表示ADX下降，绝对值 >= 阈值时触发）
  const adxTriggered = adxSlope <= -takeProfitConfig.adxDecreaseThreshold
  
  // 必须至少达到最小盈利才允许触发TP1
  const minProfitRatio = takeProfitConfig.tp1MinProfitRatio || 1
  const hasMinProfit = profit >= risk * minProfitRatio
  
  // 触发条件：必须达到最小盈利，并且满足以下任意条件
  const triggered = hasMinProfit && (riskRewardTriggered || rsiTriggered || adxTriggered)
  
  // 构建原因说明
  let reason = ''
  if (triggered) {
    const reasons: string[] = []
    if (riskRewardTriggered) {
      reasons.push(`盈亏比 ${riskRewardRatio.toFixed(2)}:1 ≥ ${requiredRiskRewardRatio}:1`)
    }
    if (rsiTriggered) {
      const requiredRsi = direction === 'LONG' 
        ? takeProfitConfig.rsiExtreme.long 
        : takeProfitConfig.rsiExtreme.short
      reasons.push(`RSI ${rsi.toFixed(1)} ${direction === 'LONG' ? '≥' : '≤'} ${requiredRsi}`)
    }
    if (adxTriggered) {
      reasons.push(`ADX斜率 ${adxSlope.toFixed(2)} ≤ -${takeProfitConfig.adxDecreaseThreshold}`)
    }
    reason = `达到TP1条件：${reasons.join('，')}（已满足最小盈利${minProfitRatio}R）`
  } else {
    // 提供更详细的未触发原因
    const reasons: string[] = []
    if (!hasMinProfit) {
      reasons.push(`未达到最小盈利${minProfitRatio}R（当前${riskRewardRatio.toFixed(2)}R）`)
    } else {
      if (!riskRewardTriggered) {
        reasons.push(`盈亏比 ${riskRewardRatio.toFixed(2)}:1 < ${requiredRiskRewardRatio}:1`)
      }
      if (!rsiTriggered) {
        const requiredRsi = direction === 'LONG' 
          ? takeProfitConfig.rsiExtreme.long 
          : takeProfitConfig.rsiExtreme.short
        reasons.push(`RSI ${rsi.toFixed(1)} ${direction === 'LONG' ? '<' : '>'} ${requiredRsi}`)
      }
      if (!adxTriggered) {
        reasons.push(`ADX斜率 ${adxSlope.toFixed(2)} > -${takeProfitConfig.adxDecreaseThreshold}`)
      }
    }
    reason = `未达到TP1条件：${reasons.join('，')}`
  }
  
  return {
    shouldClose: triggered,
    reason,
    data: {
      currentPrice,
      entryPrice,
      initialStopLoss,
      currentStopLoss: stopLoss,
      risk,
      profit,
      riskRewardRatio,
      requiredRiskRewardRatio,
      minProfitRatio,
      hasMinProfit,
      rsi,
      adxSlope,
      direction,
      conditionTriggers: {
        riskReward: riskRewardTriggered,
        rsiExtreme: rsiTriggered,
        adxDecrease: adxTriggered
      },
      thresholds: {
        rsiLongExtreme: takeProfitConfig.rsiExtreme.long,
        rsiShortExtreme: takeProfitConfig.rsiExtreme.short,
        adxDecreaseThreshold: takeProfitConfig.adxDecreaseThreshold
      }
    }
  }
}

/**
 * 检查是否达到TP2条件（高阶止盈，仅盈亏比3.6R触发）
 */
export function checkTP2Condition(
  position: Position,
  currentPrice: number,
  indicators: any,
  takeProfitConfig: TakeProfitConfig
): { shouldClose: boolean; reason: string; data: any } {
  const { entryPrice, initialStopLoss, stopLoss, direction } = position
  // 使用初始止损计算风险，而不是当前止损
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
    reason = `达到TP2条件：盈亏比 ${riskRewardRatio.toFixed(2)}:1（要求${requiredRiskRewardRatio}:1）`
  } else {
    reason = `未达到TP2条件：当前盈亏比 ${riskRewardRatio.toFixed(2)}:1（要求${requiredRiskRewardRatio}:1）`
  }
  
  return {
    shouldClose: triggered,
    reason,
    data: {
      currentPrice,
      entryPrice,
      initialStopLoss,
      currentStopLoss: stopLoss,
      risk,
      profit,
      riskRewardRatio,
      requiredRatio: requiredRiskRewardRatio,
      direction
    }
  }
}

/**
 * 计算当前盈亏
 */
export function calculatePnL(
  currentPrice: number,
  position: Position
): { pnl: number; pnlPercentage: number } {
  const { entryPrice, quantity, direction, leverage } = position
  
  let pnl = 0
  if (direction === 'LONG') {
    pnl = (currentPrice - entryPrice) * quantity
  } else {
    pnl = (entryPrice - currentPrice) * quantity
  }
  
  const pnlPercentage = ((pnl / (entryPrice * quantity)) * 100) * leverage
  
  return { pnl, pnlPercentage }
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
 * 获取交易方向对应的订单side
 */
export function getOrderSide(
  direction: 'LONG' | 'SHORT',
  isEntry: boolean
): 'buy' | 'sell' {
  if (direction === 'LONG') {
    return isEntry ? 'buy' : 'sell'
  } else {
    return isEntry ? 'sell' : 'buy'
  }
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
      tp1RiskRewardRatio: strategyRiskConfig.takeProfitRatios?.[0] || 2.5,
      tp2RiskRewardRatio: strategyRiskConfig.takeProfitRatios?.[1] || 3.5,
      tp1MinProfitRatio: 1,
      rsiExtreme: { long: 80, short: 20 },
      adxDecreaseThreshold: 2,
      adxSlopePeriod: 3
    },
    dailyTradeLimit: strategyRiskConfig.maxDailyTrades || 5
  }
}