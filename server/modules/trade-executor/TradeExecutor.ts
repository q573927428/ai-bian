// ==================== 交易执行器 ====================

import type { Strategy, StrategyId } from '../../../types/strategy'
import type { TradeSignal } from '../../../types/signal'
import type { Position, BotState, BotConfig, OHLCV, TechnicalIndicators, AIAnalysis } from '../../../types'
import { BinanceService } from '../../utils/binance'
import { IndicatorsCache } from '../futures-bot/services/indicators-cache'
import { PriceService } from '../futures-bot/services/price-service'
import { PositionOpener } from '../futures-bot/trading/position-opener'
import { PositionCloser } from '../futures-bot/trading/position-closer'
import { PositionMonitor } from '../futures-bot/trading/position-monitor'
import { PositionManager } from '../position-manager/PositionManager'
import { logger } from '../../utils/logger'
import { calculateStopLoss, calculatePositionSize } from '../../utils/indicators-risk'
import { calculateQuickLeverage } from '../../utils/dynamic-leverage'

/**
 * 交易执行结果
 */
export interface TradeExecutionResult {
  success: boolean;
  position?: Position;
  error?: string;
  orderId?: string;
}

/**
 * 交易执行器
 * 
 * 职责：
 * 1. 封装现有的开仓/平仓/监控逻辑
 * 2. 适配新策略引擎的接口
 * 3. 与仓位管理器协作
 * 4. 提供统一的交易执行接口
 */
export class TradeExecutor {
  private binance: BinanceService
  private indicatorsCache: IndicatorsCache
  private priceService: PriceService
  private positionOpener: PositionOpener
  private positionCloser: PositionCloser
  private positionMonitor: PositionMonitor
  private positionManager: PositionManager
  private config: BotConfig
  private state: BotState

  constructor(
    binance: BinanceService,
    config: BotConfig,
    state: BotState,
    positionManager: PositionManager
  ) {
    this.binance = binance
    this.config = config
    this.state = state
    this.positionManager = positionManager

    // 初始化依赖服务
    this.indicatorsCache = IndicatorsCache.getInstance(binance, config)
    this.priceService = new PriceService(binance)

    // 初始化交易执行模块
    this.positionOpener = new PositionOpener(binance, config, state)
    this.positionCloser = new PositionCloser(binance, config, state)
    this.positionMonitor = new PositionMonitor(binance, this.priceService, this.indicatorsCache, config, state)

    logger.info('TradeExecutor', '交易执行器已初始化')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    this.indicatorsCache.updateConfig(config)
  }

  /**
   * 更新状态
   */
  updateState(state: BotState): void {
    this.state = state
  }

  // ==================== 开仓 ====================

