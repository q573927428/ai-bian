// ==================== 策略执行引擎 ====================

import type { Strategy, StrategyId} from '../../../types/strategy'
import type { TradeSignal } from '../../../types/signal'
import type { BotConfig } from '../../../types'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { MultiStrategyAIAnalyzer } from '../ai-analyzer/MultiStrategyAIAnalyzer'
import { logger } from '../../utils/logger'
import { calculateStopLoss, calculateTakeProfit, calculatePositionSize, calculateMaxUsdtAmount } from '../../utils/indicators-risk'
import { getOrderSide } from '../../utils/trade-helpers'
import { StrategyPositionCloser } from './StrategyPositionCloser'
import { StrategyPositionMonitor } from './StrategyPositionMonitor'
import { waitAndConfirmPosition } from './helpers/position-helpers'
import type { BotState } from '../../../types'

/**
 * 策略运行时状态
 */
export interface StrategyRuntimeStatus {
  isRunning: boolean;
  lastScanTime?: string;
  lastSignalTime?: string;
  totalSignals: number;
  totalTrades: number;
  winRate: number;
  currentPositions: number;
  error?: string;
}

/**
 * 策略实例
 */
interface StrategyInstance {
  strategy: Strategy;
  isRunning: boolean;
  timer: NodeJS.Timeout | null;
  lastScanTime?: string;
  lastSignalTime?: string;
  totalSignals: number;
  totalTrades: number;
  winTrades: number;
  error?: string;
}

/**
 * 策略执行引擎
 *
 * 核心职责：
 * 1. 管理多个策略的并发执行
 * 2. 策略主循环（定时扫描市场）
 * 3. 调用 AI 分析（带缓存）
 * 4. 执行交易信号
 * 5. 与仓位管理器协作（同交易对互斥）
 */
export class StrategyEngine {
  // 运行中的策略实例
  private runningStrategies: Map<StrategyId, StrategyInstance> = new Map()

  // 依赖
  private store: StrategyStore
  private indicatorsHub: IndicatorsHub
  private positionManager: PositionManager
  private binance: BinanceService

  // AI 分析器
  private aiAnalyzer: MultiStrategyAIAnalyzer
  // AI 分析缓存: cacheKey -> {signal, timestamp}
  private aiCache: Map<string, { signal: TradeSignal; timestamp: number }> = new Map()
  private readonly AI_CACHE_TTL = 10 * 60 * 1000 // 10分钟

  // 持仓相关模块
  private positionCloser: StrategyPositionCloser
  private positionMonitor: StrategyPositionMonitor
  private state: BotState

  constructor(
    store: StrategyStore,
    indicatorsHub: IndicatorsHub,
    positionManager: PositionManager,
    binance: BinanceService,
    config: BotConfig,
    state: BotState
  ) {
    this.store = store
    this.indicatorsHub = indicatorsHub
    this.positionManager = positionManager
    this.binance = binance
    this.state = state
    
    // 初始化AI分析器
    this.aiAnalyzer = new MultiStrategyAIAnalyzer(binance, config)

    // 初始化持仓相关模块
    this.positionCloser = new StrategyPositionCloser(binance, positionManager, config, state)
    this.positionMonitor = new StrategyPositionMonitor(binance, positionManager, this.positionCloser, config, store)

    // 启动持仓监控
    this.positionMonitor.start()

    // logger.info('StrategyEngine', '策略执行引擎已初始化')
  }

  /**
   * 获取仓位管理器
   */
  getPositionManager(): PositionManager {
    return this.positionManager
  }

  /**
   * 获取Binance服务
   */
  getBinanceService(): BinanceService {
    return this.binance
  }

  // ==================== 策略生命周期 ====================

  /**
   * 启动策略
   */
  async startStrategy(strategyId: StrategyId): Promise<void> {
    // 检查是否已在运行
    if (this.runningStrategies.has(strategyId)) {
      logger.warn('StrategyEngine', `策略已在运行: ${strategyId}`)
      return
    }

    // 获取策略配置
    const strategy = await this.store.getStrategy(strategyId)
    if (!strategy) {
      logger.error('StrategyEngine', `策略不存在: ${strategyId}`)
      return
    }

    if (!strategy.isActive) {
      logger.warn('StrategyEngine', `策略未激活: ${strategyId}`)
      return
    }

    // logger.info('StrategyEngine', `启动策略: ${strategy.name} (${strategyId})`)

    // 创建策略实例
    const instance: StrategyInstance = {
      strategy,
      isRunning: true,
      timer: null,
      totalSignals: 0,
      totalTrades: 0,
      winTrades: 0
    }

    this.runningStrategies.set(strategyId, instance)

    // 启动策略循环
    this.startStrategyLoop(instance)

    logger.success('StrategyEngine', `策略已启动: ${strategy.name}`)
  }

