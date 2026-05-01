// ==================== 多策略交易历史记录 ====================

import type { Position, TradeHistory } from '../../../../types'
import { addTradeHistory } from '../../../utils/storage'
import type { StrategyId } from '../../../../types/strategy'
import { calculatePnL } from '../../../utils/trade-helpers'
import { strategyStore } from '../../../modules/strategy-store/StrategyStore'

/**
 * 记录多策略交易历史
 */
export async function recordTrade(
  strategyId: StrategyId,
  position: Position,
  exitPrice: number,
  reason: string,
  totalCommission?: number,
  netPnl?: number,
  netPnlPercentage?: number,
  commissionRate: number = 0.0005, // 默认手续费率
  positionInfo?: any // 额外的仓位信息
): Promise<void> {
  // 计算盈亏（包含手续费）
  const { 
    pnl: grossPnl, 
    pnlPercentage: grossPnlPercentage,
    netPnl: calculatedNetPnl,
    netPnlPercentage: calculatedNetPnlPercentage,
    totalCommission: calculatedTotalCommission
  } = calculatePnL(exitPrice, position, commissionRate)
  
  // 使用提供的值或计算的值
  const finalNetPnl = netPnl !== undefined ? netPnl : calculatedNetPnl
  const finalNetPnlPercentage = netPnlPercentage !== undefined ? netPnlPercentage : calculatedNetPnlPercentage
  const finalTotalCommission = totalCommission !== undefined ? totalCommission : calculatedTotalCommission

  // 计算持仓时间（分钟）
  const holdingMinutes = Math.round((Date.now() - position.openTime) / 60000)

  // 判断平仓分类
  let closeCategory: any = 'unknown'
  const reasonLower = reason.toLowerCase()
  if (reasonLower.includes('止损')) {
    if (reasonLower.includes('移动')) {
      closeCategory = 'trailing_stop'
    } else {
      closeCategory = 'stop_loss'
    }
  } else if (reasonLower.includes('止盈') || reasonLower.includes('tp') || reasonLower.includes('盈亏比')) {
    closeCategory = 'take_profit'
  } else if (reasonLower.includes('超时')) {
    closeCategory = 'timeout'
  } else if (reasonLower.includes('手动')) {
    closeCategory = 'manual'
  }

  // 记录交易历史（注意：TradeHistory 的 pnl 现在存储的是净利）
  const trade: TradeHistory = {
    id: `${Date.now()}-${position.symbol}-${strategyId}`,
    strategyId,
    symbol: position.symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    leverage: position.leverage,
    pnl: finalNetPnl, // 存储净利
    pnlPercentage: finalNetPnlPercentage, // 存储净利百分比
    openTime: position.openTime,
    closeTime: Date.now(),
    reason,
    totalCommission: finalTotalCommission,
    // 入场信息
    entryConfidence: positionInfo?.confidence,
    entryScore: positionInfo?.scoreBreakdown?.finalScore,
    entryRiskLevel: positionInfo?.riskLevel,
    stopLossPrice: position.initialStopLoss,
    takeProfit1Price: position.takeProfit1,
    takeProfit2Price: position.takeProfit2,
    // 入场指标
    entryIndicators: positionInfo?.entryIndicators,
    // AI信息
    aiReasoning: positionInfo?.reasoning,
    // 持仓统计
    highestPrice: positionInfo?.highestPrice,
    lowestPrice: positionInfo?.lowestPrice,
    maxFloatingProfit: positionInfo?.maxFloatingProfit,
    maxFloatingProfitPercent: positionInfo?.maxFloatingProfitPercent,
    maxFloatingLoss: positionInfo?.maxFloatingLoss,
    maxFloatingLossPercent: positionInfo?.maxFloatingLossPercent,
    holdingMinutes,
    // 平仓分类
    closeCategory,
  }

  // 添加交易历史
  await addTradeHistory(trade)

  // 更新策略的 performance 统计
  await updateStrategyPerformance(strategyId)
}

/**
 * 更新策略的 performance 统计
 */
async function updateStrategyPerformance(strategyId: StrategyId): Promise<void> {
  try {
    // 直接使用 strategyStore.getPerformance 获取计算结果，然后保存
    const performance = await strategyStore.getPerformance(strategyId)
    const strategy = await strategyStore.getStrategy(strategyId)
    
    if (!strategy || !performance) {
      return
    }
    
    // 更新性能数据（基于净利计算）
    strategy.performance = performance

    // 移除 tradeRecords 字段，不保存到策略文件
    delete (strategy as any).tradeRecords

    // 保存更新后的策略
    const { writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const DATA_DIR = join(process.cwd(), 'data')
    const STRATEGIES_DIR = join(DATA_DIR, 'strategies')
    const filePath = join(STRATEGIES_DIR, `${strategyId}.json`)
    
    await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')
  } catch (error) {
    // 静默失败，不影响主流程
    const { logger } = await import('../../../utils/logger')
    logger.error('trade-recorder', `更新策略 performance 失败: ${(error as any).message}`)
  }
}
