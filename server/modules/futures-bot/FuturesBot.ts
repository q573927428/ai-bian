import type { BotConfig, BotState, TradeHistory, TechnicalIndicators } from '../../../types'
import { PositionStatus } from '../../../types'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { saveBotState, getDefaultConfig, getDefaultState, getTradeHistory } from '../../utils/storage'
import { calculateTakeProfit } from '../../utils/indicators'
import { StateManager } from './core/state-manager'
import { MarketAnalyzer } from './core/analyzer'
import { MarketScanner } from './core/scanner'
import { PositionOpener } from './trading/position-opener'
import { PositionMonitor } from './trading/position-monitor'
import { PositionCloser } from './trading/position-closer'
import { PositionValidator } from './trading/position-validator'
import { PriceService } from './services/price-service'
import { IndicatorsCache } from './services/indicators-cache'
import { StrategyAnalyzer } from './helpers/strategy-analyzer'

/**
 * 币安永续合约交易机器人
 */
export class FuturesBot {
  private binance: BinanceService
  private priceService: PriceService
  private stateManager: StateManager
  private analyzer: MarketAnalyzer
  private scanner: MarketScanner
  private positionOpener: PositionOpener
  private positionMonitor: PositionMonitor
  private positionCloser: PositionCloser
  private positionValidator: PositionValidator
  private strategyAnalyzer: StrategyAnalyzer | null = null
  private isInitialized: boolean = false

  constructor() {
    const defaultConfig = getDefaultConfig()
    const defaultState = getDefaultState()
    
    this.binance = new BinanceService()
    this.priceService = new PriceService(this.binance)
    this.stateManager = new StateManager(defaultConfig, defaultState)
    this.analyzer = new MarketAnalyzer(this.binance, defaultConfig)
    
    // 初始化交易模块
    this.positionOpener = new PositionOpener(
      this.binance, 
      defaultConfig, 
      defaultState,
      async (position, entryIndicators, aiAnalysis) => await this.initializeStrategyAnalyzer(position, entryIndicators, aiAnalysis)
    )
    
    // 获取指标缓存单例
    const indicatorsCache = IndicatorsCache.getInstance(this.binance, defaultConfig)
    
    this.positionMonitor = new PositionMonitor(
      this.binance,
      this.priceService,
      indicatorsCache,
      defaultConfig,
      defaultState
    )
    this.positionCloser = new PositionCloser(this.binance, defaultConfig, defaultState)
    this.positionValidator = new PositionValidator(this.binance, defaultConfig, defaultState, () => this.strategyAnalyzer)
    
    // 初始化扫描器（传入回调函数）
    this.scanner = new MarketScanner(
      defaultConfig,
      defaultState,
      this.analyzer,
      {
        onResetDailyState: () => this.resetDailyState(),
        onPositionMonitor: () => this.monitorPosition(),
        onSignalFound: (signal) => this.positionOpener.openPosition(signal),
        onForceClose: () => this.closePositionIfExists('强制平仓时间')
      }
    )
  }

