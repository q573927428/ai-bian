import type { Position, TechnicalIndicators, StrategyAnalysisMetrics, AIAnalysis, TrailingStopData, StrategyMode, StrategyAnalyzerData } from '../../../../types'
import { calculatePnL } from '../../../utils/risk'
import { saveStrategyAnalysisMetrics } from '../../../utils/analysis-storage'
import { logger } from '../../../utils/logger'
import dayjs from 'dayjs'

/**
 * 策略分析器 - 用于记录和分析交易策略指标
 */
export class StrategyAnalyzer {
  private tradeId: string
  private symbol: string
  private direction: string
  private entryPrice: number
  private openTime: number
  private stopLossPrice: number
  private takeProfit1Price: number
  private takeProfit2Price: number
  private quantity: number
  private leverage: number
  
  // MFE/MAE跟踪
  private maxFavorableExcursion: number = 0
  private maxFavorableExcursionPercentage: number = 0
  private maxAdverseExcursion: number = 0
  private maxAdverseExcursionPercentage: number = 0
  
  // 当前价格
  private lastPrice: number = 0
  
  // 入场指标
  private entryIndicators: TechnicalIndicators | null = null
  
  // AI分析指标
  private aiAnalysis: AIAnalysis | null = null
  
  // 出场指标
  private exitIndicators: TechnicalIndicators | null = null
  
  // ATR增量计算（用于计算平均ATR，优化存储）
  private atrSum: number = 0
  private atrCount: number = 0
  
  // 最高价和最低价跟踪
  private highestPrice: number = 0
  private lowestPrice: number = 0

  constructor(position: Position) {
    this.tradeId = `${position.openTime}-${position.symbol.replace('/', '-')}`
    this.symbol = position.symbol
    this.direction = position.direction
    this.entryPrice = position.entryPrice
    this.openTime = position.openTime
    this.stopLossPrice = position.stopLoss
    this.takeProfit1Price = position.takeProfit1
    this.takeProfit2Price = position.takeProfit2
    this.quantity = position.quantity
    this.leverage = position.leverage
    
    // 初始化价格跟踪
    this.lastPrice = position.entryPrice
    this.highestPrice = position.entryPrice
    this.lowestPrice = position.entryPrice
    
    // 记录初始价格点
    this.recordPricePoint(position.entryPrice, position.openTime)
  }

  /**
   * 记录入场指标
   * @param indicators 技术指标
   * @param strategyMode 策略模式（short_term显示ADX15m，medium_term显示ADX1h，但都使用ADX15m的值）
   */
  recordEntryIndicators(indicators: TechnicalIndicators, strategyMode: StrategyMode = 'short_term'): void {
    this.entryIndicators = indicators
    // 记录ATR（增量计算）
    this.atrSum += indicators.atr
    this.atrCount++
    
    const adxValue = indicators.adx15m  // 两种模式都使用ADX15m的值
    const adxLabel = strategyMode === 'short_term' ? 'ADX15m' : 'ADX1h'
    logger.info('策略分析', `记录入场指标: ${this.symbol} RSI=${indicators.rsi}, ${adxLabel}=${adxValue}`)
  }

  /**
   * 记录AI分析指标
   */
  recordAIAnalysis(aiAnalysis: AIAnalysis): void {
    this.aiAnalysis = aiAnalysis
    
    logger.info('策略分析', `记录AI分析指标: ${this.symbol} 置信度=${aiAnalysis.confidence}, 评分=${aiAnalysis.score}, 风险等级=${aiAnalysis.riskLevel}`)
  }

  /**
   * 记录价格点并更新MFE/MAE
   */
  recordPricePoint(price: number, timestamp: number): void {
    this.lastPrice = price
    
    // 更新最高价和最低价
    if (price > this.highestPrice) {
      this.highestPrice = price
    }
    if (price < this.lowestPrice) {
      this.lowestPrice = price
    }
    
    // 计算当前盈亏
    const position = this.createPositionObject()
    const { pnl, pnlPercentage } = calculatePnL(price, position)
    
    // 更新MFE/MAE
    if (pnl > this.maxFavorableExcursion) {
      this.maxFavorableExcursion = pnl
      this.maxFavorableExcursionPercentage = pnlPercentage
    }
    
    if (pnl < this.maxAdverseExcursion) {
      this.maxAdverseExcursion = pnl
      this.maxAdverseExcursionPercentage = pnlPercentage
    }
  }

