import type { Position, BotConfig, BotState, TechnicalIndicators } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { calculatePnL, isPositionTimeout, checkTP1Condition, checkTP2Condition, getOrderSide } from '../../../utils/risk'
import { logger } from '../../../utils/logger'
import { saveBotState } from '../../../utils/storage'
import { calculateTrailingStopLoss } from '../helpers/trailing-stop'
import { PriceService } from '../services/price-service'
import { IndicatorsCache } from '../services/indicators-cache'
import { StrategyAnalyzer } from '../helpers/strategy-analyzer'

/**
 * 持仓监控器
 */
export class PositionMonitor {
  private binance: BinanceService
  private priceService: PriceService
  private indicatorsCache: IndicatorsCache
  private config: BotConfig
  private state: BotState
  private lastLogTime: number = 0
  private logInterval: number = 60000 // 默认60秒

  constructor(
    binance: BinanceService,
    priceService: PriceService,
    indicatorsCache: IndicatorsCache,
    config: BotConfig,
    state: BotState
  ) {
    this.binance = binance
    this.priceService = priceService
    this.indicatorsCache = indicatorsCache
    this.config = config
    this.state = state
    this.logInterval = this.config.positionScanInterval * 2 * 1000
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    // 同步更新 indicatorsCache 的配置
    this.indicatorsCache.updateConfig(config)
    this.logInterval = this.config.positionScanInterval * 2 * 1000
  }

  /**
   * 更新状态
   */
  updateState(state: BotState): void {
    this.state = state
  }

  /**
   * 监控持仓
   * @returns 返回是否需要平仓以及平仓原因
   */
  async monitorPosition(
    position: Position,
    strategyAnalyzer?: StrategyAnalyzer
  ): Promise<{ shouldClose: boolean; reason?: string }> {
    try {
      // 使用PriceService获取价格（优先WebSocket缓存）
      const price = await this.priceService.getPrice(position.symbol)

      // 计算当前盈亏
      const { pnl, pnlPercentage } = calculatePnL(price, position)

      // 减少日志记录频率：使用监控间隔的2倍作为日志间隔，或者盈亏变化超过0.5%
      const now = Date.now()
      const shouldLog = (now - this.lastLogTime > this.logInterval) || 
                       Math.abs(pnlPercentage - (this.state.currentPnLPercentage || 0)) > 0.5

      if (shouldLog) {
        logger.info(
          '持仓监控',
          `${position.symbol} ${position.direction} 入场价: ${position.entryPrice} 当前价: ${price} 盈亏: ${pnl.toFixed(2)} USDT (${pnlPercentage.toFixed(2)}%)`
        )
        this.lastLogTime = now
      }

      // 保存当前价格和盈亏到state中，供前端显示
      this.state.currentPrice = price
      this.state.currentPnL = pnl
      this.state.currentPnLPercentage = pnlPercentage
      await saveBotState(this.state)

      // 如果有策略分析器，记录价格点
      if (strategyAnalyzer) {
        strategyAnalyzer.recordPricePoint(price, now)
      }

      // 使用 IndicatorsCache 获取指标（内部有1分钟缓存，避免频繁API调用）
      const indicators = await this.indicatorsCache.getIndicators(position.symbol)
      
      // 如果有策略分析器，记录ATR值
      if (strategyAnalyzer) {
        strategyAnalyzer.recordATR(indicators.atr)
      }

      // 使用ADX斜率判断趋势走弱（负斜率表示ADX下降）
      const isADXDecreasing = indicators.adxSlope < 0
      
      // 检查持仓超时（ADX走弱时触发）
      const isTimeout = isPositionTimeout(position, this.config.positionTimeoutHours, isADXDecreasing)
      if (isTimeout) {
        logger.warn('风控', `持仓超时且ADX走弱 (ADX斜率: ${indicators.adxSlope.toFixed(2)}, currentADX: ${indicators.adx15m.toFixed(2)})`)
        return { shouldClose: true, reason: '持仓超时' }
      }

      // 检查TP2条件（高阶止盈，仅盈亏比触发）
      const tp2Result = checkTP2Condition(price, position, this.config.riskConfig)
      if (tp2Result.triggered) {
        logger.success('止盈', tp2Result.reason, tp2Result.data)
        return { shouldClose: true, reason: 'TP2止盈' }
      }

      // 检查TP1条件（整合保护机制：盈亏比，或RSI极值，或ADX走弱）
      const tp1Result = checkTP1Condition(price, position, indicators.rsi, indicators.adxSlope, this.config.riskConfig)
      if (tp1Result.triggered) {
        logger.success('止盈', tp1Result.reason, tp1Result.data)
        return { shouldClose: true, reason: 'TP1止盈' }
      }

      // 更新极值价格（无论是否计算指标，都需要持续追踪最高/最低价）
      this.updateExtremePrice(price, position)

      // 检查移动止损（使用ATR指标）
      await this.checkAndUpdateTrailingStop(price, position, indicators.atr)

      return { shouldClose: false }
    } catch (error: any) {
      logger.error('持仓监控', '监控失败', error.message)
      return { shouldClose: false }
    }
  }

