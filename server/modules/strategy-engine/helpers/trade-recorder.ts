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
  netPnlPercentage?: number
): Promise<void> {
  // 计算盈亏
  const { pnl: grossPnl, pnlPercentage: grossPnlPercentage } = calculatePnL(exitPrice, position)
  
  // 使用提供的净利或默认毛利
  const finalPnl = netPnl !== undefined ? netPnl : grossPnl
  const finalPnlPercentage = netPnlPercentage !== undefined ? netPnlPercentage : grossPnlPercentage

  // 记录交易历史
  const trade: TradeHistory = {
    id: `${Date.now()}-${position.symbol}-${strategyId}`,
    strategyId,
    symbol: position.symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    leverage: position.leverage,
    pnl: finalPnl,
    pnlPercentage: finalPnlPercentage,
    openTime: position.openTime,
    closeTime: Date.now(),
    reason,
    totalCommission,
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
    // 获取策略，这会自动合并全局交易记录并重新计算 performance
    await strategyStore.getPerformance(strategyId)
    
    // 注意：getPerformance 只是计算，不保存
    // 我们需要获取合并后的记录，然后手动更新策略文件
    
    const allRecords = await strategyStore.getTradeRecords(strategyId)
    const strategy = await strategyStore.getStrategy(strategyId)
    
    if (!strategy) {
      return
    }
    
    // 重新计算 performance
    const closedTrades = allRecords.filter((t: any) => t.status === 'closed')
    const totalTrades = closedTrades.length

    if (totalTrades === 0) {
      strategy.performance = {
        strategyId: strategy.id,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0,
        totalProfit: 0,
        totalLoss: 0,
        netProfit: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        averageProfitPerTrade: 0,
        averageLossPerTrade: 0,
        largestWin: 0,
        largestLoss: 0,
        averageHoldTime: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        updatedAt: new Date().toISOString()
      }
    } else {
      // 计算基础统计
      const winningTrades = closedTrades.filter((t: any) => (t.profitLoss || 0) > 0)
      const losingTrades = closedTrades.filter((t: any) => (t.profitLoss || 0) <= 0)
      const totalWins = winningTrades.length
      const totalLosses = losingTrades.length

      const totalProfit = winningTrades.reduce((sum: number, t: any) => sum + (t.profitLoss || 0), 0)
      const totalLoss = Math.abs(losingTrades.reduce((sum: number, t: any) => sum + (t.profitLoss || 0), 0))
      const netProfit = totalProfit - totalLoss

      const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0
      const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity

      // 计算最大盈利/亏损
      const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map((t: any) => t.profitLoss || 0)) : 0
      const largestLoss = losingTrades.length > 0 ? Math.max(...losingTrades.map((t: any) => Math.abs(t.profitLoss || 0))) : 0

      // 平均盈亏
      const averageProfitPerTrade = totalWins > 0 ? totalProfit / totalWins : 0
      const averageLossPerTrade = totalLosses > 0 ? totalLoss / totalLosses : 0

      // 平均持仓时间
      const totalHoldTime = closedTrades.reduce((sum: number, t: any) => {
        if (t.openTime && t.closeTime) {
          const open = new Date(t.openTime).getTime()
          const close = new Date(t.closeTime).getTime()
          return sum + (close - open) / (1000 * 60)
        }
        return sum
      }, 0)
      const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0

      // 计算连续盈亏
      let consecutiveWins = 0
      let consecutiveLosses = 0
      let maxConsecutiveWins = 0
      let maxConsecutiveLosses = 0

      // 按时间排序交易
      const sortedTrades = [...closedTrades].sort((a, b) => 
        new Date(a.closeTime || a.openTime).getTime() - new Date(b.closeTime || b.openTime).getTime()
      )

      for (const trade of sortedTrades) {
        const profit = trade.profitLoss || 0
        if (profit > 0) {
          consecutiveWins++
          consecutiveLosses = 0
          maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins)
        } else {
          consecutiveLosses++
          consecutiveWins = 0
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
        }
      }

      // 计算最大回撤
      let peak = 0
      let maxDrawdown = 0
      let cumulativeProfit = 0
      for (const trade of sortedTrades) {
        cumulativeProfit += trade.profitLoss || 0
        if (cumulativeProfit > peak) {
          peak = cumulativeProfit
        }
        const drawdown = peak > 0 ? ((peak - cumulativeProfit) / peak) * 100 : 0
        maxDrawdown = Math.max(maxDrawdown, drawdown)
      }

      // 更新性能数据
      strategy.performance = {
        strategyId: strategy.id,
        totalTrades,
        totalWins,
        totalLosses,
        winRate,
        totalProfit,
        totalLoss,
        netProfit,
        profitFactor,
        maxDrawdown,
        averageProfitPerTrade,
        averageLossPerTrade,
        largestWin,
        largestLoss,
        averageHoldTime,
        consecutiveWins,
        consecutiveLosses,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        updatedAt: new Date().toISOString()
      }
    }

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