  /**
   * 记录ATR值（用于计算平均ATR，增量计算）
   */
  recordATR(atr: number): void {
    this.atrSum += atr
    this.atrCount++
  }

  /**
   * 记录出场指标
   */
  recordExitIndicators(indicators: TechnicalIndicators): void {
    this.exitIndicators = indicators
  }

  /**
   * 生成策略分析指标
   */
  async generateAnalysisMetrics(
    exitPrice: number,
    exitReason: string,
    exitTime: number,
    trailingStopData?: TrailingStopData
  ): Promise<StrategyAnalysisMetrics> {
    // 确保记录最终价格点
    this.recordPricePoint(exitPrice, exitTime)
    
    // 计算持仓时长
    const duration = exitTime - this.openTime
    
    // 计算风险金额
    const riskAmount = this.calculateRiskAmount()
    
    // 计算实际盈利金额
    const position = this.createPositionObject()
    const { pnl, pnlPercentage } = calculatePnL(exitPrice, position)
    const rewardAmount = pnl // 使用实际盈利金额（可以是负数）
    
    // 计算风险回报比
    // 如果盈利为正，风险回报比 = 盈利 / 风险
    // 如果盈利为负，风险回报比 = -1 * (亏损 / 风险)
    let riskRewardRatio = 0
    if (riskAmount > 0) {
      if (pnl >= 0) {
        riskRewardRatio = pnl / riskAmount
      } else {
        riskRewardRatio = -1 * (Math.abs(pnl) / riskAmount)
      }
    }
    
    // 计算价格波动范围百分比
    const priceRangePercentage = (this.highestPrice - this.lowestPrice) / this.entryPrice * 100
    
    // 计算最大回撤百分比
    const maxDrawdownPercentage = Math.abs(this.maxAdverseExcursionPercentage)
    
    // 计算平均ATR（使用增量计算）
    const averageATR = this.atrCount > 0 
      ? this.atrSum / this.atrCount
      : 0
    
    // 计算入场价格与EMA的偏离度
    const entryPriceToEMA20Deviation = this.entryIndicators 
      ? ((this.entryPrice - this.entryIndicators.ema20) / this.entryIndicators.ema20) * 100
      : 0
    
    const entryPriceToEMA60Deviation = this.entryIndicators 
      ? ((this.entryPrice - this.entryIndicators.ema60) / this.entryIndicators.ema60) * 100
      : 0
    
    // 确定退出原因分类
    const exitReasonCategory = this.categorizeExitReason(exitReason)
    
    // 提取时间特征
    const tradeDate = dayjs(this.openTime)
    const tradeHour = tradeDate.hour()
    const tradeDayOfWeek = tradeDate.day() // 0=周日, 1=周一, ..., 6=周六
    const tradeMonth = tradeDate.month() + 1 // 1-12
    
    // 计算仓位大小百分比（简化计算）
    const positionSizePercentage = this.calculatePositionSizePercentage()
    
    // 计算使用的保证金
    const marginUsed = this.calculateMarginUsed()
    
    // 构建分析指标对象
    const analysisMetrics: StrategyAnalysisMetrics = {
      // 基础信息
      tradeId: this.tradeId,
      symbol: this.symbol,
      direction: this.direction as any,
      
      // 时间信息
      openTime: this.openTime,
      closeTime: exitTime,
      duration,
      
      // 价格信息
      entryPrice: this.entryPrice,
      exitPrice,
      stopLossPrice: this.stopLossPrice,
      takeProfit1Price: this.takeProfit1Price,
      takeProfit2Price: this.takeProfit2Price,
      
      // MFE/MAE指标
      mfe: this.maxFavorableExcursion,
      mfePercentage: this.maxFavorableExcursionPercentage,
      mae: this.maxAdverseExcursion,
      maePercentage: this.maxAdverseExcursionPercentage,
      
      // 风险回报指标
      riskAmount,
      rewardAmount,
      riskRewardRatio,
      
      // 入场指标
      entryRSI: this.entryIndicators?.rsi || 0,
      entryADX15m: this.entryIndicators?.adx15m || 0,
      entryADX1h: this.entryIndicators?.adx1h || 0,
      entryADX4h: this.entryIndicators?.adx4h || 0,
      entryEMA20: this.entryIndicators?.ema20 || 0,
      entryEMA60: this.entryIndicators?.ema60 || 0,
      entryPriceToEMA20Deviation,
      entryPriceToEMA60Deviation,
      
      // AI分析指标
      aiConfidence: this.aiAnalysis?.confidence || 0,
      aiScore: this.aiAnalysis?.score || 0,
      aiRiskLevel: this.aiAnalysis?.riskLevel || 'MEDIUM',
      aiReasoning: this.aiAnalysis?.reasoning || '无AI分析数据',
      aiSupport: this.aiAnalysis?.technicalData.support,
      aiResistance: this.aiAnalysis?.technicalData.resistance,
      aiKeyFactors: this.extractKeyFactors(this.aiAnalysis?.reasoning),
      
      // 出场指标
      exitRSI: this.exitIndicators?.rsi || 0,
      exitADX15m: this.exitIndicators?.adx15m || 0,
      exitADX1h: this.exitIndicators?.adx1h || 0,
      exitADX4h: this.exitIndicators?.adx4h || 0,
      exitEMA20: this.exitIndicators?.ema20 || 0,
      exitEMA60: this.exitIndicators?.ema60 || 0,
      
      // 波动性指标
      averageATR,
      priceRangePercentage,
      maxDrawdownPercentage,
      
      // 资金管理指标
      positionSizePercentage,
      actualLeverage: this.leverage,
      marginUsed,
      
      // 交易结果
      pnl,
      pnlPercentage,
      exitReason,
      exitReasonCategory,
      
      // 时间特征
      tradeHour,
      tradeDayOfWeek,
      tradeMonth,
      
      // 移动止损指标
      trailingStopEnabled: trailingStopData?.enabled,
      trailingStopActivationRatio: trailingStopData?.activationRatio,
      trailingStopDistance: trailingStopData?.trailingDistance,
      trailingStopMinMovePercent: trailingStopData?.minMovePercent,
      lastTrailingStopPrice: trailingStopData?.lastTrailingStopPrice,
      lastTrailingStopUpdateTime: trailingStopData?.lastTrailingStopUpdateTime,
      trailingStopCount: trailingStopData?.trailingStopCount,
      
      // 创建时间
      createdAt: Date.now()
    }
    
    // 保存分析指标
    await saveStrategyAnalysisMetrics(analysisMetrics)
    
    logger.info('策略分析', `分析指标已生成: ${this.symbol} MFE=${this.maxFavorableExcursion.toFixed(2)}, MAE=${this.maxAdverseExcursion.toFixed(2)}`)
    
    return analysisMetrics
  }

