import type { Position } from '../../types'

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
 * 计算盈亏
 */
export function calculatePnL(
  exitPrice: number,
  position: Position
): { pnl: number; pnlPercentage: number } {
  const { direction, entryPrice, quantity, leverage } = position
  const priceDiff = direction === 'LONG'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice
  const pnl = priceDiff * quantity
  const pnlPercentage = (priceDiff / entryPrice) * 100 * leverage
  return { pnl, pnlPercentage }
}

/**
 * 检查熔断机制
 */
export function checkCircuitBreaker(
  dailyPnL: number,
  consecutiveLosses: number,
  accountBalance: number,
  riskConfig?: any
): {
  isTriggered: boolean
  reason: string
  timestamp: number
  dailyLoss: number
  consecutiveLosses: number
} {
  const circuitBreakerConfig = riskConfig?.circuitBreaker || {}
  const dailyLossThreshold = circuitBreakerConfig.dailyLossThreshold || 10
  const consecutiveLossesThreshold = circuitBreakerConfig.consecutiveLossesThreshold || 5

  const dailyLossPercent = (dailyPnL / accountBalance) * 100

  const isDailyLossTriggered = dailyLossPercent <= -dailyLossThreshold
  const isConsecutiveLossesTriggered = consecutiveLosses >= consecutiveLossesThreshold

  let reason = ''
  let isTriggered = false

  if (isDailyLossTriggered || isConsecutiveLossesTriggered) {
    isTriggered = true
    if (isDailyLossTriggered && isConsecutiveLossesTriggered) {
      reason = `日亏损${dailyLossPercent.toFixed(2)}%超过${dailyLossThreshold}%且连续亏损${consecutiveLosses}次超过${consecutiveLossesThreshold}次`
    } else if (isDailyLossTriggered) {
      reason = `日亏损${dailyLossPercent.toFixed(2)}%超过${dailyLossThreshold}%`
    } else {
      reason = `连续亏损${consecutiveLosses}次超过${consecutiveLossesThreshold}次`
    }
  }

  return { 
    isTriggered, 
    reason, 
    timestamp: Date.now(),
    dailyLoss: dailyPnL,
    consecutiveLosses
  }
}