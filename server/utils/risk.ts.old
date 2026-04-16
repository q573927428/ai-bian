import type { CircuitBreaker, Position, BotConfig } from '../../types'
import dayjs from 'dayjs'

/**
 * 检查熔断条件
 */
export function checkCircuitBreaker(
  dailyPnL: number,
  consecutiveLosses: number,
  accountBalance: number,
  riskConfig: BotConfig['riskConfig']
): CircuitBreaker {
  const dailyLossPercent = (Math.abs(dailyPnL) / accountBalance) * 100

  // 当日亏损 >= 配置阈值
  if (dailyPnL < 0 && dailyLossPercent >= riskConfig.circuitBreaker.dailyLossThreshold) {
    return {
      isTriggered: true,
      reason: `当日亏损达到${dailyLossPercent.toFixed(2)}%，触发熔断`,
      timestamp: Date.now(),
      dailyLoss: dailyLossPercent,
      consecutiveLosses,
    }
  }

  // 连续止损达到配置阈值
  if (consecutiveLosses >= riskConfig.circuitBreaker.consecutiveLossesThreshold) {
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
 * 检查是否需要重置日期状态
 */
export function shouldResetDailyState(lastResetDate: string): boolean {
  const today = dayjs().format('YYYY-MM-DD')
  return lastResetDate !== today
}

/**
 * 检查是否到了强制平仓时间
 */
export function shouldForceLiquidate(riskConfig: BotConfig['riskConfig']): boolean {
  // 首先检查开关是否启用
  if (!riskConfig.forceLiquidateTime.enabled) {
    return false
  }
  
  const now = dayjs()
  const hour = now.hour()
  const minute = now.minute()
  
  // 根据配置的时间强制平仓
  return hour === riskConfig.forceLiquidateTime.hour && 
         minute >= riskConfig.forceLiquidateTime.minute
}

/**
 * 检查持仓是否超时
 */
export function isPositionTimeout(
  position: Position,
  timeoutHours: number,
  adxDecreasing: boolean
): boolean {
  const holdingTime = (Date.now() - position.openTime) / (1000 * 60 * 60) // 小时
  
  return holdingTime >= timeoutHours && adxDecreasing
}

/**
 * 检查是否达到TP1条件（整合保护机制：盈亏比，或RSI极值，或ADX走弱）
 * 必须至少达到最小盈利才允许触发
 */
export function checkTP1Condition(
  currentPrice: number,
  position: Position,
  rsi: number,
  adxSlope: number,
  riskConfig: BotConfig['riskConfig']
): { triggered: boolean; reason: string; data: any } {
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
  const requiredRiskRewardRatio = riskConfig.takeProfit.tp1RiskRewardRatio
  
  // 检查各个条件
  const riskRewardTriggered = profit >= risk * requiredRiskRewardRatio
  const rsiTriggered = (direction === 'LONG' && rsi >= riskConfig.takeProfit.rsiExtreme.long) ||
                      (direction === 'SHORT' && rsi <= riskConfig.takeProfit.rsiExtreme.short)
  // 使用ADX斜率判断走弱（负斜率表示ADX下降，绝对值 >= 阈值时触发）
  const adxTriggered = adxSlope <= -riskConfig.takeProfit.adxDecreaseThreshold
  
  // 必须至少达到最小盈利才允许触发TP1
  const minProfitRatio = riskConfig.takeProfit.tp1MinProfitRatio || 1
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
        ? riskConfig.takeProfit.rsiExtreme.long 
        : riskConfig.takeProfit.rsiExtreme.short
      reasons.push(`RSI ${rsi.toFixed(1)} ${direction === 'LONG' ? '≥' : '≤'} ${requiredRsi}`)
    }
    if (adxTriggered) {
      reasons.push(`ADX斜率 ${adxSlope.toFixed(2)} ≤ -${riskConfig.takeProfit.adxDecreaseThreshold}`)
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
          ? riskConfig.takeProfit.rsiExtreme.long 
          : riskConfig.takeProfit.rsiExtreme.short
        reasons.push(`RSI ${rsi.toFixed(1)} ${direction === 'LONG' ? '<' : '>'} ${requiredRsi}`)
      }
      if (!adxTriggered) {
        reasons.push(`ADX斜率 ${adxSlope.toFixed(2)} > -${riskConfig.takeProfit.adxDecreaseThreshold}`)
      }
    }
    reason = `未达到TP1条件：${reasons.join('，')}`
  }
  
  return {
    triggered,
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
        rsiLongExtreme: riskConfig.takeProfit.rsiExtreme.long,
        rsiShortExtreme: riskConfig.takeProfit.rsiExtreme.short,
        adxDecreaseThreshold: riskConfig.takeProfit.adxDecreaseThreshold
      }
    }
  }
}

/**
 * 检查是否达到TP2条件（高阶止盈，仅盈亏比3.6R触发）
 */
export function checkTP2Condition(
  currentPrice: number,
  position: Position,
  riskConfig: BotConfig['riskConfig']
): { triggered: boolean; reason: string; data: any } {
  const { entryPrice, initialStopLoss, stopLoss, direction } = position
  // 使用初始止损计算风险，而不是当前止损
  const risk = Math.abs(entryPrice - initialStopLoss)
  
  let profit = 0
  if (direction === 'LONG') {
    profit = currentPrice - entryPrice
  } else {
    profit = entryPrice - currentPrice
  }
  
  const requiredRiskRewardRatio = riskConfig.takeProfit.tp2RiskRewardRatio
  const triggered = profit > 0 && profit >= risk * requiredRiskRewardRatio
  const riskRewardRatio = risk > 0 ? profit / risk : 0
  
  let reason = ''
  if (triggered) {
    reason = `达到TP2条件：盈亏比 ${riskRewardRatio.toFixed(2)}:1（要求${requiredRiskRewardRatio}:1）`
  } else {
    reason = `未达到TP2条件：当前盈亏比 ${riskRewardRatio.toFixed(2)}:1（要求${requiredRiskRewardRatio}:1）`
  }
  
  return {
    triggered,
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
  riskConfig: BotConfig['riskConfig']
): boolean {
  return todayTrades < riskConfig.dailyTradeLimit
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