  /**
   * 创建用于计算的仓位对象
   */
  private createPositionObject(): any {
    return {
      symbol: this.symbol,
      direction: this.direction,
      entryPrice: this.entryPrice,
      quantity: this.quantity,
      leverage: this.leverage,
      openTime: this.openTime
    }
  }

  /**
   * 计算风险金额
   */
  private calculateRiskAmount(): number {
    // 风险金额 = 初始止损对应的亏损金额
    const position = this.createPositionObject()
    const { pnl: stopLossPnL } = calculatePnL(this.stopLossPrice, position)
    return Math.abs(stopLossPnL)
  }

  /**
   * 计算仓位大小百分比
   */
  private calculatePositionSizePercentage(): number {
    // 简化计算：仓位价值 / 假设的总资金
    // 实际项目中应该从账户信息获取总资金
    const positionValue = this.entryPrice * this.quantity
    const assumedTotalCapital = 10000 // 假设总资金为10000 USDT
    return (positionValue / assumedTotalCapital) * 100
  }

  /**
   * 计算使用的保证金
   */
  private calculateMarginUsed(): number {
    // 保证金 = 仓位价值 / 杠杆倍数
    const positionValue = this.entryPrice * this.quantity
    return positionValue / this.leverage
  }

  /**
   * 分类退出原因
   */
  private categorizeExitReason(reason: string): 'TP1' | 'TP2' | 'STOP_LOSS' | 'TIMEOUT' | 'FORCE_LIQUIDATE' | 'TRAILING_STOP' | 'MANUAL_CLOSE' | 'OTHER' {
    const lowerReason = reason.toLowerCase()
    
    if (lowerReason.includes('tp1') || lowerReason.includes('止盈1')) {
      return 'TP1'
    } else if (lowerReason.includes('tp2') || lowerReason.includes('止盈2')) {
      return 'TP2'
    } else if (lowerReason.includes('移动止损') || lowerReason.includes('trailing stop')) {
      return 'TRAILING_STOP'
    } else if (lowerReason.includes('止损') || lowerReason.includes('stop loss') || lowerReason.includes('初始止损')) {
      // 注意：这个判断要放在移动止损之后，因为移动止损也包含"止损"二字
      return 'STOP_LOSS'
    } else if (lowerReason.includes('超时') || lowerReason.includes('timeout')) {
      return 'TIMEOUT'
    } else if (lowerReason.includes('强制平仓') || lowerReason.includes('force liquidate')) {
      return 'FORCE_LIQUIDATE'
    } else if (lowerReason.includes('手动平仓') || lowerReason.includes('manual close')) {
      return 'MANUAL_CLOSE'
    } else {
      return 'OTHER'
    }
  }