  /**
   * 初始化机器人
   */
  async initialize(): Promise<void> {
    // 如果已经初始化，直接返回
    if (this.isInitialized) {
      return
    }

    try {
      logger.info('系统', '正在初始化交易机器人...')

      // 初始化状态管理器
      await this.stateManager.initialize()
      
      // 同步状态到各个模块
      this.syncStateToModules()

      // 如果保存的状态显示机器人正在运行，但扫描循环未启动，需要手动启动
      const state = this.stateManager.getState()
      if (state.isRunning && (state.status === PositionStatus.MONITORING || state.status === PositionStatus.POSITION)) {
        logger.info('系统', '检测到机器人之前正在运行，自动恢复扫描循环')
        // 启动扫描循环以恢复运行
        this.scanner.startScanLoop()
      }

      // 恢复策略分析器数据（如果存在）
      await this.restoreStrategyAnalyzer()

      this.isInitialized = true
      logger.success('系统', '交易机器人初始化完成')
    } catch (error: any) {
      logger.error('系统', '初始化失败', error.message)
      throw error
    }
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    const state = this.stateManager.getState()
    
    if (state.isRunning && !state.circuitBreaker.isTriggered) {
      logger.warn('系统', '机器人已在运行中')
      return
    }

    // 情况2：机器人处于熔断状态
    if (state.circuitBreaker.isTriggered) {
      logger.info('系统', '机器人处于熔断状态，尝试重置并启动...')
    }

    try {
      logger.info('系统', '启动交易机器人...')

      // 重置熔断状态（如果处于熔断状态）
      if (state.circuitBreaker.isTriggered) {
        logger.info('熔断', '检测到熔断状态，正在重置...')
        state.circuitBreaker = {
          isTriggered: false,
          reason: '',
          timestamp: Date.now(),
          dailyLoss: 0,
          consecutiveLosses: 0,
        }
        logger.success('熔断', '熔断状态已重置')
      }

      state.isRunning = true
      state.status = PositionStatus.MONITORING
      state.monitoringSymbols = this.stateManager.getConfig().symbols
      
      // 更新状态
      this.stateManager.setState(state)
      await saveBotState(state)
      
      // 同步到各模块
      this.syncStateToModules()

      // 初始化WebSocket价格服务
      try {
        await this.priceService.initializeWebSocket(state.monitoringSymbols)
      } catch (error: any) {
        logger.warn('系统', 'WebSocket初始化失败，将使用REST API', error.message)
      }

      logger.success('系统', '交易机器人已启动')
      
      // 开始扫描循环
      this.scanner.startScanLoop()

    } catch (error: any) {
      logger.error('系统', '启动失败', error.message)
      state.isRunning = false
      this.stateManager.setState(state)
      await saveBotState(state)
      throw error
    }
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    logger.info('系统', '正在停止交易机器人...')
    
    const state = this.stateManager.getState()
    state.isRunning = false

    // 停止扫描循环
    this.scanner.stopScanLoop()

    // 断开WebSocket连接
    this.priceService.disconnect()

    state.status = PositionStatus.IDLE
    this.stateManager.setState(state)
    await saveBotState(state)
    
    // 同步到各模块
    this.syncStateToModules()

    logger.success('系统', '交易机器人已停止')
  }

  /**
   * 监控持仓
   */
  private async monitorPosition(): Promise<void> {
    const state = this.stateManager.getState()
    if (!state.currentPosition) return

    try {
      const position = state.currentPosition
      
      // 第一步：检查交易所实际持仓状态（新增容错机制）
      const isConsistent = await this.positionValidator.checkPositionConsistency(position)
      
      // 如果持仓不一致（已被平仓），直接返回
      if (!isConsistent) {
        // 同步验证器的状态回主状态
        const validatorState = this.positionValidator['state']
        this.stateManager.setState(validatorState)
        this.syncStateToModules()
        return
      }

      // 监控持仓（传入策略分析器）
      const result = await this.positionMonitor.monitorPosition(position, this.strategyAnalyzer || undefined)
      
      // 同步监控器的状态
      const monitorState = this.positionMonitor['state']
      this.stateManager.setState(monitorState)
      this.syncStateToModules()
      
      // 如果需要平仓
      if (result.shouldClose && result.reason) {
        await this.closePositionIfExists(result.reason)
      } else {
        // 更新ADX值到分析器
        const indicators = await this.binance.fetchPositions(position.symbol)
        // 这里简化处理，ADX更新在分析器的analyzeSymbol中完成
        
        // 定期保存策略分析器数据（每5分钟保存一次，减少IO操作）
        const now = Date.now()
        const state = this.stateManager.getState()
        const lastUpdateTime = state.strategyAnalyzerData?.lastUpdateTime || 0
        
        if (now - lastUpdateTime > 5 * 60 * 1000) { // 5分钟
          await this.saveStrategyAnalyzerData()
        }
      }
    } catch (error: any) {
      logger.error('持仓监控', '监控失败', error.message)
    }
  }

