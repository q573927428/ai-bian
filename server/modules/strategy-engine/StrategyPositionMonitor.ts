// ==================== 多策略持仓监控模块 ====================

import type { PositionInfo } from '../position-manager/PositionManager'
import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { StrategyPositionCloser } from './StrategyPositionCloser'
import { logger } from '../../utils/logger'
import type { Strategy } from '../../../types/strategy'
import type { BotConfig } from '../../../types'

/**
 * 多策略持仓监控模块
 * 负责监控所有持仓的止盈、止损、移动止损、超时平仓等条件
 */
export class StrategyPositionMonitor {
  private binance: BinanceService
  private positionManager: PositionManager
  private positionCloser: StrategyPositionCloser
  private config: BotConfig
  private strategyStore: any // 策略存储，获取策略配置

  private monitorTimer: NodeJS.Timeout | null = null
  private readonly MONITOR_INTERVAL = 5000 // 5秒监控一次

  // 移动止损激活状态: symbol -> boolean
  private trailingStopActivated: Map<string, boolean> = new Map()

  constructor(
    binance: BinanceService,
    positionManager: PositionManager,
    positionCloser: StrategyPositionCloser,
    config: BotConfig,
    strategyStore: any
  ) {
    this.binance = binance
    this.positionManager = positionManager
    this.positionCloser = positionCloser
    this.config = config
    this.strategyStore = strategyStore
  }