  /**
   * 从AI分析理由中提取关键因素
   */
  private extractKeyFactors(reasoning?: string): string[] {
    if (!reasoning) return []
    
    const keyFactors: string[] = []
    
    // 常见的关键因素模式
    const patterns = [
      { regex: /趋势强度.*?(强|弱)/, prefix: '趋势强度: ' },
      { regex: /ADX.*?(\d+)/, prefix: 'ADX趋势: ' },
      { regex: /RSI.*?(\d+)/, prefix: 'RSI: ' },
      { regex: /EMA.*?(排列|交叉)/, prefix: 'EMA: ' },
      { regex: /支撑.*?(\d+\.?\d*)/, prefix: '支撑位: ' },
      { regex: /阻力.*?(\d+\.?\d*)/, prefix: '阻力位: ' },
      { regex: /波动性.*?(高|低)/, prefix: '波动性: ' },
      { regex: /成交量.*?(放大|缩小)/, prefix: '成交量: ' },
      { regex: /风险.*?(高|中|低)/, prefix: '风险等级: ' },
      { regex: /置信度.*?(\d+)/, prefix: '置信度: ' }
    ]
    
    for (const pattern of patterns) {
      const match = reasoning.match(pattern.regex)
      if (match) {
        keyFactors.push(pattern.prefix + match[1])
      }
    }
    
    // 如果没找到模式匹配，尝试提取关键句子
    if (keyFactors.length === 0) {
      const sentences = reasoning.split(/[。！？\.\!\?]/).filter(s => s.trim().length > 10)
      keyFactors.push(...sentences.slice(0, 3))
    }
    
    return keyFactors.slice(0, 5) // 最多返回5个关键因素
  }

  /**
   * 获取当前MFE/MAE
   */
  getCurrentMetrics() {
    return {
      mfe: this.maxFavorableExcursion,
      mfePercentage: this.maxFavorableExcursionPercentage,
      mae: this.maxAdverseExcursion,
      maePercentage: this.maxAdverseExcursionPercentage,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      priceRangePercentage: (this.highestPrice - this.lowestPrice) / this.entryPrice * 100
    }
  }

  /**
   * 序列化为持久化数据
   */
  serialize(): StrategyAnalyzerData {
    return {
      tradeId: this.tradeId,
      symbol: this.symbol,
      direction: this.direction as any,
      entryPrice: this.entryPrice,
      openTime: this.openTime,
      stopLossPrice: this.stopLossPrice,
      takeProfit1Price: this.takeProfit1Price,
      takeProfit2Price: this.takeProfit2Price,
      quantity: this.quantity,
      leverage: this.leverage,
      
      // MFE/MAE跟踪
      maxFavorableExcursion: this.maxFavorableExcursion,
      maxFavorableExcursionPercentage: this.maxFavorableExcursionPercentage,
      maxAdverseExcursion: this.maxAdverseExcursion,
      maxAdverseExcursionPercentage: this.maxAdverseExcursionPercentage,
      
      // 最高价和最低价跟踪
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      lastPrice: this.lastPrice,
      
      // 入场指标
      entryIndicators: this.entryIndicators ? {
        rsi: this.entryIndicators.rsi,
        adx15m: this.entryIndicators.adx15m,
        adx1h: this.entryIndicators.adx1h,
        adx4h: this.entryIndicators.adx4h,
        ema20: this.entryIndicators.ema20,
        ema30: this.entryIndicators.ema30,
        ema60: this.entryIndicators.ema60,
        emaFastValues: this.entryIndicators.emaFastValues,
        emaMediumValues: this.entryIndicators.emaMediumValues,
        emaSlowValues: this.entryIndicators.emaSlowValues,
        atr: this.entryIndicators.atr,
        adxSlope: this.entryIndicators.adxSlope,
        openInterest: this.entryIndicators.openInterest,
        openInterestChangePercent: this.entryIndicators.openInterestChangePercent,
        openInterestTrend: this.entryIndicators.openInterestTrend
       } : undefined,
      
      // AI分析指标
      aiAnalysis: this.aiAnalysis ? {
        confidence: this.aiAnalysis.confidence,
        score: this.aiAnalysis.score,
        riskLevel: this.aiAnalysis.riskLevel,
        reasoning: this.aiAnalysis.reasoning,
        support: this.aiAnalysis.technicalData.support,
        resistance: this.aiAnalysis.technicalData.resistance
      } : undefined,
      
      // ATR增量计算数据
      atrSum: this.atrSum,
      atrCount: this.atrCount,
      
      // 更新时间
      lastUpdateTime: Date.now()
    }
  }