  /**
   * 初始化策略分析器（当开仓时调用）
   */
  async initializeStrategyAnalyzer(position: any, entryIndicators?: TechnicalIndicators, aiAnalysis?: any): Promise<void> {
    if (!position) return
    
    try {
      this.strategyAnalyzer = new StrategyAnalyzer(position)
      
      // 如果有入场指标，记录到策略分析器中
      if (entryIndicators) {
        const config = this.stateManager.getConfig()
        const strategyMode = config.strategyMode || 'short_term'
        this.strategyAnalyzer.recordEntryIndicators(entryIndicators, strategyMode)
      }
      
      // 如果有AI分析指标，记录到策略分析器中
      if (aiAnalysis) {
        this.strategyAnalyzer.recordAIAnalysis(aiAnalysis)
      }
      
      logger.info('策略分析', `策略分析器已初始化: ${position.symbol}`)
      
      // 立即保存策略分析器数据
      await this.saveStrategyAnalyzerData()
    } catch (error: any) {
      logger.error('策略分析', '初始化策略分析器失败', error.message)
      this.strategyAnalyzer = null
    }
  }

  /**
   * 记录出场指标
   */
  private async recordExitIndicators(position: any): Promise<void> {
    if (!this.strategyAnalyzer) return
    
    try {
      // 使用指标缓存服务获取出场指标
      const config = this.stateManager.getConfig()
      const indicatorsCache = IndicatorsCache.getInstance(this.binance, config)
      const exitIndicators = await indicatorsCache.getIndicators(position.symbol)
      
      // 记录出场指标到策略分析器
      this.strategyAnalyzer.recordExitIndicators(exitIndicators)
      const strategyMode = config.strategyMode || 'short_term'
      const adxValue = exitIndicators.adx15m  // 两种模式都使用ADX15m的值
      const adxLabel = strategyMode === 'short_term' ? 'ADX15m' : 'ADX1h'
      logger.info('策略分析', `出场指标已记录: ${position.symbol} RSI=${exitIndicators.rsi}, ${adxLabel}=${adxValue}`)
    } catch (error: any) {
      logger.error('策略分析', `记录出场指标失败: ${error.message}`)
    }
  }

  /**
   * 生成策略分析指标（当平仓时调用）
   */
  private async generateStrategyAnalysisMetrics(
    position: any,
    exitPrice: number,
    exitReason: string
  ): Promise<void> {
    if (!this.strategyAnalyzer) return
    
    try {
      const exitTime = Date.now()
      // 获取移动止损数据
      const trailingStopData = position.trailingStopData
      
      const metrics = await this.strategyAnalyzer.generateAnalysisMetrics(
        exitPrice,
        exitReason,
        exitTime,
        trailingStopData
      )
      
      logger.success('策略分析', `分析指标已生成: ${position.symbol} MFE=${metrics.mfe.toFixed(2)}, MAE=${metrics.mae.toFixed(2)}`)
      
      // 重置策略分析器
      this.strategyAnalyzer = null
      
      // 清理持久化数据
      await this.cleanupStrategyAnalyzerData()
    } catch (error: any) {
      logger.error('策略分析', '生成分析指标失败', error.message)
      this.strategyAnalyzer = null
      // 即使生成失败，也尝试清理数据
      await this.cleanupStrategyAnalyzerData()
    }
  }

  /**
   * 平仓（如果存在持仓）
   */
  private async closePositionIfExists(reason: string): Promise<void> {
    const state = this.stateManager.getState()
    if (!state.currentPosition) return

    const position = state.currentPosition
    
    // 获取平仓价格（这里需要从平仓器中获取实际平仓价格）
    // 在实际实现中，应该从positionCloser获取实际平仓价格
    const exitPrice = await this.getExitPrice(position, reason)
    
    // 在平仓前计算并记录出场指标
    await this.recordExitIndicators(position)
    
    // 生成策略分析指标
    await this.generateStrategyAnalysisMetrics(position, exitPrice, reason)
    
    // 执行平仓
    await this.positionCloser.closePosition(position, reason)
    
    // 同步平仓器的状态
    const closerState = this.positionCloser['state']
    this.stateManager.setState(closerState)
    this.syncStateToModules()
  }

