// ==================== 策略执行引擎 ====================

import type {
  Strategy,
  StrategyId,
  Timeframe,
  IndicatorType,
  StatisticsType
} from '../../../types/strategy'
import type { TradeSignal } from '../../../types/signal'
import type { OHLCV, BotConfig } from '../../../types'
import { StrategyStore } from '../strategy-store/StrategyStore'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { MultiStrategyAIAnalyzer } from '../ai-analyzer/MultiStrategyAIAnalyzer'
import { logger } from '../../utils/logger'

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

  constructor(
    store: StrategyStore,
    indicatorsHub: IndicatorsHub,
    positionManager: PositionManager,
    binance: BinanceService,
    config: BotConfig
  ) {
    this.store = store
    this.indicatorsHub = indicatorsHub
    this.positionManager = positionManager
    this.binance = binance
    
    // 初始化AI分析器
    this.aiAnalyzer = new MultiStrategyAIAnalyzer(binance, config)

    logger.info('StrategyEngine', '策略执行引擎已初始化')
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

    logger.info('StrategyEngine', `启动策略: ${strategy.name} (${strategyId})`)

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
    const scanInterval = instance.strategy.executionConfig.scanInterval * 1000 // 转为毫秒

    // 立即执行一次
    this.strategyLoop(instance)

    // 设置定时器
    instance.timer = setInterval(() => {
      this.strategyLoop(instance)
    }, scanInterval)

    logger.info('StrategyEngine', `策略循环已启动: ${instance.strategy.name}, 间隔 ${scanInterval / 1000}秒`)
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
   * 分析单个交易对
   */
  private async analyzeSymbol(instance: StrategyInstance, symbol: string): Promise<void> {
    const strategy = instance.strategy

    // 1. 检查是否已有仓位（同交易对互斥）
    if (await this.positionManager.hasConflict(symbol, strategy.id)) {
      logger.error('StrategyEngine', `跳过 ${symbol}，已有仓位`)
      return
    }

    // 2. 从指标中心获取数据（自动复用缓存）
    const indicatorsData = await this.indicatorsHub.getBatchIndicators(
      symbol,
      strategy.marketData.timeframes,
      [
        ...strategy.indicators.filter(i => i.enabled).map(i => i.type),
        ...strategy.statistics.filter(s => s.enabled).map(s => s.type)
      ]
    )

    // 3. 构建 AI 提示词并调用 AI 分析
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
      logger.warn('StrategyEngine', `策略 ${strategy.id} 的信号被忽略，交易对 ${symbol} 已有仓位`)
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
      const volumeData = indicatorsData.get('1h_Volume')?.values || {}
      
      const rsi = rsiData.rsi || 50
      const volume = volumeData.current || 0
      // 暂时使用默认涨跌幅，后续集成fetchTicker方法
      const priceChange24h = 0
      
      // 构造符合TechnicalIndicators格式的指标数据
      const adxData = indicatorsData.get(`${mainTimeframe}_ADX`)?.values || {}
      const indicators: any = {
        ...emaData,
        ...rsiData,
        ...adxData, // ADX数据已经包含adxMain、adxSecondary、adxTertiary三个周期的值
        atr: indicatorsData.get(`${mainTimeframe}_ATR`)?.values?.atr || 0,
        openInterest: indicatorsData.get('1h_OI')?.values?.value || 0,
        openInterestChangePercent: indicatorsData.get('1h_OI')?.values?.changePercent || 0,
        openInterestTrend: indicatorsData.get('1h_OI')?.values?.trend || 'flat',
        adxPeriodLabels: emaData.adxPeriodLabels || { main: mainTimeframe, secondary: '1h', tertiary: '4h' },
        emaNames: emaData.emaNames || { fast: 'EMA20', medium: 'EMA30', slow: 'EMA60' }
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
      logger.info(`${signal.strategyId}`, `[${strategyName}] ${signal.symbol} @${signal.price}  ${signal.direction} 置信度（${signal.confidence} < 70）`);
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

      // TODO: 调用现有的开仓逻辑
      // 这里需要集成 position-opener.ts 的功能
      // 暂时记录日志

      instance.lastSignalTime = new Date().toISOString()
      instance.totalTrades++

      // 记录仓位
      this.positionManager.recordPosition(signal.symbol, {
        symbol: signal.symbol,
        strategyId: strategy.id,
        direction: signal.direction,
        entryPrice: signal.price,
        quantity: 0, // 需要实际计算
        leverage: strategy.executionConfig.leverage === 'dynamic' ? 10 : strategy.executionConfig.leverage,
        openTime: Date.now()
      })

      logger.success('StrategyEngine', `信号执行完成: ${signal.symbol}`)
    } catch (error: any) {
      logger.error('StrategyEngine', `信号执行失败 ${signal.symbol}: ${error.message}`)

      // 释放锁
      this.positionManager.unlockSymbol(signal.symbol)

      instance.error = error.message
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
}