  /**
   * 从持久化数据恢复
   */
  static deserialize(data: StrategyAnalyzerData): StrategyAnalyzer {
    // 创建基础仓位对象
    const position: Position = {
      symbol: data.symbol,
      direction: data.direction,
      entryPrice: data.entryPrice,
      quantity: data.quantity,
      leverage: data.leverage,
      stopLoss: data.stopLossPrice,
      initialStopLoss: data.stopLossPrice,
      takeProfit1: data.takeProfit1Price,
      takeProfit2: data.takeProfit2Price,
      openTime: data.openTime
    }
    
    // 创建策略分析器实例
    const analyzer = new StrategyAnalyzer(position)
    
    // 恢复MFE/MAE数据
    analyzer.maxFavorableExcursion = data.maxFavorableExcursion
    analyzer.maxFavorableExcursionPercentage = data.maxFavorableExcursionPercentage
    analyzer.maxAdverseExcursion = data.maxAdverseExcursion
    analyzer.maxAdverseExcursionPercentage = data.maxAdverseExcursionPercentage
    
    // 恢复价格跟踪数据
    analyzer.highestPrice = data.highestPrice
    analyzer.lowestPrice = data.lowestPrice
    analyzer.lastPrice = data.lastPrice
    
    // 恢复ATR增量计算数据
    analyzer.atrSum = data.atrSum
    analyzer.atrCount = data.atrCount
    
    // 恢复入场指标（如果存在）
    if (data.entryIndicators) {
      analyzer.entryIndicators = {
        rsi: data.entryIndicators.rsi,
        adx15m: data.entryIndicators.adx15m,
        adx1h: data.entryIndicators.adx1h,
        adx4h: data.entryIndicators.adx4h,
        ema20: data.entryIndicators.ema20,
        ema30: data.entryIndicators.ema30,
        ema60: data.entryIndicators.ema60,
        emaFastValues: data.entryIndicators.emaFastValues,
        emaMediumValues: data.entryIndicators.emaMediumValues,
        emaSlowValues: data.entryIndicators.emaSlowValues,
        atr: data.entryIndicators.atr,
        adxSlope: data.entryIndicators.adxSlope,
        openInterest: data.entryIndicators.openInterest || 0,
        openInterestChangePercent: data.entryIndicators.openInterestChangePercent || 0,
        openInterestTrend: data.entryIndicators.openInterestTrend || 'flat'
       }
    }
    
    // 恢复AI分析指标（如果存在）
    if (data.aiAnalysis) {
      analyzer.aiAnalysis = {
        symbol: data.symbol,
        timestamp: data.lastUpdateTime,
        direction: data.direction,
        confidence: data.aiAnalysis.confidence,
        score: data.aiAnalysis.score,
        riskLevel: data.aiAnalysis.riskLevel,
        isBullish: data.direction === 'LONG',
        reasoning: data.aiAnalysis.reasoning,
        technicalData: {
          price: data.entryPrice,
          ema20: data.entryIndicators?.ema20 || 0,
          ema60: data.entryIndicators?.ema60 || 0,
          rsi: data.entryIndicators?.rsi || 0,
          volume: 0, // 这个字段在持久化数据中没有，设为0
          support: data.aiAnalysis.support,
          resistance: data.aiAnalysis.resistance
        }
      }
    }
    
    logger.info('策略分析', `策略分析器已从持久化数据恢复: ${data.symbol}`)
    
    return analyzer
  }
}
