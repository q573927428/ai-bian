// ==================== 匿名浏览所需的展示字段白名单 ====================
import type { Strategy } from '../../types/strategy'
import type { PositionInfo } from '../modules/position-manager/PositionManager'
import { maskStrategyData } from './mask-strategy'

/** 匿名列表只返回概况，完整配置仅提供给已解锁的请求。 */
export function strategyView(strategy: Strategy, verified: boolean) {
  if (verified) return maskStrategyData(strategy)
  return {
    id: strategy.id, name: strategy.name, version: strategy.version,
    isActive: strategy.isActive, createdAt: strategy.createdAt, updatedAt: strategy.updatedAt,
    performance: strategy.performance,
  }
}

/** 持仓概况允许公开展示，推理、决策引用及完整嵌套仓位仅在解锁后返回。 */
export function positionView(position: PositionInfo, verified: boolean) {
  if (verified) return position
  return {
    symbol: position.symbol, strategyId: position.strategyId, direction: position.direction,
    entryPrice: position.entryPrice, quantity: position.quantity, leverage: position.leverage,
    mainTimeframe: position.mainTimeframe, stopLoss: position.stopLoss, initialStopLoss: position.initialStopLoss,
    takeProfit1: position.takeProfit1, takeProfit2: position.takeProfit2, openTime: position.openTime,
    highestPrice: position.highestPrice, lowestPrice: position.lowestPrice,
  }
}