  /**
   * 检查并更新移动止损
   */
  private async checkAndUpdateTrailingStop(
    currentPrice: number,
    position: Position,
    atr: number
  ): Promise<void> {
    // 如果未启用移动止损，直接返回
    if (!this.config.trailingStopConfig.enabled) {
      return
    }

    try {

      // 计算新的止损价格
      const result = calculateTrailingStopLoss(
        currentPrice,
        position,
        atr,
        this.config.trailingStopConfig
      )

      // 更新极值价格到 position（即使不更新止损也要保存最新的最高/最低价）
      if (result.updatedHighestPrice !== undefined) {
        position.highestPrice = result.updatedHighestPrice
      }
      if (result.updatedLowestPrice !== undefined) {
        position.lowestPrice = result.updatedLowestPrice
      }

      // 如果需要更新止损
      if (result.shouldUpdate && result.newStopLoss) {
        // 增加方向验证（防御性检查）
        if (position.direction === 'LONG' && result.newStopLoss <= position.stopLoss) {
          logger.warn('移动止损', `新止损 ${result.newStopLoss} 不优于当前止损 ${position.stopLoss}，跳过更新`)
          return
        }
        if (position.direction === 'SHORT' && result.newStopLoss >= position.stopLoss) {
          logger.warn('移动止损', `新止损 ${result.newStopLoss} 不优于当前止损 ${position.stopLoss}，跳过更新`)
          return
        }
        
        await this.updateStopLoss(position, result.newStopLoss, result.reason)
      }
    } catch (error: any) {
      logger.error('移动止损', '检查失败', error.message)
    }
  }

  /**
   * 更新止损价格
   */
  private async updateStopLoss(
    position: Position,
    newStopLoss: number,
    reason: string
  ): Promise<void> {
    try {
      logger.info('移动止损', `准备更新止损: ${reason}`)

      // 1. 取消旧止损单
      if (position.stopLossOrderId) {
        try {
          await this.binance.cancelOrder(position.stopLossOrderId, position.symbol, { trigger: true })
          logger.info('移动止损', '旧止损单已取消')
        } catch (e: any) {
          logger.warn('移动止损', `取消旧止损单失败: ${e.message}`)
        }
      }

      // 2. 创建新止损单
      if (position.direction === 'IDLE') {
        throw new Error('持仓方向无效')
      }
      const side = getOrderSide(position.direction, false)
      const newStopOrder = await this.binance.stopLossOrder(
        position.symbol,
        side,
        position.quantity,
        newStopLoss
      )

      logger.success('移动止损', '新止损单已创建', newStopOrder)

      // 3. 记录移动止损数据
      this.recordTrailingStopData(position, newStopLoss, reason)

      // 4. 更新持仓信息
      position.stopLoss = newStopLoss
      position.stopLossOrderId = newStopOrder.orderId
      position.stopLossOrderStopPrice = newStopOrder.stopPrice
      position.stopLossOrderTimestamp = newStopOrder.timestamp
      position.lastStopLossUpdate = Date.now()

      // 5. 更新状态到state
      if (this.state.currentPosition) {
        this.state.currentPosition = position
        await saveBotState(this.state)
      }

      logger.success('移动止损', `止损已更新至 ${newStopLoss.toFixed(2)}`)
    } catch (error: any) {
      logger.error('移动止损', '更新失败', error.message)
      throw error
    }
  }

  /**
   * 更新极值价格（最高价/最低价）
   * 这个方法在每次监控时都会调用，确保不会错过任何极值
   */
  private updateExtremePrice(currentPrice: number, position: Position): void {
    let updated = false
    
    if (position.direction === 'LONG') {
      // 多头：追踪最高价
      const previousHighest = position.highestPrice || position.entryPrice
      const newHighest = Math.max(previousHighest, currentPrice)
      if (newHighest > previousHighest) {
        position.highestPrice = newHighest
        updated = true
        logger.info('极值追踪', `${position.symbol} 多头最高价更新: ${previousHighest.toFixed(3)} → ${newHighest.toFixed(3)}`)
      }
    } else if (position.direction === 'SHORT') {
      // 空头：追踪最低价
      const previousLowest = position.lowestPrice || position.entryPrice
      const newLowest = Math.min(previousLowest, currentPrice)
      if (newLowest < previousLowest) {
        position.lowestPrice = newLowest
        updated = true
        logger.info('极值追踪', `${position.symbol} 空头最低价更新: ${previousLowest.toFixed(3)} → ${newLowest.toFixed(3)}`)
      }
    }

    // 如果有更新，保存到状态
    if (updated && this.state.currentPosition) {
      this.state.currentPosition = position
      // 注意：这里不调用 saveBotState，因为 monitorPosition 会在稍后保存
    }
  }

  /**
   * 记录移动止损数据
   */
  private recordTrailingStopData(
    position: Position,
    newStopLoss: number,
    reason: string
  ): void {
    try {
      const now = Date.now()
      
      // 初始化移动止损数据
      if (!position.trailingStopData) {
        position.trailingStopData = {
          enabled: this.config.trailingStopConfig.enabled,
          activationRatio: this.config.trailingStopConfig.activationRatio,
          trailingDistance: this.config.trailingStopConfig.trailingDistance,
          minMovePercent: this.config.trailingStopConfig.minMovePercent,
          trailingStopCount: 0
        }
      }

      // 更新移动止损数据
      position.trailingStopData.lastTrailingStopPrice = newStopLoss
      position.trailingStopData.lastTrailingStopUpdateTime = now
      position.trailingStopData.trailingStopCount += 1

      logger.info('移动止损数据', `记录移动止损: 价格 ${newStopLoss.toFixed(2)}, 次数 ${position.trailingStopData.trailingStopCount}`)
    } catch (error: any) {
      logger.error('移动止损数据', '记录失败', error.message)
      throw error
    }
  }
}
