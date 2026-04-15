// ==================== 多策略交易历史记录 ====================

import type { Position, TradeHistory } from '../../../../types'
import { calculatePnL } from '../../../utils/risk'
import { addTradeHistory } from '../../../utils/storage'
import type { StrategyId } from '../../../../types/strategy'

/**
 * 记录多策略交易历史
 */
export async function recordTrade(
  strategyId: StrategyId,
  position: Position,
  exitPrice: number,
  reason: string
): Promise<void> {
  // 计算盈亏
  const { pnl, pnlPercentage } = calculatePnL(exitPrice, position)

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
    pnl,
    pnlPercentage,
    openTime: position.openTime,
    closeTime: Date.now(),
    reason,
  }

  // 添加交易历史
  await addTradeHistory(trade)
}