  /**
   * 获取平仓价格（简化实现）
   */
  private async getExitPrice(position: any, reason: string): Promise<number> {
    try {
      // 尝试从价格服务获取当前价格
      const price = await this.priceService.getPrice(position.symbol)
      return price
    } catch (error: any) {
      logger.warn('策略分析', `获取平仓价格失败: ${error.message}，使用最后记录的价格`)
      
      // 如果有策略分析器，使用最后记录的价格
      if (this.strategyAnalyzer) {
        // 这里需要从策略分析器获取最后价格
        // 简化处理：返回入场价格
        return position.entryPrice
      }
      
      return position.entryPrice
    }
  }

  /**
   * 重置每日状态
   */
  private async resetDailyState(): Promise<void> {
    await this.stateManager.resetDailyState()
    this.syncStateToModules()
  }

  /**
   * 同步状态到所有模块
   */
  private syncStateToModules(): void {
    const config = this.stateManager.getConfig()
    const state = this.stateManager.getState()
    
    this.analyzer.updateConfig(config)
    this.scanner.updateConfig(config)
    this.scanner.updateState(state)
    this.positionOpener.updateConfig(config)
    this.positionOpener.updateState(state)
    this.positionMonitor.updateConfig(config)
    this.positionMonitor.updateState(state)
    this.positionCloser.updateConfig(config)
    this.positionCloser.updateState(state)
    this.positionValidator.updateConfig(config)
    this.positionValidator.updateState(state)
    
    // 更新指标缓存服务配置
    const indicatorsCache = IndicatorsCache.getInstance(this.binance, config)
    indicatorsCache.updateConfig(config)
  }

  /**
   * 更新配置
   */
  async updateConfig(newConfig: Partial<BotConfig>): Promise<void> {
    await this.stateManager.updateConfig(newConfig)
    
    // 如果当前有持仓，更新止盈价格
    const state = this.stateManager.getState()
    if (state.currentPosition) {
      const position = state.currentPosition
      const config = this.stateManager.getConfig()
      
      // 重新计算止盈价格
      const takeProfit1 = calculateTakeProfit(
        position.entryPrice,
        position.initialStopLoss,
        position.direction as 'LONG' | 'SHORT', // 类型断言：持仓方向只能是LONG或SHORT
        config.riskConfig.takeProfit.tp1RiskRewardRatio
      )
      
      const takeProfit2 = calculateTakeProfit(
        position.entryPrice,
        position.initialStopLoss,
        position.direction as 'LONG' | 'SHORT', // 类型断言：持仓方向只能是LONG或SHORT
        config.riskConfig.takeProfit.tp2RiskRewardRatio
      )
      
      // 更新position对象
      position.takeProfit1 = takeProfit1
      position.takeProfit2 = takeProfit2
      
      // 保存状态
      this.stateManager.setState(state)
      await saveBotState(state)
      
      logger.info('配置更新', `已更新持仓止盈价格: TP1=${takeProfit1.toFixed(2)}, TP2=${takeProfit2.toFixed(2)}`)
    }
    
    this.syncStateToModules()
  }

  /**
   * 获取当前配置
   */
  getConfig(): BotConfig {
    return this.stateManager.getConfig()
  }

  /**
   * 获取当前状态
   */
  getState(): BotState {
    return this.stateManager.getState()
  }

  /**
   * 获取交易历史
   */
  async getHistory(page: number = 1, pageSize: number = 10): Promise<{ data: TradeHistory[], total: number }> {
    const allHistory = await getTradeHistory()
    const total = allHistory.length
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize
    const data = allHistory.slice(startIndex, endIndex)
    
    return {
      data,
      total
    }
  }

  /**
   * 获取 Binance 服务实例
   */
  getBinanceService(): BinanceService {
    return this.binance
  }

