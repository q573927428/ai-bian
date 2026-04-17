// ==================== 多策略平仓模块 ====================

import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { saveBotState } from '../../utils/storage'
import { calculatePnL, checkCircuitBreaker } from '../../utils/trade-helpers'
import { recordTrade } from './helpers/trade-recorder'
import { PositionStatus } from '../../../types'
import type { BotConfig, BotState, Order } from '../../../types'

/**
 * 多策略平仓模块
 * 负责执行平仓操作，更新仓位状态，记录交易历史
 */
export class StrategyPositionCloser {
  private binance: BinanceService
  private positionManager: PositionManager
  private config: BotConfig
  private state: BotState

  constructor(
    binance: BinanceService,
    positionManager: PositionManager,
    config: BotConfig,
    state: BotState
  ) {
    this.binance = binance
    this.positionManager = positionManager
    this.config = config
    this.state = state
  }

  /**
   * 安全初始化 state，确保必要属性存在
   */
  private ensureStateInitialized(): void {
    if (!this.state) {
      this.state = {} as BotState
    }
    
    // 初始化 dailyPnL
    if (this.state.dailyPnL === undefined) {
      this.state.dailyPnL = 0
    }
    
    // 初始化 circuitBreaker
    if (!this.state.circuitBreaker) {
      this.state.circuitBreaker = {
        isTriggered: false,
        reason: '',
        timestamp: Date.now(),
        dailyLoss: 0,
        consecutiveLosses: 0
      }
    }
    
    // 初始化 status
    if (!this.state.status) {
      this.state.status = PositionStatus.MONITORING
    }
    
    // 初始化 isRunning
    if (this.state.isRunning === undefined) {
      this.state.isRunning = true
    }
  }

  /**
   * 获取熔断配置（使用默认值，兼容多策略架构）
   * 注意：熔断配置现在应从策略级别获取，这里仅保留默认值用于向后兼容
   */
  private getCircuitBreakerConfig(): { dailyLossThreshold: number; consecutiveLossesThreshold: number } {
    return {
      dailyLossThreshold: 10,
      consecutiveLossesThreshold: 5
    }
  }

  /**
   * 平仓操作
   * @param symbol 交易对
   * @param reason 平仓原因
   * @param exitPrice 平仓价格（可选，不传则用市价）
   */
  async closePosition(symbol: string, reason: string, exitPrice?: number): Promise<void> {
    try {
      const position = this.positionManager.getPosition(symbol)
      if (!position) {
        logger.warn('平仓', `未找到仓位: ${symbol}`)
        return
      }

      logger.info('平仓', `开始平仓 ${symbol}, 原因: ${reason}`)

      // 1. 取消止损订单
      const stopLossOrderId = position.stopLossOrderId || position.position?.stopLossOrderId
      if (stopLossOrderId) {
        try {
          await this.binance.cancelOrder(
            stopLossOrderId,
            symbol,
            { trigger: true }
          )
          logger.info('平仓', `成功取消止损订单: ${stopLossOrderId}`)
        } catch (error: any) {
          logger.warn('平仓', `取消止损订单失败: ${error.message}`)
        }
      }

      // 2. 市价平仓
      const side = position.direction === 'long' ? 'sell' : 'buy'
      const quantity = Math.abs(position.quantity)

      const order = await this.binance.marketOrder(symbol, side, quantity)
      logger.success('平仓', `平仓订单已提交`, order)

      // 3. 获取实际成交价格
      const finalExitPrice = exitPrice || order.average || await this.binance.fetchPrice(symbol)

      // 4. 计算盈亏
      const { pnl, pnlPercentage } = calculatePnL(finalExitPrice, position.position!)
      logger.info('平仓', `平仓盈亏: ${pnl.toFixed(2)} USDT (${pnlPercentage.toFixed(2)}%)`)

      // 5. 记录交易历史
      await recordTrade(position.strategyId, position.position!, finalExitPrice, reason)

      // 6. 安全初始化 state
      this.ensureStateInitialized()

      // 7. 更新全局状态（临时兼容老架构）
      this.state.dailyPnL += pnl
      if (pnl < 0) {
        this.state.circuitBreaker.consecutiveLosses += 1
      } else {
        this.state.circuitBreaker.consecutiveLosses = 0
      }

      // 7. 检查熔断
      const account = await this.binance.fetchBalance()
      const circuitBreakerConfig = this.getCircuitBreakerConfig()
      const breaker = checkCircuitBreaker(
        this.state.dailyPnL,
        this.state.circuitBreaker.consecutiveLosses,
        account.balance,
        circuitBreakerConfig
      )

      this.state.circuitBreaker = breaker
      this.state.lastTradeTime = Date.now()

      if (breaker.isTriggered) {
        this.state.isRunning = false
        logger.error('熔断', breaker.reason)
      }

      await saveBotState(this.state)

      // 8. 清除仓位记录
      this.positionManager.clearPosition(symbol)

      logger.success('平仓', `平仓完成: ${symbol}, 原因: ${reason}`)
    } catch (error: any) {
      logger.error('平仓', `平仓失败 ${symbol}: ${error.message}`)
      throw error
    }
  }

