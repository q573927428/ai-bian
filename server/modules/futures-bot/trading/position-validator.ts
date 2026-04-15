import type { Position, BotConfig, BotState, Order } from '../../../../types'
import { PositionStatus } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { calculatePnL, checkCircuitBreaker } from '../../../utils/risk'
import { logger } from '../../../utils/logger'
import { saveBotState } from '../../../utils/storage'
import { recordTrade } from '../helpers/trade-recorder'
import { calculateIndicators } from '../../../utils/indicators'

/**
 * 持仓验证器
 */
export class PositionValidator {
  private binance: BinanceService
  private config: BotConfig
  private state: BotState
  private getStrategyAnalyzer?: () => any

  constructor(binance: BinanceService, config: BotConfig, state: BotState, getStrategyAnalyzer?: () => any) {
    this.binance = binance
    this.config = config
    this.state = state
    this.getStrategyAnalyzer = getStrategyAnalyzer
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
   * 检测手动平仓
   * 注意：必须先检查止损订单状态，再检查市价/限价订单
   * 因为止损触发后会产生市价订单，如果先检查市价订单会被错误识别为手动平仓
   */
  private async detectManualClose(position: Position): Promise<{
    isManualClose: boolean
    exitPrice?: number
    closeTime?: number
    orderId?: string
  }> {
    try {
      logger.info('手动平仓检测', `开始检测 ${position.symbol} 是否手动平仓`)
      
      // 1. 优先检查止损订单状态（条件单触发不是手动平仓）
      if (position.stopLossOrderId) {
        try {
          const stopOrder = await this.binance.fetchOrder(position.stopLossOrderId, position.symbol, { trigger: true })
          
          // 如果止损订单已成交，说明是止损触发，不是手动平仓
          if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
            const exitPrice = stopOrder.average || stopOrder.price || position.stopLoss || await this.binance.fetchPrice(position.symbol)
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
      const expectedSide = position.direction === 'LONG' ? 'SELL' : 'BUY'
      
      for (const order of recentOrders) {
        // 检查是否是平仓订单（市价单或限价单）
        if ((order.type === 'MARKET' || order.type === 'LIMIT') && 
            order.side === expectedSide && 
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
    position: Position, 
    manualCloseInfo: { exitPrice: number; closeTime: number; orderId?: string },
    strategyAnalyzer?: any
  ): Promise<void> {
    try {
      logger.info('手动平仓处理', `开始处理手动平仓: ${position.symbol}`)

      const { exitPrice, closeTime } = manualCloseInfo

      // 如果有策略分析器，生成分析指标
      if (strategyAnalyzer) {
        try {
          // 获取移动止损数据
          const trailingStopData = position.trailingStopData
          
          const metrics = await strategyAnalyzer.generateAnalysisMetrics(
            exitPrice,
            '手动平仓',
            closeTime,
            trailingStopData
          )
          logger.success('策略分析', `手动平仓分析指标已生成: ${position.symbol} MFE=${metrics.mfe.toFixed(2)}, MAE=${metrics.mae.toFixed(2)}`)
        } catch (error: any) {
          logger.error('策略分析', `手动平仓生成分析指标失败: ${error.message}`)
        }
      }

      // 取消止损单（如果存在）
      if (position.stopLossOrderId) {
        try {
          await this.binance.cancelOrder(position.stopLossOrderId, position.symbol, { trigger: true })
          logger.info('手动平仓处理', `成功取消止损订单: ${position.stopLossOrderId}`)
        } catch (error: any) {
          logger.warn('手动平仓处理', `取消止损订单失败: ${error.message}`)
        }
      }

      // 计算盈亏
      const { pnl, pnlPercentage } = calculatePnL(exitPrice, position)

      // 记录交易历史并更新状态（手动平仓）
      const updatedState = await recordTrade(position, exitPrice, '手动平仓')
      if (updatedState) {
        this.state = updatedState
      }

      // 更新每日盈亏（手动平仓影响每日盈亏）
      this.state.dailyPnL += pnl

      // 手动平仓不计入连续止损次数，不影响熔断机制
      // 只有当实际亏损且是系统止损时才计入连续止损

      // 检查熔断条件（只检查每日亏损，不计入连续止损）
      const account = await this.binance.fetchBalance()
      const breaker = checkCircuitBreaker(
        this.state.dailyPnL, 
        this.state.circuitBreaker.consecutiveLosses, // 保持原有连续止损次数
        account.balance, 
        this.config.riskConfig
      )

      this.state.circuitBreaker = breaker
      this.state.currentPosition = null
      this.state.status = breaker.isTriggered ? PositionStatus.HALTED : PositionStatus.MONITORING
      this.state.lastTradeTime = closeTime
      
      // 如果触发熔断，停止运行
      if (breaker.isTriggered) {
        this.state.isRunning = false
        logger.error('熔断', breaker.reason)
      }

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
  async checkPositionConsistency(position: Position): Promise<boolean> {
    const exchangePositions = await this.binance.fetchPositions(position.symbol)
  
    const hasPositionOnExchange = exchangePositions.some(p => {
      const exchangeSymbol = p.symbol.replace(':USDT', '')
      const localSymbol = position.symbol.replace(':USDT', '')
  
      if (exchangeSymbol !== localSymbol) return false
  
      const size = Number(p.quantity || 0)
  
      return Math.abs(size) > 0
    })
  
    // 🔥 核心判断：如果交易所没有持仓，说明仓位已被平仓（止损或止盈）
    if (!hasPositionOnExchange) {
      logger.warn(
        '状态同步',
        `检测到 ${position.symbol} 仓位已不存在（可能已止损/平仓），开始检测平仓原因`
      )
  
      try {
        // 获取策略分析器
        const strategyAnalyzer = this.getStrategyAnalyzer ? this.getStrategyAnalyzer() : undefined
        
        // 1. 检测是否是手动平仓
        const manualCloseInfo = await this.detectManualClose(position)
        
        if (manualCloseInfo.isManualClose && manualCloseInfo.exitPrice !== undefined && manualCloseInfo.closeTime !== undefined) {
          // 手动平仓处理
          const closeInfo = {
            exitPrice: manualCloseInfo.exitPrice!, // 使用非空断言，因为我们已经检查过不为undefined
            closeTime: manualCloseInfo.closeTime!, // 使用非空断言，因为我们已经检查过不为undefined
            orderId: manualCloseInfo.orderId
          }
          await this.handleManualClose(position, closeInfo, strategyAnalyzer)
        } else if (manualCloseInfo.isManualClose) {
          // 如果检测到手動平倉但缺少必要信息，使用默认值
          logger.warn('手动平仓处理', `检测到手动平仓但缺少必要信息，使用默认值`)
          const currentPrice = await this.binance.fetchPrice(position.symbol)
          const closeInfo = {
            exitPrice: currentPrice,
            closeTime: Date.now(),
            orderId: manualCloseInfo.orderId
          }
          await this.handleManualClose(position, closeInfo, strategyAnalyzer)
        } else {
          // 2. 如果不是手动平仓，继续原有补偿平仓逻辑
          let reason = '初始止损'
          
          // 检查止损订单状态来确定具体原因
          if (position.stopLossOrderId) {
            try {
              const stopOrder = await this.binance.fetchOrder(position.stopLossOrderId, position.symbol, { trigger: true })
              if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
                // 判断是否是移动止损：检查是否有移动止损数据且移动止损次数大于0
                const isTrailingStop = position.trailingStopData && 
                                      position.trailingStopData.trailingStopCount > 0
                reason = isTrailingStop ? '移动止损' : '初始止损'
              } else {
                // 止损订单未成交，可能是其他原因平仓
                reason = '未知原因'
              }
            } catch (error: any) {
              logger.warn('补偿平仓', `查询止损订单失败，使用默认原因: ${error.message}`)
              // 查询失败时也尝试判断是否是移动止损
              const isTrailingStop = position.trailingStopData && 
                                    position.trailingStopData.trailingStopCount > 0
              reason = isTrailingStop ? '移动止损' : '初始止损'
            }
          } else {
            reason = '未知原因'
          }
          
          await this.handleCompensatedClose(position, reason, strategyAnalyzer)
        }
      } catch (error: any) {
        logger.error('持仓一致性检查', '处理平仓流程失败', error.message)
        // 即使处理失败，也要清空本地状态
        this.state.currentPosition = null
        this.state.status = PositionStatus.MONITORING
        await saveBotState(this.state)
      }
  
      return false 
    }
  
    return true  
  }

  /**
   * 为补偿平仓记录出场指标
   */
  private async recordExitIndicatorsForCompensatedClose(position: Position, strategyAnalyzer: any): Promise<void> {
    try {
      
      // 获取当前指标 - 使用导入的calculateIndicators函数
      const indicators = await calculateIndicators(this.binance, position.symbol, this.config)
      
      // 记录出场指标到策略分析器
      strategyAnalyzer.recordExitIndicators(indicators)
      
      const strategyMode = this.config.strategyMode || 'short_term'
      const adxValue = indicators.adx15m  // 两种模式都使用ADX15m的值
      const adxLabel = strategyMode === 'short_term' ? 'ADX15m' : 'ADX1h'
      
      logger.info('策略分析', `补偿平仓出场指标已记录: ${position.symbol} RSI=${indicators.rsi}, ${adxLabel}=${adxValue}`)
    } catch (error: any) {
      logger.error('策略分析', `补偿平仓记录出场指标失败: ${error.message}`)
      // 即使记录失败，也不抛出异常，继续执行平仓流程
    }
  }

  /**
   * 处理补偿平仓（当检测到仓位已被平仓但本地没有记录时）
   */
  async handleCompensatedClose(position: Position, reason: string, strategyAnalyzer?: any): Promise<void> {
    try {
      logger.info('补偿平仓', `开始处理补偿平仓: ${position.symbol} ${reason}`)

      let exitPrice = 0
      let closeTime = Date.now()

      // 尝试查询止损订单状态
      if (position.stopLossOrderId) {
        try {
          //ccxt 最新 trigger: true 可以查询 条件委托 止损单 
          const stopOrder = await this.binance.fetchOrder(position.stopLossOrderId, position.symbol, { trigger: true })
          
          // 如果订单已成交，获取成交价格
          if (stopOrder.status === 'closed' || stopOrder.status === 'filled') {
            // 优化：优先使用average（平均成交价），然后是price，最后是position.stopLoss
            exitPrice = Number(stopOrder.info?.actualPrice) || stopOrder.average || stopOrder.price || position.stopLoss
            logger.info('补偿平仓', `止损订单已成交: ${stopOrder.status}，成交价: ${exitPrice}`)
          } else {
            //如果订单未成交 尝试取消止损单
            try {
              await this.binance.cancelOrder(position.stopLossOrderId, position.symbol, { trigger: true })
              logger.info('补偿平仓', `成功取消止损订单: ${position.stopLossOrderId}`)
              // 优化：优先使用average（平均成交价），然后是price，最后是position.stopLoss
              exitPrice = stopOrder.average || stopOrder.price || position.stopLoss
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

      // 如果有策略分析器，生成分析指标
      if (strategyAnalyzer) {
        try {
          // 在生成分析指标之前，先记录出场指标
          await this.recordExitIndicatorsForCompensatedClose(position, strategyAnalyzer)
          
          // 获取移动止损数据
          const trailingStopData = position.trailingStopData
          
          const metrics = await strategyAnalyzer.generateAnalysisMetrics(
            exitPrice,
            reason,
            closeTime,
            trailingStopData
          )
          logger.success('策略分析', `补偿平仓分析指标已生成: ${position.symbol} MFE=${metrics.mfe.toFixed(2)}, MAE=${metrics.mae.toFixed(2)}`)
        } catch (error: any) {
          logger.error('策略分析', `补偿平仓生成分析指标失败: ${error.message}`)
        }
      }

      // 计算盈亏
      const { pnl, pnlPercentage } = calculatePnL(exitPrice, position)

      // 记录交易历史并更新状态
      const updatedState = await recordTrade(position, exitPrice, reason)
      if (updatedState) {
        this.state = updatedState
      }

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
      const breaker = checkCircuitBreaker(this.state.dailyPnL, consecutiveLosses, account.balance, this.config.riskConfig)

      this.state.circuitBreaker = breaker
      this.state.currentPosition = null
      this.state.status = breaker.isTriggered ? PositionStatus.HALTED : PositionStatus.MONITORING
      this.state.lastTradeTime = Date.now() // 更新上次交易时间（补偿平仓时间）
      
      // 如果触发熔断，停止运行
      if (breaker.isTriggered) {
        this.state.isRunning = false
        logger.error('熔断', breaker.reason)
      }

      await saveBotState(this.state)

      logger.success('补偿平仓完成', `盈亏: ${pnl.toFixed(2)} USDT (${pnlPercentage.toFixed(2)}%)，原因: ${reason}`)
    } catch (error: any) {
      logger.error('补偿平仓', '处理补偿平仓失败', error.message)
      throw error
    }
  }
}
