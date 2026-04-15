import type { Position, TradeHistory, BotState } from '../../../../types'
import { calculatePnL } from '../../../utils/risk'
import { addTradeHistory } from '../../../utils/storage'

/**
 * 记录交易历史
 */
export async function recordTrade(
  position: Position,
  exitPrice: number,
  reason: string
): Promise<BotState | null> {
  // 计算盈亏
  const { pnl, pnlPercentage } = calculatePnL(exitPrice, position)

  // 记录交易历史
  const trade: TradeHistory = {
    id: `${Date.now()}-${position.symbol}`,
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

  // 添加交易历史并返回更新后的状态
  return await addTradeHistory(trade)
}
