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
 * 计算手续费
 */
export function calculateCommission(
  price: number,
  quantity: number,
  commissionRate: number = 0.0004 // 默认万分之四
): number {
  return price * quantity * commissionRate
}

/**
 * 计算盈亏（包含手续费）
 */
export function calculatePnL(
  exitPrice: number,
  position: Position,
  commissionRate: number = 0.0004
): { 
  pnl: number; // 毛利
  pnlPercentage: number; // 毛利百分比
  netPnl: number; // 净利（已扣手续费）
  netPnlPercentage: number; // 净利百分比
  totalCommission: number; // 总手续费
} {
  const { direction, entryPrice, quantity, leverage } = position
  
  // 计算毛利
  const priceDiff = direction === 'LONG'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice
  const pnl = priceDiff * quantity
  const pnlPercentage = (priceDiff / entryPrice) * 100 * leverage
  
  // 计算手续费
  const entryCommission = calculateCommission(entryPrice, quantity, commissionRate)
  const exitCommission = calculateCommission(exitPrice, quantity, commissionRate)
  const totalCommission = entryCommission + exitCommission
  
  // 计算净利
  const netPnl = pnl - totalCommission
  
  // 计算净利百分比（基于初始保证金）
  const initialMargin = (entryPrice * quantity) / leverage
  const netPnlPercentage = initialMargin > 0 ? (netPnl / initialMargin) * 100 : 0
  
  return { 
    pnl, 
    pnlPercentage, 
    netPnl, 
    netPnlPercentage, 
    totalCommission 
  }
}
