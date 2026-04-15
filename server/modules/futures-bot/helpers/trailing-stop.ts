import type { Position, TrailingStopConfig } from '../../../../types'
import { logger } from '../../../utils/logger'

/**
 * 计算移动止损价格
 * 
 * 重要：止损基于持仓期间的最高价（多头）或最低价（空头）计算，
 * 而不是基于当前价格。这样可以确保止损只会向有利方向移动，
 * 不会因为价格回调而降低止损保护。
 */
export function calculateTrailingStopLoss(
  currentPrice: number,
  position: Position,
  atr: number,
  config: TrailingStopConfig
): {
  newStopLoss: number | null
  shouldUpdate: boolean
  reason: string
  data: any
  updatedHighestPrice?: number  // 返回更新后的最高价（多头）
  updatedLowestPrice?: number   // 返回更新后的最低价（空头）
} {
  const { entryPrice, stopLoss, direction } = position
  
  // 计算初始风险
  const initialRisk = Math.abs(entryPrice - stopLoss)
  
  // 计算当前盈利
  let currentProfit = 0
  if (direction === 'LONG') {
    currentProfit = currentPrice - entryPrice
  } else if (direction === 'SHORT') {
    currentProfit = entryPrice - currentPrice
  } else {
    return {
      newStopLoss: null,
      shouldUpdate: false,
      reason: '持仓方向无效',
      data: {}
    }
  }
  
  // 计算盈亏比
  const profitRiskRatio = initialRisk > 0 ? currentProfit / initialRisk : 0
  
  // 检查是否达到激活条件
  if (profitRiskRatio < config.activationRatio) {
    return {
      newStopLoss: null,
      shouldUpdate: false,
      reason: `盈亏比 ${profitRiskRatio.toFixed(2)} 未达到激活条件 ${config.activationRatio}`,
      data: {
        currentPrice,
        entryPrice,
        currentStopLoss: stopLoss,
        currentProfit,
        profitRiskRatio,
        activationRatio: config.activationRatio
      }
    }
  }
  
  // 计算跟踪距离
  const trailingDistance = atr * config.trailingDistance
  
  // 计算新止损价格 - 基于最高价/最低价，而不是当前价格
  let newStopLoss: number
  let updatedHighestPrice: number | undefined
  let updatedLowestPrice: number | undefined
  
  if (direction === 'LONG') {
    // 多头：更新最高价，然后基于最高价计算止损
    const previousHighest = position.highestPrice || entryPrice
    updatedHighestPrice = Math.max(previousHighest, currentPrice)
    // 新止损 = 最高价 - 跟踪距离
    newStopLoss = updatedHighestPrice - trailingDistance
  } else {
    // 空头：更新最低价，然后基于最低价计算止损
    const previousLowest = position.lowestPrice || entryPrice
    updatedLowestPrice = Math.min(previousLowest, currentPrice)
    // 新止损 = 最低价 + 跟踪距离
    newStopLoss = updatedLowestPrice + trailingDistance
  }
  
  // 计算止损移动的距离
  const stopLossMove = Math.abs(newStopLoss - stopLoss)
  const stopLossMovePercent = (stopLossMove / entryPrice) * 100
  
  // 确保新止损不会低于当前止损（只向有利方向移动）
  let shouldUpdate = false
  if (direction === 'LONG') {
    if (newStopLoss > stopLoss && stopLossMovePercent >= config.minMovePercent) {
      shouldUpdate = true
    } else {
      newStopLoss = stopLoss // 保持当前止损
    }
  } else {
    if (newStopLoss < stopLoss && stopLossMovePercent >= config.minMovePercent) {
      shouldUpdate = true
    } else {
      newStopLoss = stopLoss // 保持当前止损
    }
  }
  
  return {
    newStopLoss,
    shouldUpdate,
    reason: shouldUpdate 
      ? `移动止损：从 ${stopLoss.toFixed(2)} → ${newStopLoss.toFixed(2)} (移动 ${stopLossMovePercent.toFixed(2)}%)`
      : `止损保持不变：${stopLoss.toFixed(2)}`,
    data: {
      direction,
      currentPrice,
      entryPrice,
      highestPrice: updatedHighestPrice,
      lowestPrice: updatedLowestPrice,
      oldStopLoss: stopLoss,
      newStopLoss,
      trailingDistance,
      atr,
      currentProfit,
      profitRiskRatio,
      stopLossMove,
      stopLossMovePercent
    },
    updatedHighestPrice,
    updatedLowestPrice
  }
}

