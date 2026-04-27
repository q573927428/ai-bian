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
  commissionRate: number = 0.0004 // 默认手续费率
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