  /**
   * 批量平仓策略所有仓位
   * @param strategyId 策略ID
   * @param reason 平仓原因
   */
  async closeStrategyPositions(strategyId: string, reason: string): Promise<void> {
    const positions = this.positionManager.getStrategyPositions(strategyId)
    logger.info('批量平仓', `策略 ${strategyId} 共 ${positions.length} 个仓位需要平仓`)

    for (const position of positions) {
      try {
        await this.closePosition(position.symbol, reason)
      } catch (error: any) {
        logger.error('批量平仓', `平仓 ${position.symbol} 失败: ${error.message}`)
      }
    }

    logger.success('批量平仓', `策略 ${strategyId} 所有仓位已平仓`)
  }

  /**
   * 平仓所有仓位
   * @param reason 平仓原因
   */
  async closeAllPositions(reason: string): Promise<void> {
    const positions = this.positionManager.getAllPositions()
    logger.info('全仓平仓', `共 ${positions.length} 个仓位需要平仓`)

    for (const position of positions) {
      try {
        await this.closePosition(position.symbol, reason)
      } catch (error: any) {
        logger.error('全仓平仓', `平仓 ${position.symbol} 失败: ${error.message}`)
      }
    }

    logger.success('全仓平仓', `所有仓位已平仓`)
  }