  /**
   * 停止策略
   */
  async stopStrategy(strategyId: StrategyId): Promise<void> {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      logger.warn('StrategyEngine', `策略未运行: ${strategyId}`)
      return
    }

    logger.info('StrategyEngine', `停止策略: ${instance.strategy.name} (${strategyId})`)

    // 停止循环
    this.stopStrategyLoop(instance)

    // 移除实例
    this.runningStrategies.delete(strategyId)

    logger.success('StrategyEngine', `策略已停止: ${instance.strategy.name}`)
  }

  /**
   * 重启策略（用于配置更新后）
   */
  async restartStrategy(strategyId: StrategyId): Promise<void> {
    logger.info('StrategyEngine', `重启策略: ${strategyId}`)

    await this.stopStrategy(strategyId)
    await this.startStrategy(strategyId)
  }

  // ==================== 策略循环 ====================

  /**
   * 启动策略循环
   */
  private startStrategyLoop(instance: StrategyInstance): void {
    const MIN_INTERVAL = 300 // 最小间隔 300 秒
    
    let intervalSeconds = instance.strategy.executionConfig.scanInterval
    
    // 安全检查：如果间隔小于最小值或无效，使用安全值
    if (!intervalSeconds || intervalSeconds < MIN_INTERVAL) {
      intervalSeconds = MIN_INTERVAL
    }
    
    const scanInterval = intervalSeconds * 1000 // 转为毫秒

    // 立即执行一次
    this.strategyLoop(instance)

    // 设置定时器
    instance.timer = setInterval(() => {
      this.strategyLoop(instance)
    }, scanInterval)

    logger.info('StrategyEngine', `策略循环已启动: ${instance.strategy.name}, 间隔 ${intervalSeconds}秒`)
  }

  /**
   * 停止策略循环
   */
  private stopStrategyLoop(instance: StrategyInstance): void {
    if (instance.timer) {
      clearInterval(instance.timer)
      instance.timer = null
    }
    instance.isRunning = false
  }

  /**
   * 策略主循环
   */
  private async strategyLoop(instance: StrategyInstance): Promise<void> {
    try {
      const strategy = instance.strategy

      // 更新最后扫描时间
      instance.lastScanTime = new Date().toISOString()

      // 遍历所有监控的交易对
      for (const symbol of strategy.marketData.symbols) {
        try {
          await this.analyzeSymbol(instance, symbol)
        } catch (error: any) {
          logger.error('StrategyEngine', `分析交易对失败 ${symbol}: ${error.message}`)
        }
      }
    } catch (error: any) {
      instance.error = error.message
      logger.error('StrategyEngine', `策略循环异常: ${error.message}`)
    }
  }

  // ==================== 市场分析 ====================

  /**
   * 从策略配置中提取EMA周期
   */
  private getEMAPeriodsFromStrategy(strategy: any): number[] {
    const emaConfig = strategy.indicators.find((i: any) => i.type === 'EMA' && i.enabled)
    if (emaConfig?.params?.periods && Array.isArray(emaConfig.params.periods)) {
      const periods = emaConfig.params.periods
        .map((p: any) => Number(p))
        .filter((p: number) => Number.isFinite(p) && p >= 2)
        .map((p: number) => Math.floor(p))

      if (periods.length > 0) {
        return periods
      }
    }
    // 默认值
    return [14]
  }

  /**
   * 分析单个交易对
   */
  private async analyzeSymbol(instance: StrategyInstance, symbol: string): Promise<void> {
    const strategy = instance.strategy

    // 1. 检查是否已有仓位（同交易对互斥）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.info('扫描结果', ` ${symbol}，已有仓位`)
      return
    }

    // 2. 从指标中心获取基础数据
    const indicatorsData = await this.indicatorsHub.getBatchIndicators(
      symbol,
      strategy.marketData.timeframes,
      [
        ...strategy.indicators.filter(i => i.enabled && i.type !== 'EMA').map(i => i.type),
        ...strategy.statistics.filter(s => s.enabled).map(s => s.type)
      ]
    )

    // 3. 根据策略配置动态获取 EMA（由 IndicatorsHub 统一计算和缓存）
    const emaPeriods = this.getEMAPeriodsFromStrategy(strategy)
    const mainTimeframe = strategy.marketData.timeframes[0] || '15m'

    try {
      const emaData = await this.indicatorsHub.getEMAByPeriods(symbol, mainTimeframe, emaPeriods)
      const emaCacheKey = `${mainTimeframe}_EMA`
      indicatorsData.set(emaCacheKey, emaData)
    } catch (error: any) {
      logger.warn('StrategyEngine', `获取动态EMA失败 ${symbol} ${mainTimeframe}: ${error.message}`)
    }

    // 4. 构建 AI 提示词并调用 AI 分析
    const signal = await this.callAI(
      instance,
      strategy.id,
      symbol,
      strategy.aiPrompt,
      indicatorsData
    )

    if (!signal) {
      return
    }

    // 4. 验证信号
    if (!this.validateSignal(signal)) {
      return
    }

    // 5. 更新统计
    instance.totalSignals++

    // 6. 再次检查仓位冲突（防止并发问题）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.info('扫描结果', ` ${symbol} 已有仓位 [策略 ${strategy.id}] 信号被忽略 `)
      return
    }

    // 7. 执行交易
    await this.executeSignal(instance, signal)
  }

  /**
   * 调用 AI 分析（带缓存）
   */
  private async callAI(
    instance: StrategyInstance,
    strategyId: StrategyId,
    symbol: string,
    promptConfig: { systemPrompt: string; userPrompt: string; temperature: number; maxTokens: number; model: string },
    indicatorsData: Map<string, any>
  ): Promise<TradeSignal | null> {
    try {
      // 构建缓存键
      const cacheKey = this.buildAICacheKey(strategyId, symbol, indicatorsData)

      // 检查缓存
      const cached = this.aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.AI_CACHE_TTL)) {
        // logger.info('StrategyEngine', `使用 AI 缓存结果: ${symbol}`)
        return cached.signal
      }

      // 获取当前价格
      const price = await this.binance.fetchPrice(symbol)

      // 构建提示词
      const fullPrompt = this.buildAIPrompt(
        promptConfig,
        symbol,
        price,
        indicatorsData
      )

      // 调用 AI API（复用现有的 analyzeMarketWithAI 函数）
      // 从指标数据中提取所需参数（主时间框架取第一个配置的时间周期
      const mainTimeframe = instance.strategy.marketData.timeframes[0] || '15m'
      
      // 正确提取指标数据，匹配IndicatorsHub返回的key格式：${timeframe}_${type}
        const emaData = indicatorsData.get(`${mainTimeframe}_EMA`)?.values || {}
        const rsiData = indicatorsData.get(`${mainTimeframe}_RSI`)?.values || {}
        const macdData = indicatorsData.get(`${mainTimeframe}_MACD`)?.values || {}
        const volumeData = indicatorsData.get('1h_Volume')?.values || {}
        
        const rsi = rsiData.rsi || 50
        const volume = volumeData.current || 0
        // 暂时使用默认涨跌幅，后续集成fetchTicker方法
        const priceChange24h = 0
        
         // 构造符合TechnicalIndicators格式的指标数据
         // 获取三个周期的ADX数据（如果策略配置了多个周期）
         const timeframes = instance.strategy.marketData.timeframes || [mainTimeframe]
         
         // 从所有可用周期中获取ADX数据
         const adxMainData = indicatorsData.get(`${timeframes[0]}_ADX`)?.values || {}
         const adxSecondaryData = timeframes[1] ? indicatorsData.get(`${timeframes[1]}_ADX`)?.values : null
         const adxTertiaryData = timeframes[2] ? indicatorsData.get(`${timeframes[2]}_ADX`)?.values : null
         
         const indicators: any = {
           emaList: Array.isArray(emaData.emaList) ? emaData.emaList : [],
           emaMap: emaData.emaMap || {},
           ...rsiData,
           macd: macdData.macd !== undefined ? {
             macd: macdData.macd,
             signal: macdData.signal,
             histogram: macdData.histogram
           } : undefined,
           // 分别获取三个周期的ADX值
           adxMain: adxMainData.adxMain || 0,
           adxSecondary: adxSecondaryData?.adxMain || 0,
           adxTertiary: adxTertiaryData?.adxMain || 0,
           adxSlope: adxMainData.adxSlope || 0,
           atr: indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr || 0,
           openInterest: indicatorsData.get('1h_OI')?.values?.value || 0,
           openInterestChangePercent: indicatorsData.get('1h_OI')?.values?.changePercent || 0,
           openInterestTrend: indicatorsData.get('1h_OI')?.values?.trend || 'flat',
           adxPeriodLabels: { 
             main: timeframes[0] || mainTimeframe, 
             secondary: timeframes[1] || (timeframes.length >= 1 ? timeframes[0] : mainTimeframe), 
             tertiary: timeframes[2] || (timeframes.length >= 2 ? timeframes[1] : (timeframes.length >= 1 ? timeframes[0] : mainTimeframe)) 
          }
        }
      
      // 使用新的多策略AI分析器
      const signal = await this.aiAnalyzer.analyze(
        strategyId,
        symbol,
        promptConfig,
        indicators,
        price,
        volume,
        priceChange24h
      )

      if (!signal) {
        return null
      }
      
      // 补充止损价
      signal.stopLoss = this.calculateStopLoss(price, signal.direction)

      // 缓存结果
      this.aiCache.set(cacheKey, { signal, timestamp: Date.now() })

      return signal
    } catch (error: any) {
      logger.error('StrategyEngine', `AI 分析失败 ${symbol}: ${error.message}`)
      return null
    }
  }

  /**
   * 构建 AI 缓存键
   */
  private buildAICacheKey(
    strategyId: StrategyId,
    symbol: string,
    indicatorsData: Map<string, any>
  ): string {
    // 基于指标数据构建唯一键
    const dataHash = Array.from(indicatorsData.entries())
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
      .join('|')

    return `${strategyId}_${symbol}_${Buffer.from(dataHash).toString('base64').substring(0, 32)}`
  }

  /**
   * 构建 AI 提示词
   */
  private buildAIPrompt(
    promptConfig: { systemPrompt: string; userPrompt: string },
    symbol: string,
    price: number,
    indicatorsData: Map<string, any>
  ): string {
    return `
${promptConfig.systemPrompt}

## 当前市场数据
交易对: ${symbol}
价格: ${price}
时间: ${new Date().toISOString()}

## 技术指标
${this.formatIndicators(indicatorsData)}

## 交易逻辑
${promptConfig.userPrompt}

请返回 JSON 格式的交易信号。
`
  }

  /**
   * 格式化指标数据
   */
  private formatIndicators(indicatorsData: Map<string, any>): string {
    const lines: string[] = []

    for (const [key, value] of indicatorsData) {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    }

    return lines.join('\n')
  }

  /**
   * 计算止损价
   */
  private calculateStopLoss(price: number, direction: 'long' | 'short'): number {
    // 简化版本，实际应该基于 ATR 计算
    const stopLossPercent = 0.02 // 2% 止损
    if (direction === 'long') {
      return price * (1 - stopLossPercent)
    } else {
      return price * (1 + stopLossPercent)
    }
  }

  /**
   * 验证信号
   */
  private validateSignal(signal: TradeSignal): boolean {
    // 检查必填字段
    if (!signal.strategyId || !signal.symbol || !signal.direction || !signal.action) {
      logger.info('StrategyEngine', `[缺失字段] 策略ID=${signal.strategyId || '未知'} 交易对=${signal.symbol || '未知'} 方向=${signal.direction || '未知'} 操作=${signal.action || '未知'}`);
      return false
    }

    // 检查置信度
    if (signal.confidence < 70) {
      // 获取策略名称
      const strategyInstance = this.runningStrategies.get(signal.strategyId)
      const strategyName = strategyInstance ? strategyInstance.strategy.name : '未知策略'
      logger.info('扫描结果', ` ${signal.symbol} @${signal.price}  ${signal.direction} 置信度（${signal.confidence} < 70）[${strategyName} - ${signal.strategyId}]`);
      return false
    }

    return true
  }

  // ==================== 信号执行 ====================

  /**
   * 执行交易信号
   */
  private async executeSignal(instance: StrategyInstance, signal: TradeSignal): Promise<void> {
    try {
      const strategy = instance.strategy

      logger.info('StrategyEngine', `执行信号: ${signal.symbol} ${signal.direction} (${signal.reasoning})`)

      // 锁定交易对
      this.positionManager.lockSymbol(signal.symbol, strategy.id)

      // 1. 获取账户余额
      const account = await this.binance.fetchBalance()
      logger.info('账户', `余额: ${account.availableBalance} USDT`)

      // 余额检查
      if (account.availableBalance < 60) {
        logger.warn('开仓', `账户余额（${account.availableBalance} USDT）不足60 USDT，无法开仓`)
        return
      }

      // 2. 计算止损价格
      const stopLoss = calculateStopLoss(
        signal.price,
        signal.direction.toUpperCase() as 'LONG' | 'SHORT',
        signal.indicators.atr || (signal.price * 0.01), // 默认ATR为价格的1%
        strategy.riskManagement.stopLossATRMultiplier
      )

      // 3. 计算杠杆
      let finalLeverage = typeof strategy.executionConfig.leverage === 'number' ? strategy.executionConfig.leverage : 10
      let leverageCalculationDetails = {}

      // 暂时固定杠杆，动态杠杆功能后续实现
      logger.info('杠杆', `使用杠杆: ${finalLeverage} X`)

      // 4. 设置杠杆和持仓模式
      await this.binance.setLeverage(signal.symbol, finalLeverage)
      await this.binance.setMarginMode(signal.symbol, 'cross')
      
      try {
        await this.binance.setPositionMode(false) // 单向持仓模式
        logger.info('持仓模式', '已设置为单向持仓模式')
      } catch (error: any) {
        logger.warn('持仓模式', `设置持仓模式失败: ${error.message}`)
      }

      // 5. 计算仓位大小
      const riskAmount = calculatePositionSize(
        account.availableBalance,
        signal.price,
        stopLoss,
        strategy.riskManagement.maxRiskPercentage
      )

      const maxUsdtAmount = calculateMaxUsdtAmount(
        account.availableBalance,
        finalLeverage,
        strategy.riskManagement.maxRiskPercentage
      )

      const usdtAmount = Math.min(riskAmount, maxUsdtAmount)

      // 检查最小名义价值
      const minQuantity = 20 / signal.price
      const estimatedQuantity = usdtAmount / signal.price
      
      let quantity: number
      let finalUsdtAmount: number
      
      if (estimatedQuantity < minQuantity) {
        logger.warn('风控', `预估数量${estimatedQuantity.toFixed(4)}小于最小名义价值要求，调整到最小数量`)
        finalUsdtAmount = Math.min(minQuantity * signal.price, maxUsdtAmount)
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        const notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
        }
      } else {
        finalUsdtAmount = usdtAmount
        quantity = await this.binance.calculateOrderAmount(
          signal.symbol,
          finalUsdtAmount,
          signal.price
        )

        const notional = quantity * signal.price
        if (notional < 20) {
          throw new Error(`订单名义价值${notional.toFixed(2)} USDT小于交易所最小要求20 USDT`)
        }
      }

      logger.info('开仓', `仓位参数`, {
        数量: quantity,
        杠杆: finalLeverage,
        入场价: signal.price,
        止损价: stopLoss,
        USDT金额: finalUsdtAmount,
        ...leverageCalculationDetails,
      })

      // 6. 市价开仓
      const side = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', true)
      const order = await this.binance.marketOrder(signal.symbol, side, quantity)

      logger.success('开仓', `开仓订单已提交`, order)

      // 7. 确认持仓建立
      const realPosition = await waitAndConfirmPosition(this.binance, signal.symbol, 3, 500)
      
      if (!realPosition) {
        throw new Error('开仓后未检测到实际持仓')
      }

      const actualQuantity = realPosition.quantity
      logger.info('持仓确认', `实际成交数量: ${actualQuantity} (下单数量: ${quantity})`)

      // 8. 计算止盈价格
      const takeProfit1 = calculateTakeProfit(signal.price, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[0])
      const takeProfit2 = calculateTakeProfit(signal.price, stopLoss, signal.direction.toUpperCase() as 'LONG' | 'SHORT', strategy.riskManagement.takeProfitRatios[1])

      // 9. 设置止损单
      const stopSide = getOrderSide(signal.direction.toUpperCase() as 'LONG' | 'SHORT', false)
      const stopOrder = await this.binance.stopLossOrder(signal.symbol, stopSide, actualQuantity, stopLoss)

      logger.success('止损', `止损单已设置`, stopOrder)

      // 10. 记录仓位到PositionManager
      const position = {
        symbol: signal.symbol,
        strategyId: strategy.id,
        direction: signal.direction,
        entryPrice: signal.price,
        quantity: actualQuantity,
        leverage: finalLeverage,
        stopLoss,
        initialStopLoss: stopLoss,
        takeProfit1,
        takeProfit2,
        openTime: Date.now(),
        highestPrice: signal.price,
        lowestPrice: signal.price,
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

      this.positionManager.recordPosition(signal.symbol, position)

      instance.lastSignalTime = new Date().toISOString()
      instance.totalTrades++

      logger.success('StrategyEngine', `信号执行完成: ${signal.symbol}`)
    } catch (error: any) {
      logger.error('StrategyEngine', `信号执行失败 ${signal.symbol}: ${error.message}`)

      // 释放锁
      this.positionManager.unlockSymbol(signal.symbol)

      instance.error = error.message
      throw error
    }
  }

  // ==================== 状态查询 ====================

  /**
   * 获取策略运行时状态
   */
  getStrategyRuntimeStatus(strategyId: StrategyId): StrategyRuntimeStatus | null {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      return null
    }

    return {
      isRunning: instance.isRunning,
      lastScanTime: instance.lastScanTime,
      lastSignalTime: instance.lastSignalTime,
      totalSignals: instance.totalSignals,
      totalTrades: instance.totalTrades,
      winRate: instance.totalTrades > 0 ? (instance.winTrades / instance.totalTrades * 100) : 0,
      currentPositions: this.positionManager.getStrategyPositionCount(strategyId),
      error: instance.error
    }
  }

  /**
   * 获取所有运行中的策略
   */
  getRunningStrategies(): StrategyId[] {
    return Array.from(this.runningStrategies.keys())
  }

  /**
   * 检查策略是否在运行
   */
  isStrategyRunning(strategyId: StrategyId): boolean {
    return this.runningStrategies.has(strategyId)
  }

  // ==================== 测试接口 ====================

  /**
   * 测试策略信号（手动触发一次分析）
   */
  async analyzeSymbolForTest(strategyId: StrategyId, symbol: string): Promise<any> {
    const instance = this.runningStrategies.get(strategyId)
    if (!instance) {
      throw new Error(`策略未运行: ${strategyId}`)
    }

    logger.info('StrategyEngine', `手动触发分析: ${symbol}`)

    await this.analyzeSymbol(instance, symbol)

    return {
      message: `分析完成: ${symbol}`,
      timestamp: new Date().toISOString()
    }
  }

  // ==================== 清理 ====================

  /**
   * 停止所有策略
   */
  async stopAll(): Promise<void> {
    logger.info('StrategyEngine', '停止所有策略...')

    const strategyIds = Array.from(this.runningStrategies.keys())
    for (const strategyId of strategyIds) {
      await this.stopStrategy(strategyId)
    }

    // 清理 AI 缓存
    this.aiCache.clear()

    // 停止持仓监控
    this.positionMonitor.stop()

    logger.success('StrategyEngine', '所有策略已停止')
  }

  /**
   * 清理AI缓存
   */
  clearAICache(): void {
    this.aiCache.clear()
    logger.info('StrategyEngine', 'AI缓存已清理')
  }

  /**
   * 销毁引擎
   */
  async destroy(): Promise<void> {
    await this.stopAll()
    this.runningStrategies.clear()
    logger.info('StrategyEngine', '引擎已销毁')
  }

  /**
   * 获取平仓模块
   */
  getPositionCloser(): StrategyPositionCloser {
    return this.positionCloser
  }

  /**
   * 获取持仓监控模块
   */
  getPositionMonitor(): StrategyPositionMonitor {
    return this.positionMonitor
  }
}