  /**
   * 手动平仓（供外部API调用）
   * 使用内部的平仓逻辑，避免创建重复的PositionCloser实例
   */
  async manualClosePosition(reason: string = '手动平仓'): Promise<void> {
    const state = this.stateManager.getState()
    
    if (!state.currentPosition) {
      throw new Error('当前没有持仓')
    }

    await this.closePositionIfExists(reason)
  }

  /**
   * 手动开仓（供外部API调用）
   * @param params 手动开仓参数
   */
  async manualOpenPosition(params: {
    symbol: string
    direction: 'LONG' | 'SHORT'
    orderType: 'MARKET' | 'LIMIT'
    price?: number
    amountType: 'USDT' | 'PERCENTAGE'
    amount: number
    leverage: number
  }): Promise<{ success: boolean; message?: string; state?: BotState }> {
    try {
      const state = this.stateManager.getState()
      
      // 检查是否已有持仓
      if (state.currentPosition) {
        return {
          success: false,
          message: '已有持仓，请先平仓'
        }
      }

      // 检查机器人是否正在运行
      if (!state.isRunning) {
        return {
          success: false,
          message: '机器人未运行，请先启动机器人'
        }
      }

      // 调用PositionOpener的手动开仓方法
      await this.positionOpener.manualOpenPosition(params)
      
      // 获取更新后的状态
      const updatedState = this.stateManager.getState()
      
      return {
        success: true,
        message: '手动开仓成功',
        state: updatedState
      }
    } catch (error: any) {
      logger.error('手动开仓', '手动开仓失败', error.message)
      return {
        success: false,
        message: error.message || '手动开仓失败'
      }
    }
  }

  /**
   * 保存策略分析器数据到状态
   */
  private async saveStrategyAnalyzerData(): Promise<void> {
    if (!this.strategyAnalyzer) {
      // 如果没有策略分析器，清除状态中的相关数据
      const state = this.stateManager.getState()
      if (state.strategyAnalyzerData) {
        state.strategyAnalyzerData = undefined
        this.stateManager.setState(state)
        await saveBotState(state)
      }
      return
    }

    try {
      // 序列化策略分析器数据
      const strategyAnalyzerData = this.strategyAnalyzer.serialize()
      
      // 保存到状态中
      const state = this.stateManager.getState()
      state.strategyAnalyzerData = strategyAnalyzerData
      this.stateManager.setState(state)
      
      // 保存到文件
      await saveBotState(state)
      
    } catch (error: any) {
      logger.error('策略分析', '保存策略分析器数据失败', error.message)
    }
  }

  /**
   * 从状态恢复策略分析器数据
   */
  private async restoreStrategyAnalyzer(): Promise<void> {
    const state = this.stateManager.getState()
    
    // 如果没有持仓，不需要恢复策略分析器
    if (!state.currentPosition) {
      return
    }

    // 如果没有持久化的策略分析器数据，不需要恢复
    if (!state.strategyAnalyzerData) {
      return
    }

    try {
      // 检查持久化数据是否与当前持仓匹配
      const position = state.currentPosition
      const data = state.strategyAnalyzerData
      
      if (data.symbol !== position.symbol || data.direction !== position.direction) {
        logger.warn('策略分析', `持久化数据不匹配: 数据(${data.symbol}/${data.direction}) vs 持仓(${position.symbol}/${position.direction})`)
        return
      }

      // 从持久化数据恢复策略分析器
      this.strategyAnalyzer = StrategyAnalyzer.deserialize(data)
      
      logger.success('策略分析', `策略分析器已从持久化数据恢复: ${data.symbol}`)
    } catch (error: any) {
      logger.error('策略分析', '恢复策略分析器数据失败', error.message)
      this.strategyAnalyzer = null
    }
  }

  /**
   * 清理策略分析器数据
   */
  private async cleanupStrategyAnalyzerData(): Promise<void> {
    const state = this.stateManager.getState()
    if (state.strategyAnalyzerData) {
      state.strategyAnalyzerData = undefined
      this.stateManager.setState(state)
      await saveBotState(state)
      logger.info('策略分析', '策略分析器数据已清理')
    }
  }
}