  /**
   * 执行开仓
   */
  async executeOpen(signal: TradeSignal, strategy: Strategy): Promise<TradeExecutionResult> {
    try {
      logger.info('TradeExecutor', `执行开仓: ${signal.symbol} ${signal.direction}`)

      // 1. 验证信号
      if (!this.validateSignal(signal)) {
        return { success: false, error: '信号验证失败' }
      }

      // 2. 检查仓位冲突
      if (await this.positionManager.hasConflict(signal.symbol, signal.strategyId)) {
        return { success: false, error: '交易对已有仓位' }
      }

      // 3. 获取当前价格
      const price = await this.priceService.getPrice(signal.symbol)

      // 4. 获取指标数据
      const indicators = await this.indicatorsCache.getIndicators(signal.symbol)

      // 5. 计算止损
      const stopLoss = this.calculateStopLossFromSignal(signal, indicators)

      // 6. 计算杠杆
      const leverage = this.calculateLeverage(signal, strategy, indicators)

      // 7. 计算仓位
      const positionSize = this.calculatePositionFromSignal(signal, strategy, price, stopLoss)

      // 8. 创建仓位对象
      const position: Position = {
        symbol: signal.symbol,
        direction: signal.direction === 'long' ? 'LONG' : 'SHORT',
        entryPrice: price,
        quantity: positionSize,
        leverage,
        stopLoss,
        initialStopLoss: stopLoss,
        takeProfit1: 0, // 后续计算
        takeProfit2: 0, // 后续计算
        openTime: Date.now(),
        highestPrice: price,
        lowestPrice: price,
        orderId: '',
        stopLossOrderId: '',
        stopLossOrderSymbol: '',
        stopLossOrderSide: 'SELL',
        stopLossOrderType: 'STOP_MARKET',
        stopLossOrderQuantity: positionSize,
        stopLossOrderStopPrice: stopLoss,
        stopLossOrderStatus: 'NEW',
        stopLossOrderTimestamp: Date.now()
      }

      // 9. 调用现有的开仓逻辑
      await this.positionOpener.openPosition({
        ...signal,
        price,
        indicators,
        aiAnalysis: signal.indicators ? {
          symbol: signal.symbol,
          timestamp: Date.now(),
          direction: signal.direction === 'long' ? 'LONG' : 'SHORT',
          confidence: signal.confidence,
          score: signal.confidence,
          riskLevel: 'MEDIUM',
          isBullish: signal.direction === 'long',
          reasoning: signal.reasoning,
          technicalData: {
            price,
            ema20: indicators.emaFast,
            ema60: indicators.emaSlow,
            rsi: indicators.rsi,
            volume: 0
          }
        } : undefined
      } as any)

      // 10. 锁定交易对
      this.positionManager.lockSymbol(signal.symbol, signal.strategyId)

      // 11. 记录仓位
      this.positionManager.recordPosition(signal.symbol, {
        symbol: signal.symbol,
        strategyId: signal.strategyId,
        direction: signal.direction,
        entryPrice: price,
        quantity: positionSize,
        leverage,
        openTime: Date.now(),
        position
      })

      logger.success('TradeExecutor', `开仓成功: ${signal.symbol} ${signal.direction}`)

      return {
        success: true,
        position,
        orderId: position.orderId
      }
    } catch (error: any) {
      logger.error('TradeExecutor', `开仓失败: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  // ==================== 平仓 ====================

  /**
   * 执行平仓
   */
  async executeClose(symbol: string, reason: string): Promise<TradeExecutionResult> {
    try {
      logger.info('TradeExecutor', `执行平仓: ${symbol}, 原因: ${reason}`)

      // 获取仓位信息
      const positionInfo = this.positionManager.getPosition(symbol)
      if (!positionInfo || !positionInfo.position) {
        return { success: false, error: '仓位不存在' }
      }

      // 调用现有的平仓逻辑
      await this.positionCloser.closePosition(positionInfo.position, reason)

      // 释放交易对锁
      this.positionManager.unlockSymbol(symbol)

      // 清除仓位记录
      this.positionManager.clearPosition(symbol)

      logger.success('TradeExecutor', `平仓成功: ${symbol}`)

      return { success: true }
    } catch (error: any) {
      logger.error('TradeExecutor', `平仓失败: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  // ==================== 监控 ====================

  /**
   * 监控持仓
   */
  async monitorPosition(symbol: string): Promise<{ shouldClose: boolean; reason?: string }> {
    try {
      const positionInfo = this.positionManager.getPosition(symbol)
      if (!positionInfo || !positionInfo.position) {
        return { shouldClose: false }
      }

      // 调用现有的监控逻辑
      const result = await this.positionMonitor.monitorPosition(positionInfo.position)

      return result
    } catch (error: any) {
      logger.error('TradeExecutor', `监控失败: ${error.message}`)
      return { shouldClose: false }
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 验证信号
   */
  private validateSignal(signal: TradeSignal): boolean {
    if (!signal.symbol || !signal.direction || !signal.action) {
      logger.warn('TradeExecutor', '信号缺少必要字段')
      return false
    }

    if (signal.confidence < 70) {
      logger.error('TradeExecutor', `信号置信度过低: ${signal.confidence}`)
      return false
    }

    return true
  }

  /**
   * 计算止损
   */
  private calculateStopLossFromSignal(
    signal: TradeSignal,
    indicators: TechnicalIndicators
  ): number {
    const atr = indicators.atr || 0
    const atrMultiplier = this.config.stopLossATRMultiplier || 2.5
    const maxStopLossPct = this.config.maxStopLossPercentage || 2

    return calculateStopLoss(
      signal.price,
      signal.direction === 'long' ? 'LONG' : 'SHORT',
      atr,
      atrMultiplier,
      maxStopLossPct
    )
  }

  /**
   * 计算杠杆
   */
  private calculateLeverage(
    signal: TradeSignal,
    strategy: Strategy,
    indicators: TechnicalIndicators
  ): number {
    if (strategy.executionConfig.leverage !== 'dynamic') {
      return strategy.executionConfig.leverage as number
    }

    // 使用现有的动态杠杆计算
    return calculateQuickLeverage(
      indicators,
      signal.confidence >= 80 ? 'LOW' : signal.confidence >= 60 ? 'MEDIUM' : 'HIGH',
      this.config.dynamicLeverageConfig
    )
  }

  /**
   * 计算仓位大小
   */
  private calculatePositionFromSignal(
    signal: TradeSignal,
    strategy: Strategy,
    price: number,
    stopLoss: number
  ): number {
    const riskPercentage = strategy.riskManagement.maxRiskPercentage || this.config.maxRiskPercentage
    const stopLossDistance = Math.abs(price - stopLoss) / price

    // 计算风险金额
    const riskAmount = (price * riskPercentage) / 100

    // 计算仓位大小
    return calculatePositionSize(riskAmount, stopLossDistance, price)
  }

  /**
   * 获取所有活跃仓位
   */
  getActivePositions() {
    return this.positionManager.getActivePositions()
  }

  /**
   * 获取指定策略的仓位
   */
  getStrategyPositions(strategyId: StrategyId) {
    return this.positionManager.getStrategyPositions(strategyId)
  }
}
