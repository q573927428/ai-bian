import type { TradeSignal, BotConfig, OHLCV, TechnicalIndicators, AIAnalysis, TradingSignal } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { checkADXTrend, checkEntry, checkVolatility, checkPriceActionSignal, checkEMACross } from '../../../utils/indicators'
import { analyzeMarketWithAI, checkAIAnalysisConditions } from '../../../utils/ai-analysis'
import { logger } from '../../../utils/logger'
import { IndicatorsCache } from '../services/indicators-cache'

/**
 * 市场分析器
 */
export class MarketAnalyzer {
  private binance: BinanceService
  private config: BotConfig
  private indicatorsCache: IndicatorsCache
  
  // 信号防抖跟踪
  private crossSignalTracker: Record<string, { timestamp: number; direction: 'LONG' | 'SHORT' }> = {}
  private paSignalTracker: Record<string, { timestamp: number; direction: 'LONG' | 'SHORT' }> = {}
  private readonly TRACKER_TTL = 24 * 60 * 60 * 1000 // 24小时过期

  constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    this.indicatorsCache = IndicatorsCache.getInstance(binance, config)
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
    this.indicatorsCache.updateConfig(config)
  }

  /**
   * 分析交易对（简化版流程）
   */
  async analyzeSymbol(symbol: string): Promise<TradeSignal | null> {
    try {
      // ====================== 1. 准备基础数据 ======================
      const mainTF = this.config.strategyMode === 'medium_term' ? '1h' : '15m'
      const mainCandlesCount = this.config.indicatorsConfig?.requiredCandles || 300
      
      // 并行获取数据
      const [price, mainCandles] = await Promise.all([
        this.binance.fetchPrice(symbol),
        this.binance.fetchOHLCV(symbol, mainTF, undefined, mainCandlesCount)
      ])
      
      if (mainCandles.length < 2) {
        this.logAnalysisResult(symbol, false, 'K线数据不足', price)
        return null
      }
      
      const indicators = await this.indicatorsCache.getIndicators(symbol, mainCandles)
      const lastCandle = mainCandles[mainCandles.length - 1]!
      const volumeHistory = mainCandles.map(c => c.volume)
      const formattedPrice = this.formatPrice(price)

      // ====================== 2. 基础条件校验 ======================
      // ADX趋势检查
      const adxResult = checkADXTrend(indicators, this.config)
      if (!adxResult.passed) {
        this.logAnalysisResult(symbol, false, `ADX不满足: ${adxResult.reason}`, price)
        return null
      }

      // 新增：ADX斜率判断
      if (indicators.adxSlope <= 0) {
        this.logAnalysisResult(symbol, false, `ADX斜率不满足: ${indicators.adxSlope.toFixed(2)} <= 0`, price)
        return null
      }
      
      // 波动率检查
      const volatilityResult = checkVolatility(price, indicators, this.config, symbol)
      if (!volatilityResult.passed) {
        this.logAnalysisResult(symbol, false, `波动率不满足: ${volatilityResult.reason}`, price)
        return null
      }

      // ====================== 3. 多信号并行检测 ======================
      // PA信号检测
      const paSignal = checkPriceActionSignal(mainCandles, this.config, price, indicators.ema20, indicators.ema60)
      const paKey = `${symbol}_${this.config.strategyMode}`
      let paTriggered = paSignal.triggered && paSignal.direction && !this.isSignalDebounced(paKey, lastCandle.timestamp, paSignal.direction, this.paSignalTracker)
      
      // EMA交叉检测
      const crossSignal = checkEMACross(indicators.emaFastValues, indicators.emaSlowValues, price, this.config)
      const crossKey = `${symbol}_${this.config.strategyMode}`
      let crossTriggered = crossSignal.triggered && crossSignal.direction && !this.isSignalDebounced(crossKey, lastCandle.timestamp, crossSignal.direction, this.crossSignalTracker)
      
      // AI分析（开启时执行）
      let aiSignal: TradingSignal = { type: 'AI', triggered: false, direction: null, reason: 'AI检测: 未启用' }
      let aiAnalysis: AIAnalysis | undefined = undefined
      
      if (this.config.aiConfig.enabled && this.config.aiConfig.useForEntry) {
        const candlesPer24h = mainTF === '1h' ? 24 : 96
        const oldCandle = mainCandles[Math.max(0, mainCandles.length - candlesPer24h)]!
        const priceChange24h = ((price - oldCandle.close) / oldCandle.close) * 100
        
        aiAnalysis = await analyzeMarketWithAI(symbol, price, indicators.ema20, indicators.ema60, indicators.rsi, lastCandle.volume, priceChange24h, indicators, this.config)
        aiSignal = checkAIAnalysisConditions(
          aiAnalysis, 
          this.config.aiConfig.minScore, 
          this.config.aiConfig.minConfidence, 
          this.config.aiConfig.maxRiskLevel,
          this.config.aiConfig.conditionMode
        )
      }
      
      const aiCheckReason = aiSignal.reason

      // ====================== 4. 确定最终信号方向 ======================
      let finalDirection: 'LONG' | 'SHORT' | null = null
      let finalReason = ''
      let finalScore = 60

      // 优先级: PA > EMA交叉 > AI > 通用入场检测
      if (paTriggered && paSignal.direction) {
        finalDirection = paSignal.direction
        finalReason = paSignal.reason
        finalScore = 100
        this.logAnalysisResult(symbol, true, `PA信号触发：${finalReason}`, price)
      } else if (crossTriggered && crossSignal.direction) {
        finalDirection = crossSignal.direction
        finalReason = crossSignal.reason
        finalScore = 100
        this.logAnalysisResult(symbol, true, `EMA交叉信号触发：${finalReason}`, price)
      } else if (aiSignal.triggered && aiSignal.direction) {
        finalDirection = aiSignal.direction
        finalReason = aiSignal.reason
        finalScore = aiSignal.data?.score || 80
        this.logAnalysisResult(symbol, true, `AI信号触发：${finalReason}`, price)
      } else {
        // 通用入场检测
        const entrySignal = checkEntry(price, indicators, lastCandle, this.config, volumeHistory, mainCandles)
        if (!entrySignal.triggered || !entrySignal.direction || (entrySignal.data?.score || 0) < 70) {
          const reason = entrySignal.reason + `；PA检测: ${paSignal.reason}；交叉检测: ${crossSignal.reason}；${aiCheckReason}`
          this.logAnalysisResult(symbol, false, reason, price)
          return null
        }
        finalDirection = entrySignal.direction
        finalReason = entrySignal.reason
        finalScore = entrySignal.data?.score || 70
      }

      // ====================== 5. 生成最终交易信号 ======================
      const signal: TradeSignal = {
        symbol,
        direction: finalDirection,
        price,
        confidence: aiAnalysis?.confidence || finalScore,
        indicators,
        aiAnalysis,
        timestamp: Date.now(),
        reason: finalReason
      }
      
      logger.success('分析通过', `${symbol} @${formattedPrice} ${finalReason}`)
      return signal

    } catch (error: any) {
      this.logAnalysisResult(symbol, false, `分析失败: ${error.message}`)
      logger.error('分析错误', `分析${symbol}失败`, error.message)
      return null
    }
  }

  /**
   * 格式化价格显示
   */
  private formatPrice(price: number): string {
    if (price >= 1) return price.toFixed(2)
    if (price >= 0.01) return price.toFixed(3)
    return price.toFixed(6)
  }

  /**
   * 信号防抖检查：同一根K线同方向信号仅触发一次（按交易对+策略模式隔离）
   */
  private isSignalDebounced(
    key: string,
    timestamp: number,
    direction: 'LONG' | 'SHORT',
    tracker: Record<string, { timestamp: number; direction: 'LONG' | 'SHORT' }>
  ): boolean {
    // 清理过期记录
    const entry = tracker[key]
    if (entry && Date.now() - entry.timestamp > this.TRACKER_TTL) {
      delete tracker[key]
    }
    
    // 检查是否已触发过
    if (entry && entry.timestamp === timestamp && entry.direction === direction) {
      return true
    }
    
    // 记录本次信号
    tracker[key] = { timestamp, direction }
    return false
  }

  /**
   * 记录分析结果
   */
  private logAnalysisResult(
    symbol: string,
    passed: boolean,
    summary: string,
    price?: number
  ): void {
    const priceStr = price ? ` @${this.formatPrice(price)}` : ''
    if (passed) {
      logger.success('分析结果', `${symbol}${priceStr} 分析通过，生成交易信号`)
    } else {
      logger.info('分析结果', `${symbol}${priceStr} 分析未通过: ${summary}`)
    }
  }
}