  /**
   * 启动监控
   */
  start(): void {
    if (this.monitorTimer) {
      logger.warn('持仓监控', '监控已在运行')
      return
    }

    this.monitorTimer = setInterval(() => {
      this.monitorPositions().catch(error => {
        logger.error('持仓监控', '监控循环异常:', error.message)
      })
    }, this.MONITOR_INTERVAL)

    logger.success('持仓监控', '持仓监控已启动')
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = null
      logger.info('持仓监控', '持仓监控已停止')
    }
  }

  /**
   * 监控所有持仓
   */
  private async monitorPositions(): Promise<void> {
    const positions = this.positionManager.getAllPositions()

    if (positions.length === 0) {
      return
    }

    for (const position of positions) {
      try {
        await this.monitorSinglePosition(position)
      } catch (error: any) {
        logger.error('持仓监控', `监控 ${position.symbol} 失败: ${error.message}`)
      }
    }
  }

  /**
   * 监控单个持仓
   */
  private async monitorSinglePosition(position: PositionInfo): Promise<void> {
    const symbol = position.symbol
    
    // 1. 首先检查持仓一致性，防止本地状态与交易所不一致
    const isConsistent = await this.positionCloser.checkPositionConsistency(symbol)
    if (!isConsistent) {
      logger.info('持仓监控', `${symbol} 持仓已不一致，跳过本次监控`)
      return
    }

    const currentPrice = await this.binance.fetchPrice(symbol)

    // 更新仓位最高价/最低价
    this.updatePositionExtremes(position, currentPrice)

    // 获取策略配置
    const strategy = await this.strategyStore.getStrategy(position.strategyId)
    if (!strategy) {
      logger.warn('持仓监控', `未找到策略配置: ${position.strategyId}`)
      return
    }

    // 1. 检查止盈条件
    if (await this.checkTakeProfit(position, strategy, currentPrice)) {
      return
    }

    // 2. 检查移动止损
    if (strategy.riskManagement.trailingStop.enabled) {
      if (await this.checkTrailingStop(position, strategy, currentPrice)) {
        return
      }
    }

    // 3. 检查超时平仓
    if (await this.checkTimeout(position, strategy, currentPrice)) {
      return
    }
  }

  /**
   * 更新仓位的最高价/最低价
   */
  private updatePositionExtremes(position: PositionInfo, currentPrice: number): void {
    const updates: Partial<PositionInfo> = {}

    if (currentPrice > (position.highestPrice || position.entryPrice)) {
      updates.highestPrice = currentPrice
    }

    if (currentPrice < (position.lowestPrice || position.entryPrice)) {
      updates.lowestPrice = currentPrice
    }

    if (Object.keys(updates).length > 0) {
      this.positionManager.updatePosition(position.symbol, updates)
    }
  }

  /**
   * 检查止盈条件
   */
  private async checkTakeProfit(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    // 多头止盈：当前价 >= 止盈价
    // 空头止盈：当前价 <= 止盈价
    const tp1Hit = position.direction === 'long'
      ? currentPrice >= position.position?.takeProfit1!
      : currentPrice <= position.position?.takeProfit1!

    const tp2Hit = position.direction === 'long'
      ? currentPrice >= position.position?.takeProfit2!
      : currentPrice <= position.position?.takeProfit2!

    if (tp2Hit) {
      logger.info('止盈', `${position.symbol} 达到TP2止盈条件，价格: ${currentPrice}`)
      await this.positionCloser.closePosition(position.symbol, 'TP2止盈', currentPrice)
      return true
    }

    if (tp1Hit) {
      logger.info('止盈', `${position.symbol} 达到TP1止盈条件，价格: ${currentPrice}`)
      await this.positionCloser.closePosition(position.symbol, 'TP1止盈', currentPrice)
      return true
    }

    return false
  }

  /**
   * 检查移动止损
   */
  private async checkTrailingStop(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    const trailingStopConfig = strategy.riskManagement.trailingStop
    const entryPrice = position.entryPrice
    const stopLoss = position.position?.stopLoss!

    // 计算盈亏比
    const risk = Math.abs(entryPrice - stopLoss)
    const currentProfit = position.direction === 'long'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice

    const profitRatio = currentProfit / risk

    // 检查是否激活移动止损
    const isActivated = this.trailingStopActivated.get(position.symbol) || false
    if (!isActivated && profitRatio >= trailingStopConfig.activationRatio) {
      this.trailingStopActivated.set(position.symbol, true)
      logger.info('移动止损', `${position.symbol} 移动止损已激活，盈亏比: ${profitRatio.toFixed(2)}`)
      return false
    }

    // 已激活，检查是否需要移动止损
    if (isActivated) {
      const highestPrice = position.highestPrice || entryPrice
      const lowestPrice = position.lowestPrice || entryPrice

      // 计算新的止损价
      let newStopLoss: number
      if (position.direction === 'long') {
        newStopLoss = highestPrice * (1 - trailingStopConfig.trailDistance / 100)
      } else {
        newStopLoss = lowestPrice * (1 + trailingStopConfig.trailDistance / 100)
      }

      // 检查是否需要更新止损单（至少移动minMoveDistance）
      const minMove = entryPrice * trailingStopConfig.minMoveDistance / 100
      const stopLossDiff = Math.abs(newStopLoss - stopLoss)

      if (stopLossDiff >= minMove) {
        try {
          // 取消旧止损单
          if (position.position?.stopLossOrderId) {
            await this.binance.cancelOrder(
              position.position.stopLossOrderId,
              position.symbol,
              { trigger: true }
            )
          }

          // 设置新止损单
          const side = position.direction === 'long' ? 'sell' : 'buy'
          const stopOrder = await this.binance.stopLossOrder(
            position.symbol,
            side,
            position.quantity,
            newStopLoss
          )

          // 更新仓位信息
          this.positionManager.updatePosition(position.symbol, {
            position: {
              ...position.position!,
              stopLoss: newStopLoss,
              stopLossOrderId: stopOrder.orderId
            }
          })

          logger.info('移动止损', `${position.symbol} 止损已更新到: ${newStopLoss}`)
        } catch (error: any) {
          logger.error('移动止损', `${position.symbol} 更新止损失败: ${error.message}`)
        }
      }

      // 检查是否触发止损
      const stopHit = position.direction === 'long'
        ? currentPrice <= newStopLoss
        : currentPrice >= newStopLoss

      if (stopHit) {
        logger.info('移动止损', `${position.symbol} 触发移动止损，价格: ${currentPrice}`)
        await this.positionCloser.closePosition(position.symbol, '移动止损', currentPrice)
        this.trailingStopActivated.delete(position.symbol)
        return true
      }
    }

    return false
  }

  /**
   * 检查超时平仓
   */
  private async checkTimeout(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    // 暂时没有超时平仓配置，后续扩展
    return false
  }

  /**
   * 重置移动止损状态
   */
  resetTrailingStop(symbol: string): void {
    this.trailingStopActivated.delete(symbol)
  }
}