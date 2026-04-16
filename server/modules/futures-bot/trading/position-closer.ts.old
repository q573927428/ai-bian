import type { Position, BotConfig, BotState } from '../../../../types'
import { PositionStatus } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { getOrderSide, checkCircuitBreaker, calculatePnL } from '../../../utils/risk'
import { logger } from '../../../utils/logger'
import { saveBotState } from '../../../utils/storage'
import { recordTrade } from '../helpers/trade-recorder'

/**
 * 持仓平仓器
 */
export class PositionCloser {
  private binance: BinanceService
  private config: BotConfig
  private state: BotState

  constructor(binance: BinanceService, config: BotConfig, state: BotState) {
    this.binance = binance
    this.config = config
    this.state = state
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
  }

  /**
   * 更新状态
   */
  updateState(state: BotState): void {
    this.state = state
  }

  /**
   * 记录交易并获取盈亏
   */
  private async recordTradeAndGetPnL(
    position: Position,
    exitPrice: number,
    reason: string
  ): Promise<{ pnl: number; updatedState: BotState | null }> {
    // 计算盈亏
    const { pnl } = calculatePnL(exitPrice, position)
    
    // 记录交易历史
    const updatedState = await recordTrade(position, exitPrice, reason)
    
    return { pnl, updatedState }
  }

  /**
   * 平仓
   */
  async closePosition(position: Position, reason: string): Promise<void> {
    try {
      logger.info('平仓', `准备平仓: ${reason}`)

      this.state.status = PositionStatus.CLOSING
      await saveBotState(this.state)

      // 确保方向是LONG或SHORT
      if (position.direction === 'IDLE') {
        logger.error('平仓', '持仓方向为IDLE，无法平仓')
        return
      }

      // 取消止损单（条件单）
      if (position.stopLossOrderId) {
        try {
          await this.binance.cancelOrder(position.stopLossOrderId, position.symbol, { trigger: true })
          logger.info('平仓', '止损单已取消')
        } catch (e: any) {
          logger.warn('平仓', `取消止损单失败: ${e.message}`)
        }
      }

      // 取消所有未成交订单
      try {
        await this.binance.cancelAllOrders(position.symbol)
      } catch (err) {
        logger.warn('平仓', '取消挂单失败，继续强制平仓')
      }

      // 市价平仓 (平仓操作，isEntry=false)
      const side = getOrderSide(position.direction, false)
      const order = await this.binance.marketOrder(position.symbol, side, position.quantity)

      logger.success('平仓', `平仓成功`, order)

      // 获取当前价格
      const exitPrice = await this.binance.fetchPrice(position.symbol)

      // 记录交易历史并获取本次交易盈亏
      const { pnl, updatedState } = await this.recordTradeAndGetPnL(position, exitPrice, reason)
      if (updatedState) {
        this.state = updatedState
      }

      // 更新每日盈亏
      this.state.dailyPnL = (this.state.dailyPnL || 0) + pnl

      // 更新连续亏损次数
      let consecutiveLosses = this.state.circuitBreaker.consecutiveLosses
      if (pnl < 0) {
        consecutiveLosses += 1
      } else {
        consecutiveLosses = 0
      }

      // 检查熔断条件
      const account = await this.binance.fetchBalance()
      const breaker = checkCircuitBreaker(this.state.dailyPnL, consecutiveLosses, account.balance, this.config.riskConfig)

      this.state.circuitBreaker = breaker
      this.state.currentPosition = null
      this.state.status = breaker.isTriggered ? PositionStatus.HALTED : PositionStatus.MONITORING
      this.state.lastTradeTime = Date.now() // 更新上次交易时间（平仓时间）
      
      // 如果触发熔断，停止运行
      if (breaker.isTriggered) {
        this.state.isRunning = false
      }

      await saveBotState(this.state)

      if (breaker.isTriggered) {
        logger.error('熔断', breaker.reason)
      }

      logger.success('交易完成', `盈亏: ${pnl.toFixed(2)} USDT`)
    } catch (error: any) {
      logger.error('平仓', '平仓失败', error.message)
      throw error
    }
  }
}
