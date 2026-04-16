import type { TradeSignal, Position, BotConfig, BotState, TechnicalIndicators } from '../../../../types'
import { PositionStatus } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { calculateStopLoss, calculateTakeProfit, calculatePositionSize, calculateMaxUsdtAmount } from '../../../utils/indicators'
import { getOrderSide } from '../../../utils/risk'
import { 
  calculateQuickLeverage,
  calculateSafeLeverage,
  calculateFinalLeverage
} from '../../../utils/dynamic-leverage'
import { logger } from '../../../utils/logger'
import { saveBotState } from '../../../utils/storage'
import { waitAndConfirmPosition } from '../helpers/position-helpers'
import { IndicatorsCache } from '../services/indicators-cache'

/**
 * 持仓开仓器
 */
export class PositionOpener {
  private binance: BinanceService
  private config: BotConfig
  private state: BotState
  private onPositionOpened?: (position: any, entryIndicators?: TechnicalIndicators, aiAnalysis?: any) => Promise<void> | void

  constructor(
    binance: BinanceService, 
    config: BotConfig, 
    state: BotState,
    onPositionOpened?: (position: any, entryIndicators?: TechnicalIndicators, aiAnalysis?: any) => Promise<void> | void
  ) {
    this.binance = binance
    this.config = config
    this.state = state
    this.onPositionOpened = onPositionOpened
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
   * 开仓
   */
  async openPosition(signal: TradeSignal): Promise<void> {
    try {
      logger.info('开仓', `准备开仓: ${signal.symbol} ${signal.direction}`)

      // 确保方向不是IDLE
      if (signal.direction === 'IDLE') {
        logger.warn('开仓', '交易信号方向为IDLE，无法开仓')
        return
      }

      // 获取账户余额
      const account = await this.binance.fetchBalance()
      logger.info('账户', `余额: ${account.availableBalance} USDT`)

      //如果账户余额不足120，提示不够return
      if (account.availableBalance < 120) {
        logger.warn('余额不足', `账户余额（${account.availableBalance} USDT）,不足120 USDT，无法开仓`)
        return
      }

      this.state.status = PositionStatus.OPENING
      await saveBotState(this.state)

      // 保存入场指标，供策略分析器使用
      const entryIndicators = signal.indicators

      // 计算止损价格
      const stopLoss = calculateStopLoss(
        signal.price,
        signal.direction,
        signal.indicators.atr,
        this.config.stopLossATRMultiplier,
        this.config.maxStopLossPercentage
      )

      // 计算动态杠杆（如果启用）- 使用简化版
      let finalLeverage = this.config.leverage
      let leverageCalculationDetails = {}

      if (this.config.dynamicLeverageConfig.enabled && signal.aiAnalysis) {
        try {
          // 使用纯技术指标版动态杠杆计算
          const dynamicLeverage = calculateQuickLeverage(
            signal.indicators,
            signal.aiAnalysis?.riskLevel || 'MEDIUM',
            this.config.dynamicLeverageConfig
          )

          // 计算安全杠杆（基于账户风险），考虑ADX趋势强度
          const safeLeverage = calculateSafeLeverage(
            account.availableBalance,
            this.config.maxRiskPercentage,
            stopLoss,
            signal.price,
            signal.indicators.adx15m  // 传递15分钟ADX值，用于动态调整最小止损距离
          )

          // 计算最终杠杆（取两者中的较小值）
          finalLeverage = calculateFinalLeverage(dynamicLeverage, safeLeverage, this.config.dynamicLeverageConfig)

          leverageCalculationDetails = {
            dynamicLeverage,
            safeLeverage,
            finalLeverage,
            riskLevel: signal.aiAnalysis?.riskLevel || 'MEDIUM',
            adx15m: signal.indicators.adx15m,
            rsi: signal.indicators.rsi,
            atrPercent: ((signal.indicators.atr / signal.indicators.ema20) * 100).toFixed(2) + '%',
            openInterestTrend: signal.indicators.openInterestTrend
          }

          logger.info('动态杠杆', `杠杆计算完成 ${finalLeverage} X`, leverageCalculationDetails)
        } catch (error: any) {
          logger.warn('动态杠杆', `动态杠杆计算失败，使用静态杠杆: ${error.message}`)
          // 如果动态杠杆计算失败，使用静态杠杆
          finalLeverage = this.config.leverage
        }
      } else {
        logger.info('杠杆', `使用静态杠杆: ${finalLeverage}x`)
      }

      // 设置杠杆和持仓模式
      await this.binance.setLeverage(signal.symbol, finalLeverage)
      await this.binance.setMarginMode(signal.symbol, 'cross')
      
      // 设置持仓模式为单向（因为我们一次只持有一个方向的仓位）
      try {
        await this.binance.setPositionMode(false) // false = 单向持仓模式
        logger.info('持仓模式', '已设置为单向持仓模式')
      } catch (error: any) {
        // 如果设置失败，记录警告但继续执行
        logger.warn('持仓模式', `设置持仓模式失败: ${error.message}`)
      }

      // 计算基于风险管理的仓位大小（USDT金额）
      const riskAmount = calculatePositionSize(
        account.availableBalance,
        signal.price,
        stopLoss,
        this.config.maxRiskPercentage
      )

      // 计算最大可用USDT金额（考虑杠杆）
      const maxUsdtAmount = calculateMaxUsdtAmount(
        account.availableBalance,
        finalLeverage,
        this.config.maxRiskPercentage
      )

      // 使用较小的金额：风险金额或最大可用金额
      const usdtAmount = Math.min(riskAmount, maxUsdtAmount)

      // 检查最小名义价值
      const minQuantity = 20 / signal.price // 计算满足20 USDT最小名义价值所需的最小数量
      const estimatedQuantity = usdtAmount / signal.price
      
      let quantity: number
      let finalUsdtAmount: number
      let notional: number
      
      if (estimatedQuantity < minQuantity) {
        logger.warn('风控', `预估数量${estimatedQuantity.toFixed(4)}小于最小名义价值要求，调整到最小数量`)
        // 调整到最小数量，但确保不超过最大可用金额
        finalUsdtAmount = Math.min(minQuantity * signal.price, maxUsdtAmount)
        
        // 重新计算数量
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        // 再次检查最小名义价值
        notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT，账户余额可能不足`)
        }

        logger.info('开仓', `仓位参数（已调整）`, {
          数量: quantity,
          杠杆: finalLeverage,
          入场价: signal.price,
          止损价: stopLoss,
          USDT金额: finalUsdtAmount,
          名义价值: notional,
          ...leverageCalculationDetails,
        })
      } else {
        // 计算实际下单数量
        finalUsdtAmount = usdtAmount
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        // 检查最小名义价值
        notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
        }

        logger.info('开仓', `仓位参数`, {
          数量: quantity,
          杠杆: finalLeverage,
          入场价: signal.price,
          止损价: stopLoss,
          USDT金额: finalUsdtAmount,
          名义价值: notional,
          ...leverageCalculationDetails,
        })
      }

      // 市价开仓 (开仓操作，isEntry=true)
      const side = getOrderSide(signal.direction, true)
      const order = await this.binance.marketOrder(signal.symbol, side, quantity)

      logger.success('开仓', `开仓订单已提交`, order)

      // 二次确认持仓建立（关键优化）
      const positionConfirmed = await waitAndConfirmPosition(this.binance, signal.symbol)
      
      if (!positionConfirmed) {
        throw new Error('开仓后未检测到实际持仓，可能存在网络异常或订单未成交')
      }

      // 获取实际持仓信息
      const positions = await this.binance.fetchPositions(signal.symbol)
      const realPosition = positions.find(p => Math.abs(Number(p.quantity || 0)) > 0)
      
      if (!realPosition) {
        throw new Error('开仓后未检测到实际持仓')
      }

      // 使用实际持仓信息更新数量（防止部分成交）
      const actualQuantity = realPosition.quantity
      logger.info('持仓确认', `实际成交数量: ${actualQuantity} (下单数量: ${quantity})`)

      // 计算止盈价格（直接使用配置中的盈亏比）
      const takeProfit1 = calculateTakeProfit(signal.price, stopLoss, signal.direction, this.config.riskConfig.takeProfit.tp1RiskRewardRatio)
      const takeProfit2 = calculateTakeProfit(signal.price, stopLoss, signal.direction, this.config.riskConfig.takeProfit.tp2RiskRewardRatio)

      // 设置止损单 (平仓操作，isEntry=false)
      const stopSide = getOrderSide(signal.direction, false)
      const stopOrder = await this.binance.stopLossOrder(signal.symbol, stopSide, actualQuantity, stopLoss)

      logger.success('止损', `止损单已设置`, stopOrder)

      // 更新状态
      const position: Position = {
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.price,
        quantity: actualQuantity,
        leverage: finalLeverage,
        stopLoss,
        initialStopLoss: stopLoss,  // 保存初始止损价格
        takeProfit1,
        takeProfit2,
        openTime: Date.now(),
        // 初始化极值价格，用于追踪止损
        highestPrice: signal.price,  // 多头：初始最高价 = 入场价
        lowestPrice: signal.price,   // 空头：初始最低价 = 入场价
        orderId: order.orderId,
        stopLossOrderId: stopOrder.orderId,
        //添加一个止损订单symbol
        stopLossOrderSymbol: stopOrder.symbol,
        stopLossOrderSide: stopOrder.side,
        stopLossOrderType: stopOrder.type,
        stopLossOrderQuantity: stopOrder.quantity,
        stopLossOrderStopPrice: stopOrder.stopPrice,
        stopLossOrderStatus: stopOrder.status,
        stopLossOrderTimestamp: stopOrder.timestamp,
      }

      this.state.currentPosition = position
      this.state.status = PositionStatus.POSITION
      this.state.todayTrades += 1
      this.state.lastTradeTime = Date.now() // 更新上次交易时间（开仓时间）
      await saveBotState(this.state)

      // 通知上层初始化策略分析器，并传递入场指标和AI分析数据
      if (this.onPositionOpened) {
        try {
          // 注意：这里需要等待异步调用完成
          const result = this.onPositionOpened(position, entryIndicators, signal.aiAnalysis)
          if (result instanceof Promise) {
            await result
          }
        } catch (error: any) {
          logger.error('策略分析', `初始化策略分析器通知失败: ${error.message}`)
        }
      }

      logger.success('持仓', `持仓建立完成`, position)
    } catch (error: any) {
      logger.error('开仓', '开仓失败', error.message)
      this.state.status = PositionStatus.MONITORING
      await saveBotState(this.state)
      throw error
    }
  }

  /**
   * 手动开仓（跳过所有验证，直接使用现有开仓流程）
   */
  async manualOpenPosition(params: {
    symbol: string
    direction: 'LONG' | 'SHORT'
    orderType: 'MARKET' | 'LIMIT'
    price?: number
    amountType: 'USDT' | 'PERCENTAGE'
    amount: number
    leverage: number
  }): Promise<void> {
    try {
      logger.info('手动开仓', `准备手动开仓: ${params.symbol} ${params.direction}`)

      // 获取账户余额
      const account = await this.binance.fetchBalance()
      logger.info('账户', `余额: ${account.availableBalance} USDT`)

      // 检查账户余额是否足够
      if (account.availableBalance < 120) {
        throw new Error(`账户余额（${account.availableBalance} USDT）不足120 USDT，无法开仓`)
      }

      // 获取当前价格（用于市价订单）
      let entryPrice = params.price
      if (!entryPrice || params.orderType === 'MARKET') {
        entryPrice = await this.binance.fetchPrice(params.symbol)
        logger.info('价格', `当前价格: ${entryPrice}`)
      }

      // 计算实际USDT金额（应用杠杆，与openPosition保持一致）
      let usdtAmount = params.amount
      if (params.amountType === 'PERCENTAGE') {
        // 百分比计算：基于可用余额，并应用杠杆（与openPosition函数保持一致）
        const percentage = params.amount / 100
        usdtAmount = account.availableBalance * percentage * params.leverage
        logger.info('仓位计算', `百分比 ${params.amount}% × 杠杆 ${params.leverage}x = ${usdtAmount.toFixed(2)} USDT`)
      } else {
        // USDT金额模式：用户输入的是基础金额，需要应用杠杆
        usdtAmount = params.amount * params.leverage
        logger.info('仓位计算', `基础金额 ${params.amount} USDT × 杠杆 ${params.leverage}x = ${usdtAmount.toFixed(2)} USDT`)
      }

      // 检查最小名义价值
      const minQuantity = 20 / entryPrice
      const estimatedQuantity = usdtAmount / entryPrice
      
      if (estimatedQuantity < minQuantity) {
        throw new Error(`预估数量${estimatedQuantity.toFixed(4)}小于最小名义价值要求20 USDT，请增加仓位金额`)
      }

      // 获取指标缓存实例并获取真实指标数据
      const indicatorsCache = IndicatorsCache.getInstance(this.binance, this.config)
      let indicators: TechnicalIndicators
      try {
        indicators = await indicatorsCache.getIndicators(params.symbol)
        logger.info('指标缓存', `获取到 ${params.symbol} 的指标数据，ATR: ${indicators.atr.toFixed(4)}`)
      } catch (error: any) {
        // 如果获取缓存失败，使用默认指标
        logger.warn('指标缓存', `获取 ${params.symbol} 指标失败，使用默认值: ${error.message}`)
        indicators = {
          ema20: entryPrice,
          ema30: entryPrice,
          ema60: entryPrice,
          emaFastValues: [entryPrice],
          emaMediumValues: [entryPrice],
          emaSlowValues: [entryPrice],
          adx15m: 25,
          adx1h: 20,
          adx4h: 15,
          adxSlope: 0,
          rsi: 50,
          atr: entryPrice * 0.01, // 默认1% ATR
          openInterest: 0,
          openInterestChangePercent: 0,
          openInterestTrend: 'flat' as const
        }
      }

      // 创建TradeSignal对象（使用真实指标数据）
      const tradeSignal: TradeSignal = {
        symbol: params.symbol,
        direction: params.direction,
        price: entryPrice,
        confidence: 100, // 手动开仓置信度100%
        indicators: indicators,
        timestamp: Date.now(),
        reason: '手动开仓',
      }

      // 设置状态为开仓中
      this.state.status = PositionStatus.OPENING
      await saveBotState(this.state)

      // 设置杠杆和持仓模式
      await this.binance.setLeverage(params.symbol, params.leverage)
      await this.binance.setMarginMode(params.symbol, 'cross')
      
      try {
        await this.binance.setPositionMode(false) // false = 单向持仓模式
        logger.info('持仓模式', '已设置为单向持仓模式')
      } catch (error: any) {
        logger.warn('持仓模式', `设置持仓模式失败: ${error.message}`)
      }

      // 计算实际下单数量
      const quantity = await this.binance.calculateOrderAmount(
        params.symbol,
        usdtAmount,
        entryPrice
      )

      // 检查最小名义价值
      const notional = quantity * entryPrice
      if (notional < 20) {
        throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
      }

      logger.info('手动开仓', `仓位参数`, {
        数量: quantity,
        杠杆: params.leverage,
        入场价: entryPrice,
        USDT金额: usdtAmount,
        名义价值: notional,
      })

      let order
      if (params.orderType === 'MARKET') {
        // 市价开仓
        const side = params.direction === 'LONG' ? 'buy' : 'sell'
        order = await this.binance.marketOrder(params.symbol, side, quantity)
      } else {
        // 限价开仓
        const side = params.direction === 'LONG' ? 'buy' : 'sell'
        // 注意：这里需要添加限价订单支持，但当前binance.ts没有limitOrder方法
        // 暂时使用市价订单，后续可以扩展
        logger.warn('手动开仓', '限价订单暂不支持，使用市价订单替代')
        order = await this.binance.marketOrder(params.symbol, side, quantity)
      }

      logger.success('手动开仓', `开仓订单已提交`, order)

      // 二次确认持仓建立
      const positionConfirmed = await waitAndConfirmPosition(this.binance, params.symbol)
      
      if (!positionConfirmed) {
        throw new Error('开仓后未检测到实际持仓，可能存在网络异常或订单未成交')
      }

      // 获取实际持仓信息
      const positions = await this.binance.fetchPositions(params.symbol)
      const realPosition = positions.find(p => Math.abs(Number(p.quantity || 0)) > 0)
      
      if (!realPosition) {
        throw new Error('开仓后未检测到实际持仓')
      }

      // 使用实际持仓信息更新数量
      const actualQuantity = realPosition.quantity
      logger.info('持仓确认', `实际成交数量: ${actualQuantity} (下单数量: ${quantity})`)

      // 计算止损价格（使用默认ATR倍数）
      const stopLoss = calculateStopLoss(
        entryPrice,
        params.direction,
        indicators.atr,
        this.config.stopLossATRMultiplier,
        this.config.maxStopLossPercentage
      )

      // 计算止盈价格
      const takeProfit1 = calculateTakeProfit(
        entryPrice,
        stopLoss,
        params.direction,
        this.config.riskConfig.takeProfit.tp1RiskRewardRatio
      )
      const takeProfit2 = calculateTakeProfit(
        entryPrice,
        stopLoss,
        params.direction,
        this.config.riskConfig.takeProfit.tp2RiskRewardRatio
      )

      // 设置止损单
      const stopSide = params.direction === 'LONG' ? 'sell' : 'buy'
      const stopOrder = await this.binance.stopLossOrder(params.symbol, stopSide, actualQuantity, stopLoss)

      logger.success('止损', `止损单已设置`, stopOrder)

      // 更新状态
      const position: Position = {
        symbol: params.symbol,
        direction: params.direction,
        entryPrice: entryPrice,
        quantity: actualQuantity,
        leverage: params.leverage,
        stopLoss,
        initialStopLoss: stopLoss,
        takeProfit1,
        takeProfit2,
        openTime: Date.now(),
        highestPrice: entryPrice,
        lowestPrice: entryPrice,
        orderId: order.orderId,
        stopLossOrderId: stopOrder.orderId,
        stopLossOrderSymbol: stopOrder.symbol,
        stopLossOrderSide: stopOrder.side,
        stopLossOrderType: stopOrder.type,
        stopLossOrderQuantity: stopOrder.quantity,
        stopLossOrderStopPrice: stopOrder.stopPrice,
        stopLossOrderStatus: stopOrder.status,
        stopLossOrderTimestamp: stopOrder.timestamp,
      }

      this.state.currentPosition = position
      this.state.status = PositionStatus.POSITION
      this.state.todayTrades += 1
      this.state.lastTradeTime = Date.now()
      await saveBotState(this.state)

      // 通知上层初始化策略分析器
      if (this.onPositionOpened) {
        try {
          const result = this.onPositionOpened(position, tradeSignal.indicators)
          if (result instanceof Promise) {
            await result
          }
        } catch (error: any) {
          logger.error('策略分析', `初始化策略分析器通知失败: ${error.message}`)
        }
      }

      logger.success('手动开仓', `手动开仓完成`, position)
    } catch (error: any) {
      logger.error('手动开仓', '手动开仓失败', error.message)
      this.state.status = PositionStatus.MONITORING
      await saveBotState(this.state)
      throw error
    }
  }
}