  /**
   * 检测手动平仓
   * 注意：必须先检查止损订单状态，再检查市价/限价订单
   * 因为止损触发后会产生市价订单，如果先检查市价订单会被错误识别为手动平仓
   */
  private async detectManualClose(position: any): Promise<{
    isManualClose: boolean
    exitPrice?: number
    closeTime?: number
    orderId?: string
  }> {
    try {
      logger.info('手动平仓检测', `开始检测 ${position.symbol} 是否手动平仓`)
      
      // 1. 优先检查止损订单状态（条件单触发不是手动平仓）
      const stopLossOrderId = position.stopLossOrderId || position.position?.stopLossOrderId
      if (stopLossOrderId) {
        try {
          const stopOrder = await this.binance.fetchOrder(stopLossOrderId, position.symbol, { trigger: true })
          
          // 如果止损订单已成交，说明是止损触发，不是手动平仓
          if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
            const exitPrice = stopOrder.average || stopOrder.price || position.position.stopLoss || await this.binance.fetchPrice(position.symbol)
            logger.info('手动平仓检测', `检测到止损订单已成交: ${stopOrder.status}, 成交价: ${exitPrice}，非手动平仓`)
            return {
              isManualClose: false,
              exitPrice,
              closeTime: stopOrder.timestamp || Date.now(),
              orderId: stopOrder.orderId
            }
          }
        } catch (error: any) {
          // 查询止损订单失败，继续其他检测
          logger.warn('手动平仓检测', `查询止损订单失败: ${error.message}`)
        }
      }
      
      // 2. 止损订单未成交或不存在，再检查是否有手动市价/限价平仓订单
      // 查询最近5分钟内的订单（300000毫秒）
      const since = Date.now() - 300000
      const recentOrders = await this.binance.fetchRecentOrders(position.symbol, since, 20)
      
      // 查找可能的平仓订单
      // 手动平仓通常是市价单或限价单，方向与持仓方向相反
      const expectedSide = position.direction === 'long' ? 'sell' : 'buy'
      
      for (const order of recentOrders) {
        // 检查是否是平仓订单（市价单或限价单）
        if ((order.type === 'MARKET' || order.type === 'LIMIT') && 
            order.side.toLowerCase() === expectedSide && 
            (order.status === 'closed' || order.status === 'filled')) {
          
          // 检查订单数量是否与持仓数量接近（允许微小差异）
          const orderQuantity = Math.abs(order.quantity)
          const positionQuantity = Math.abs(position.quantity)
          const quantityDiff = Math.abs(orderQuantity - positionQuantity) / positionQuantity
          
          if (quantityDiff <= 0.1) { // 允许10%的差异
            const exitPrice = order.average || order.price || await this.binance.fetchPrice(position.symbol)
            logger.info('手动平仓检测', `检测到手动平仓订单: ${order.orderId}, 成交价: ${exitPrice}`)
            return {
              isManualClose: true,
              exitPrice,
              closeTime: order.timestamp || Date.now(),
              orderId: order.orderId
            }
          }
        }
      }
      
      logger.info('手动平仓检测', `未检测到手动平仓，可能是其他原因平仓`)
      return {
        isManualClose: false
      }
    } catch (error: any) {
      logger.error('手动平仓检测', `检测失败: ${error.message}`)
      return {
        isManualClose: false
      }
    }
  }

  /**
   * 处理手动平仓
   */
  private async handleManualClose(
    position: any, 
    manualCloseInfo: { exitPrice: number; closeTime: number; orderId?: string }
  ): Promise<void> {
    try {
      logger.info('手动平仓处理', `开始处理手动平仓: ${position.symbol}`)

      // 安全检查：确保position存在且有基本信息
      if (!position) {
        logger.error('手动平仓处理', `仓位信息不存在，无法处理`)
        return
      }

      const { exitPrice, closeTime } = manualCloseInfo

      // 取消止损单（如果存在）
      const stopLossOrderId = position.stopLossOrderId || position.position?.stopLossOrderId
      if (stopLossOrderId) {
        try {
          await this.binance.cancelOrder(stopLossOrderId, position.symbol, { trigger: true })
          logger.info('手动平仓处理', `成功取消止损订单: ${stopLossOrderId}`)
        } catch (error: any) {
          logger.warn('手动平仓处理', `取消止损订单失败: ${error.message}`)
        }
      }

      // 创建临时仓位对象用于计算盈亏和记录交易
      const tempPosition = position.position || {
        symbol: position.symbol,
        direction: position.direction.toUpperCase() as 'LONG' | 'SHORT',
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        leverage: position.leverage,
        openTime: position.openTime,
        stopLoss: 0,
        initialStopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0
      }

      // 计算盈亏
      const { pnl, pnlPercentage } = calculatePnL(exitPrice, tempPosition)

      // 记录交易历史并更新状态（手动平仓）
      await recordTrade(position.strategyId, tempPosition, exitPrice, '手动平仓')

      // 安全初始化 state
      this.ensureStateInitialized()

      // 更新每日盈亏（手动平仓影响每日盈亏）
      this.state.dailyPnL += pnl

      // 手动平仓不计入连续止损次数，不影响熔断机制
      // 只有当实际亏损且是系统止损时才计入连续止损

      // 检查熔断条件（只检查每日亏损，不计入连续止损）
      const account = await this.binance.fetchBalance()
      const circuitBreakerConfig = this.getCircuitBreakerConfig()
      const breaker = checkCircuitBreaker(
        this.state.dailyPnL, 
        this.state.circuitBreaker.consecutiveLosses, // 保持原有连续止损次数
        account.balance, 
        circuitBreakerConfig
      )

      this.state.circuitBreaker = breaker
      this.state.status = breaker.isTriggered ? PositionStatus.HALTED : PositionStatus.MONITORING
      this.state.lastTradeTime = closeTime
      
      // 如果触发熔断，停止运行
      if (breaker.isTriggered) {
        this.state.isRunning = false
        logger.error('熔断', breaker.reason)
      }

      // 清除仓位记录
      this.positionManager.clearPosition(position.symbol)

      await saveBotState(this.state)

      logger.success('手动平仓处理完成', `盈亏: ${pnl.toFixed(2)} USDT (${pnlPercentage.toFixed(2)}%)，原因: 手动平仓`)
    } catch (error: any) {
      logger.error('手动平仓处理', '处理手动平仓失败', error.message)
      throw error
    }
  }

  /**
   * 检查持仓一致性（新增方法）
   * 验证本地持仓状态与交易所实际状态是否一致
   */
  async checkPositionConsistency(symbol: string): Promise<boolean> {
    const position = this.positionManager.getPosition(symbol)
    if (!position) {
      logger.warn('持仓一致性检查', `未找到本地仓位: ${symbol}`)
      return false
    }

    const exchangePositions = await this.binance.fetchPositions(symbol)
  
    const hasPositionOnExchange = exchangePositions.some(p => {
      const exchangeSymbol = p.symbol.replace(':USDT', '')
      const localSymbol = symbol.replace(':USDT', '')
  
      if (exchangeSymbol !== localSymbol) return false
  
      const size = Number(p.quantity || 0)
  
      return Math.abs(size) > 0
    })
  
    // 🔥 核心判断：如果交易所没有持仓，说明仓位已被平仓（止损或止盈）
    if (!hasPositionOnExchange) {
      logger.warn(
        '状态同步',
        `检测到 ${symbol} 仓位已不存在（可能已止损/平仓），开始检测平仓原因`
      )
  
      try {
        // 1. 检测是否是手动平仓
        const manualCloseInfo = await this.detectManualClose(position)
        
        if (manualCloseInfo.isManualClose && manualCloseInfo.exitPrice !== undefined && manualCloseInfo.closeTime !== undefined) {
          // 手动平仓处理
          const closeInfo = {
            exitPrice: manualCloseInfo.exitPrice!, // 使用非空断言，因为我们已经检查过不为undefined
            closeTime: manualCloseInfo.closeTime!, // 使用非空断言，因为我们已经检查过不为undefined
            orderId: manualCloseInfo.orderId
          }
          await this.handleManualClose(position, closeInfo)
        } else if (manualCloseInfo.isManualClose) {
          // 如果检测到手動平倉但缺少必要信息，使用默认值
          logger.warn('手动平仓处理', `检测到手动平仓但缺少必要信息，使用默认值`)
          const currentPrice = await this.binance.fetchPrice(symbol)
          const closeInfo = {
            exitPrice: currentPrice,
            closeTime: Date.now(),
            orderId: manualCloseInfo.orderId
          }
          await this.handleManualClose(position, closeInfo)
        } else {
          // 2. 如果不是手动平仓，继续原有补偿平仓逻辑
          let reason = '初始止损'
          
          // 检查止损订单状态来确定具体原因
          const stopLossOrderId = position.stopLossOrderId || position.position?.stopLossOrderId
          if (stopLossOrderId) {
            try {
              const stopOrder = await this.binance.fetchOrder(stopLossOrderId, symbol, { trigger: true })
              if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
              // 判断是否是移动止损：检查是否有移动止损数据且移动止损次数大于0
                const isTrailingStop = position.position?.trailingStopData && 
                                      position.position.trailingStopData.trailingStopCount > 0
                reason = isTrailingStop ? '移动止损' : '初始止损'
              } else {
                // 止损订单未成交，可能是其他原因平仓
                reason = '未知原因'
              }
            } catch (error: any) {
              logger.warn('补偿平仓', `查询止损订单失败，使用默认原因: ${error.message}`)
              // 查询失败时也尝试判断是否是移动止损
              const isTrailingStop = position.position?.trailingStopData && 
                                    position.position.trailingStopData.trailingStopCount > 0
              reason = isTrailingStop ? '移动止损' : '初始止损'
            }
          } else {
            reason = '未知原因'
          }
          
          await this.handleCompensatedClose(position, reason)
        }
      } catch (error: any) {
        logger.error('持仓一致性检查', '处理平仓流程失败', error.message)
        // 即使处理失败，也要清空本地状态
        this.positionManager.clearPosition(symbol)
        // 安全初始化 state
        this.ensureStateInitialized()
        this.state.status = PositionStatus.MONITORING
        await saveBotState(this.state)
      }
  
      return false 
    }
  
    return true  
  }

  /**
   * 处理补偿平仓（当检测到仓位已被平仓但本地没有记录时）
   */
  async handleCompensatedClose(position: any, reason: string): Promise<void> {
    try {
      // 安全检查：确保position存在
      if (!position) {
        logger.error('补偿平仓', `仓位信息不存在，无法处理`)
        return
      }
      
      logger.info('补偿平仓', `开始处理补偿平仓: ${position.symbol} ${reason}`)

      let exitPrice = 0
      let closeTime = Date.now()

      // 创建临时仓位对象
      const tempPosition = position.position || {
        symbol: position.symbol,
        direction: position.direction.toUpperCase() as 'LONG' | 'SHORT',
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        leverage: position.leverage,
        openTime: position.openTime,
        stopLoss: 0,
        initialStopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0
      }

      // 尝试查询止损订单状态
      const stopLossOrderId = position.stopLossOrderId || position.position?.stopLossOrderId
      if (stopLossOrderId) {
        try {
          //ccxt 最新 trigger: true 可以查询 条件委托 止损单 
          const stopOrder = await this.binance.fetchOrder(stopLossOrderId, position.symbol, { trigger: true })
          
          // 如果订单已成交，获取成交价格
          if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
            // 优化：优先使用average（平均成交价），然后是price，最后是position.stopLoss
            exitPrice = Number(stopOrder.info?.actualPrice) || stopOrder.average || stopOrder.price || tempPosition.stopLoss
            logger.info('补偿平仓', `止损订单已成交: ${stopOrder.status}，成交价: ${exitPrice}`)
          } else {
            //如果订单未成交 尝试取消止损单
            try {
              await this.binance.cancelOrder(stopLossOrderId, position.symbol, { trigger: true })
              logger.info('补偿平仓', `成功取消止损订单: ${stopLossOrderId}`)
              // 优化：优先使用average（平均成交价），然后是price，最后是position.stopLoss
              exitPrice = stopOrder.average || stopOrder.price || tempPosition.stopLoss
            } catch (error: any) {
              // 如果订单未成交，使用当前价格
              exitPrice = await this.binance.fetchPrice(position.symbol)
              logger.info('补偿平仓', `止损订单状态: ${stopOrder.status}，使用当前价格: ${exitPrice}`)
            }
          }
        } catch (error: any) {
          // 如果查询订单失败，使用当前价格
          logger.warn('补偿平仓', `查询止损订单失败，使用当前价格: ${error.message}`)
          exitPrice = await this.binance.fetchPrice(position.symbol)
        }
      } else {
        // 如果没有止损订单ID，使用当前价格
        exitPrice = await this.binance.fetchPrice(position.symbol)
        logger.info('补偿平仓', `无止损订单ID，使用当前价格: ${exitPrice}`)
      }

      // 安全机制：如果exitPrice为0，强制重新获取价格
      if (exitPrice === 0) {
        logger.warn('补偿平仓', `exitPrice为0，强制重新获取价格`)
        exitPrice = await this.binance.fetchPrice(position.symbol)
        logger.info('补偿平仓', `重新获取的价格: ${exitPrice}`)
      }


      // 计算盈亏
      const { pnl, pnlPercentage } = calculatePnL(exitPrice, tempPosition)

      // 记录交易历史并更新状态
      await recordTrade(position.strategyId, tempPosition, exitPrice, reason)

      // 安全初始化 state
      this.ensureStateInitialized()

      // 更新每日盈亏
      this.state.dailyPnL += pnl

      // 更新连续亏损次数
      let consecutiveLosses = this.state.circuitBreaker.consecutiveLosses
      if (pnl < 0) {
        consecutiveLosses += 1
      } else {
        consecutiveLosses = 0
      }

      // 检查熔断条件
      const account = await this.binance.fetchBalance()
      const circuitBreakerConfig = this.getCircuitBreakerConfig()
      const breaker = checkCircuitBreaker(this.state.dailyPnL, consecutiveLosses, account.balance, circuitBreakerConfig)

      this.state.circuitBreaker = breaker
      this.state.status = breaker.isTriggered ? PositionStatus.HALTED : PositionStatus.MONITORING
      this.state.lastTradeTime = Date.now() // 更新上次交易时间（补偿平仓时间）
      
      // 如果触发熔断，停止运行
      if (breaker.isTriggered) {
        this.state.isRunning = false
        logger.error('熔断', breaker.reason)
      }

      // 清除仓位记录
      this.positionManager.clearPosition(position.symbol)

      await saveBotState(this.state)

      logger.success('补偿平仓完成', `盈亏: ${pnl.toFixed(2)} USDT (${pnlPercentage.toFixed(2)}%)，原因: ${reason}`)
    } catch (error: any) {
      logger.error('补偿平仓', '处理补偿平仓失败', error.message)
      throw error
    }
  }
}
