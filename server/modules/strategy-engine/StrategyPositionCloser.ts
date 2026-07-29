// ==================== 多策略平仓模块 ====================

import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { saveBotState } from '../../utils/storage'
import { calculatePnL, checkCircuitBreaker } from '../../utils/trade-helpers'
import { recordTrade, type TradeSettlement } from './helpers/trade-recorder'
import { PositionStatus } from '../../../types'
import type { BotConfig, BotState, OrderExecutionSummary, Position } from '../../../types'

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
   * 从币安条件单返回中提取实际成交订单和触发时间
   *
   * algoId 只是条件单ID，触发后生成的 actualOrderId 才能用于查询真实成交明细。
   */
  private getTriggeredStopMetadata(stopOrder: any): {
    actualOrderId?: string
    triggerTime?: number
  } {
    const rawActualOrderId = String(stopOrder.info?.actualOrderId ?? '').trim()
    const actualOrderId = rawActualOrderId && rawActualOrderId !== '0'
      ? rawActualOrderId
      : undefined
    const rawTriggerTime = Number(
      stopOrder.info?.triggerTime
      || stopOrder.info?.updateTime
      || 0
    )

    return {
      actualOrderId,
      triggerTime: Number.isFinite(rawTriggerTime) && rawTriggerTime > 0
        ? rawTriggerTime
        : undefined,
    }
  }

  /**
   * 根据币安成交明细生成最终交易结算
   *
   * 新仓位的开仓手续费与平仓 realizedPnl 均来自 userTrades；旧仓位缺少真实
   * 开仓数据时，仅对缺失部分使用历史估算值并标记为 estimated。
   */
  private async resolveSettlement(
    positionInfo: any,
    position: Position,
    exitOrderId: string | undefined,
    fallbackExitPrice: number,
    closeTime: number = Date.now()
  ): Promise<{
    exitPrice: number
    totalCommission: number
    netPnl: number
    netPnlPercentage: number
    settlement: TradeSettlement
  }> {
    let exitExecution: OrderExecutionSummary | null = null
    if (exitOrderId) {
      try {
        exitExecution = await this.binance.waitForOrderExecutionSummary(
          position.symbol,
          exitOrderId
        )
      } catch (error: any) {
        logger.warn('平仓对账', `读取币安成交明细失败，使用兼容估算: ${error.message}`)
      }
    }

    const exitPrice = exitExecution?.averagePrice || fallbackExitPrice
    const estimated = calculatePnL(exitPrice, position, this.config.commissionRate ?? 0.0005)
    const entryCommission = positionInfo.entryCommission ?? position.entryCommission
      ?? (position.entryPrice * position.quantity * (this.config.commissionRate ?? 0.0005))
    const exitCommission = exitExecution?.commissionInUsdt
      ?? (exitPrice * position.quantity * (this.config.commissionRate ?? 0.0005))
    const totalCommission = entryCommission + exitCommission
    const grossRealizedPnl = exitExecution?.realizedPnl ?? estimated.pnl
    const settlementCloseTime = exitExecution?.timestamp || closeTime
    let fundingFee: number | undefined
    try {
      fundingFee = await this.binance.fetchFundingFee(position.symbol, position.openTime, settlementCloseTime)
    } catch (error: any) {
      // 资金费查询失败不能阻断平仓，但净收益只能暂时按未计资金费处理并标记为估算。
      logger.warn('平仓对账', `读取资金费失败，净收益暂未计入资金费: ${error.message}`)
    }
    const netPnl = grossRealizedPnl - totalCommission + (fundingFee ?? 0)
    const initialMargin = position.entryPrice * position.quantity / position.leverage
    const netPnlPercentage = initialMargin > 0 ? netPnl / initialMargin * 100 : 0
    const exitCommissionAsset = exitExecution?.commissions.length === 1
      ? exitExecution.commissions[0]?.asset || 'USDT'
      : exitExecution?.commissions.length ? 'MULTI' : 'USDT'
    const exitCommissionRaw = exitExecution?.commissions.length === 1
      ? exitExecution.commissions[0]?.amount ?? exitCommission
      : exitCommission
    const hasConfirmedEntry = (positionInfo.entryDataSource ?? position.entryDataSource) === 'binance'

    return {
      exitPrice,
      totalCommission,
      netPnl,
      netPnlPercentage,
      settlement: {
        grossRealizedPnl,
        fundingFee,
        entryCommission,
        exitCommission,
        entryCommissionAsset: positionInfo.entryCommissionAsset ?? position.entryCommissionAsset ?? 'USDT',
        exitCommissionAsset,
        entryCommissionRaw: positionInfo.entryCommissionRaw ?? position.entryCommissionRaw ?? entryCommission,
        exitCommissionRaw,
        entryOrderId: positionInfo.entryOrderId ?? position.entryOrderId ?? positionInfo.orderId ?? position.orderId,
        exitOrderId,
        executionTradeIds: exitExecution?.tradeIds,
        closeTime: settlementCloseTime,
        source: exitExecution && hasConfirmedEntry && fundingFee !== undefined ? 'binance' : 'estimated',
      }
    }
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

      // 3. 以币安成交明细作为最终收益来源，行情价只用于接口暂时不可用时兼容回退。
      const fallbackExitPrice = order.average || exitPrice || await this.binance.fetchPrice(symbol)
      const result = await this.resolveSettlement(
        position,
        position.position!,
        order.orderId,
        fallbackExitPrice
      )
      const { exitPrice: finalExitPrice, totalCommission, netPnl, netPnlPercentage, settlement } = result

      logger.info('平仓', `币安结算结果:`, {
        毛利: settlement.grossRealizedPnl.toFixed(4),
        开仓手续费: settlement.entryCommission.toFixed(4),
        平仓手续费: settlement.exitCommission.toFixed(4),
        资金费: settlement.fundingFee?.toFixed(4) ?? '未获取',
        净利: netPnl.toFixed(4),
        数据来源: settlement.source
      })

      // 6. 记录交易历史（包含完整指标）
      await recordTrade(
        position.strategyId, 
        position.position!, 
        finalExitPrice, 
        reason, 
        totalCommission, 
        netPnl, 
        netPnlPercentage,
        this.config.commissionRate ?? 0.0005,
        position, // 传入完整的 positionInfo
        settlement
      )

      // 7. 安全初始化 state
      this.ensureStateInitialized()

      // 8. 更新全局状态（临时兼容老架构）
      this.state.dailyPnL += netPnl
      if (netPnl < 0) {
        this.state.circuitBreaker.consecutiveLosses += 1
      } else {
        this.state.circuitBreaker.consecutiveLosses = 0
      }

      // 9. 检查熔断
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

      // 10. 清除仓位记录
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
            const stopMetadata = this.getTriggeredStopMetadata(stopOrder)
            const exitPrice = stopOrder.average || stopOrder.price || position.position.stopLoss || await this.binance.fetchPrice(position.symbol)
            logger.info('手动平仓检测', `检测到止损订单已成交: ${stopOrder.status}, 实际订单: ${stopMetadata.actualOrderId || '未获取'}, 成交价: ${exitPrice}，非手动平仓`)
            return {
              isManualClose: false,
              exitPrice,
              closeTime: stopMetadata.triggerTime || Date.now(),
              orderId: stopMetadata.actualOrderId
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

      // 手动平仓同样按检测到的币安订单ID读取真实成交，而不是使用检测时行情价直接估算。
      const result = await this.resolveSettlement(
        position,
        tempPosition,
        manualCloseInfo.orderId,
        exitPrice,
        closeTime
      )
      const {
        exitPrice: finalExitPrice,
        totalCommission,
        netPnl,
        netPnlPercentage,
        settlement
      } = result

      // 记录交易历史并更新状态（手动平仓，传入完整的 positionInfo 以保存入场指标和持仓统计）
      await recordTrade(
        position.strategyId,
        tempPosition,
        finalExitPrice,
        '手动平仓',
        totalCommission,
        netPnl,
        netPnlPercentage,
        this.config.commissionRate ?? 0.0005,
        position,
        settlement
      )

      // 安全初始化 state
      this.ensureStateInitialized()

      // 更新每日盈亏（手动平仓影响每日盈亏，使用净利）
      this.state.dailyPnL += netPnl

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

      logger.success('手动平仓处理完成', `盈亏: ${netPnl.toFixed(2)} USDT (${netPnlPercentage.toFixed(2)}%)，原因: 手动平仓`)
    } catch (error: any) {
      logger.error('手动平仓处理', '处理手动平仓失败', error.message)
      throw error
    }
  }

  /**
   * 检查持仓一致性（新增方法）
   * 验证本地持仓状态与交易所实际状态是否一致
   */
  async checkPositionConsistency(symbol: string, exchangePositionsSnapshot?: Position[]): Promise<boolean> {
    const position = this.positionManager.getPosition(symbol)
    if (!position) {
      logger.warn('持仓一致性检查', `未找到本地仓位: ${symbol}`)
      return false
    }

    const exchangePositions = exchangePositionsSnapshot ?? await this.binance.fetchPositions(symbol)
  
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
          
          await this.handleCompensatedClose(position, reason, manualCloseInfo.orderId)
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
  async handleCompensatedClose(position: any, reason: string, detectedExitOrderId?: string): Promise<void> {
    try {
      // 安全检查：确保position存在
      if (!position) {
        logger.error('补偿平仓', `仓位信息不存在，无法处理`)
        return
      }
      
      logger.info('补偿平仓', `开始处理补偿平仓: ${position.symbol} ${reason}`)

      let exitPrice = 0
      let closeTime = Date.now()
      let exitOrderId = detectedExitOrderId

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
            const stopMetadata = this.getTriggeredStopMetadata(stopOrder)
            // 优化：优先使用average（平均成交价），然后是price，最后是position.stopLoss
            exitPrice = Number(stopOrder.info?.actualPrice) || stopOrder.average || stopOrder.price || tempPosition.stopLoss
            exitOrderId = stopMetadata.actualOrderId || detectedExitOrderId
            closeTime = stopMetadata.triggerTime || closeTime
            logger.info('补偿平仓', `止损订单已成交: ${stopOrder.status}，算法订单: ${stopLossOrderId}，实际订单: ${exitOrderId || '未获取'}，成交价: ${exitPrice}`)
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


      // 止损触发和补偿记录也必须回查真实成交；查询不到时才保留旧版估算结果。
      const result = await this.resolveSettlement(
        position,
        tempPosition,
        exitOrderId,
        exitPrice,
        closeTime
      )
      const {
        exitPrice: finalExitPrice,
        totalCommission,
        netPnl,
        netPnlPercentage,
        settlement
      } = result

      // 记录交易历史并更新状态（传入完整的 positionInfo 以保存入场指标和持仓统计）
      await recordTrade(
        position.strategyId,
        tempPosition,
        finalExitPrice,
        reason,
        totalCommission,
        netPnl,
        netPnlPercentage,
        this.config.commissionRate ?? 0.0005,
        position,
        settlement
      )

      // 安全初始化 state
      this.ensureStateInitialized()

      // 更新每日盈亏（使用净利）
      this.state.dailyPnL += netPnl

      // 更新连续亏损次数（基于净利）
      let consecutiveLosses = this.state.circuitBreaker.consecutiveLosses
      if (netPnl < 0) {
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

      logger.success('补偿平仓完成', `盈亏: ${netPnl.toFixed(2)} USDT (${netPnlPercentage.toFixed(2)}%)，原因: ${reason}`)
    } catch (error: any) {
      logger.error('补偿平仓', '处理补偿平仓失败', error.message)
      throw error
    }
  }
}
