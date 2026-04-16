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
  circuitBreakerConfig?: { dailyLossThreshold: number; consecutiveLossesThreshold: number }
): {
  isTriggered: boolean
  reason: string
  timestamp: number
  dailyLoss: number
  consecutiveLosses: number
} {
  // 兼容两种配置格式：直接传入配置对象或包含circuitBreaker的对象
  let config: { dailyLossThreshold?: number; consecutiveLossesThreshold?: number }
  if (circuitBreakerConfig && 'circuitBreaker' in circuitBreakerConfig) {
    config = (circuitBreakerConfig as any).circuitBreaker || {}
  } else {
    config = circuitBreakerConfig || {}
  }
  
  const dailyLossThreshold = config.dailyLossThreshold || 10
  const consecutiveLossesThreshold = config.consecutiveLossesThreshold || 5

  const dailyLossPercent = (Math.abs(dailyPnL) / accountBalance) * 100

  // 当日亏损 >= 配置阈值
  const isDailyLossTriggered = dailyPnL < 0 && dailyLossPercent >= dailyLossThreshold
  // 连续止损达到配置阈值
  const isConsecutiveLossesTriggered = consecutiveLosses >= consecutiveLossesThreshold

  let reason = ''
  let isTriggered = false

  if (isDailyLossTriggered || isConsecutiveLossesTriggered) {
    isTriggered = true
    if (isDailyLossTriggered && isConsecutiveLossesTriggered) {
      reason = `当日亏损达到${dailyLossPercent.toFixed(2)}%且连续${consecutiveLosses}笔止损，触发熔断`
    } else if (isDailyLossTriggered) {
      reason = `当日亏损达到${dailyLossPercent.toFixed(2)}%，触发熔断`
    } else {
      reason = `连续${consecutiveLosses}笔止损，触发熔断`
    }
  }

  return { 
    isTriggered, 
    reason, 
    timestamp: Date.now(),
    dailyLoss: dailyLossPercent,
    consecutiveLosses
  }
}
