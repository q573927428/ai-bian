// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig } from '../../../types/strategy'
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig } from '../../../types'
import type { TradeSignal } from '../../../types/signal'
import { analyzeMarketWithAI as originalAnalyzeMarketWithAI } from '../../utils/ai-analysis'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'

/**
 * AI 分析缓存
 */
interface MultiStrategyAICache {
  signal: TradeSignal;
  timestamp: number;
}

const aiCache = new Map<string, MultiStrategyAICache>()
const AI_CACHE_TTL = 10 * 60 * 1000 // 10分钟

/**
 * 多策略 AI 分析器
 * 
 * 职责：
 * 1. 支持每个策略自定义的 AI 提示词
 * 2. 统一的 AI 调用接口
 * 3. 智能缓存（相同市场数据不重复调用）
 * 4. 降级处理（API 失败时返回安全默认值）
 */
export class MultiStrategyAIAnalyzer {
  private binance: BinanceService
  private config: BotConfig

  constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    logger.info('MultiStrategyAIAnalyzer', '多策略 AI 分析器已初始化')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
  }

  /**
   * 分析市场（支持多策略）
   */
  async analyze(
    strategyId: StrategyId,
    symbol: string,
    promptConfig: AIPromptConfig,
    indicators: TechnicalIndicators,
    price: number,
    volume: number = 0,
    priceChange24h: number = 0
  ): Promise<TradeSignal | null> {
    try {
      // 1. 检查缓存
      const cacheKey = this.buildCacheKey(strategyId, symbol, indicators, price)
      const cached = aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < AI_CACHE_TTL)) {
        logger.info('MultiStrategyAIAnalyzer', `使用 AI 缓存结果: ${symbol}`)
        return cached.signal
      }

      // 2. 构建完整提示词
      const fullPrompt = this.buildFullPrompt(
        promptConfig,
        symbol,
        price,
        indicators,
        volume,
        priceChange24h
      )

      // 3. 调用原有的 AI 分析函数
      const aiResult = await this.callAI(fullPrompt, symbol, price, indicators, volume, priceChange24h, strategyId)

      if (!aiResult || aiResult.direction === 'IDLE') {
        return null
      }

      // 4. 转换为标准交易信号
      const signal: TradeSignal = {
        strategyId,
        symbol,
        direction: aiResult.direction === 'LONG' ? 'long' : 'short',
        action: 'open',
        price,
        stopLoss: 0, // 后续计算
        confidence: aiResult.score,
        reasoning: aiResult.reasoning,
        indicators: {
          ema: {
            fast: aiResult.technicalData.ema20 ?? aiResult.technicalData[indicators.emaNames.fast] ?? 0,
            slow: aiResult.technicalData.ema60 ?? aiResult.technicalData[indicators.emaNames.slow] ?? 0
          },
          rsi: aiResult.technicalData.rsi,
          atr: indicators.atr
        },
        timestamp: new Date().toISOString()
      }

      // 5. 缓存结果
      aiCache.set(cacheKey, { signal, timestamp: Date.now() })

      return signal
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', `AI 分析失败: ${error.message}`)
      return null
    }
  }

  /**
   * 构建完整提示词
   */
  private buildFullPrompt(
    promptConfig: AIPromptConfig,
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number,
    priceChange24h: number
  ): string {
    return `
${promptConfig.systemPrompt}

## 当前市场数据
交易对: ${symbol}
价格: ${(price ?? 0).toFixed(4)}
24h 涨跌: ${(priceChange24h ?? 0).toFixed(2)}%
成交量: ${(volume ?? 0).toFixed(2)}
时间: ${new Date().toISOString()}

## 技术指标
- ${indicators.emaNames.fast}: ${(indicators.emaFast ?? 0).toFixed(4)}
- ${indicators.emaNames.medium}: ${(indicators.emaMedium ?? 0).toFixed(4)}
- ${indicators.emaNames.slow}: ${(indicators.emaSlow ?? 0).toFixed(4)}
- RSI(14): ${(indicators.rsi ?? 0).toFixed(2)}
- ATR(14): ${(indicators.atr ?? 0).toFixed(4)}
- ADX(${indicators.adxPeriodLabels.main}): ${(indicators.adxMain ?? 0).toFixed(2)}
- ADX(${indicators.adxPeriodLabels.secondary}): ${(indicators.adxSecondary ?? 0).toFixed(2)}
- ADX(${indicators.adxPeriodLabels.tertiary}): ${(indicators.adxTertiary ?? 0).toFixed(2)}
- OI: ${(indicators.openInterest ?? 0).toFixed(2)}
- OI 变化: ${(indicators.openInterestChangePercent ?? 0).toFixed(2)}%
- OI 趋势: ${indicators.openInterestTrend}

## 交易逻辑
${promptConfig.userPrompt}

请返回 JSON 格式的交易信号，格式如下：
{
  "direction": "LONG" | "SHORT" | "IDLE",
  "confidence": 0-100,
  "score": 0-100,
  "reasoning": "分析理由"
}
`
  }

  /**
   * 调用 AI API（复用原有逻辑）
   */
  private async callAI(
    prompt: string,
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number = 0,
    priceChange24h: number = 0,
    strategyId: StrategyId
  ): Promise<AIAnalysis | null> {
    try {
      // 使用原有的 analyzeMarketWithAI 函数
      // 注意：analyzeMarketWithAI 需要 9 个参数：
      // 1. symbol: string
      // 2. price: number
      // 3. ema20: number
      // 4. ema60: number
      // 5. rsi: number
      // 6. volume: number
      // 7. priceChange24h: number
      // 8. indicators?: TechnicalIndicators
      // 9. config?: BotConfig
      
      const result = await originalAnalyzeMarketWithAI(
        symbol,
        price,
        indicators.rsi,
        volume,
        priceChange24h,
        indicators,
        this.config,
        strategyId
      )

      return result
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', `AI API 调用失败: ${error.message}`)
      return null
    }
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(
    strategyId: StrategyId,
    symbol: string,
    indicators: TechnicalIndicators,
    price: number
  ): string {
    // 基于关键指标值构建唯一键
const indicatorHash = [
  (indicators.emaFast ?? 0).toFixed(2),
  (indicators.emaSlow ?? 0).toFixed(2),
  (indicators.rsi ?? 0).toFixed(2),
  (indicators.atr ?? 0).toFixed(2),
  (price ?? 0).toFixed(2)
].join('_')

    // 简化键（避免过长）
    const hash = Buffer.from(indicatorHash).toString('base64').substring(0, 32)
    return `${strategyId}_${symbol}_${hash}`
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    aiCache.clear()
    logger.info('MultiStrategyAIAnalyzer', 'AI 缓存已清理')
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache(): void {
    const now = Date.now()
    for (const [key, value] of aiCache) {
      if (now - value.timestamp >= AI_CACHE_TTL) {
        aiCache.delete(key)
      }
    }
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { size: number; ttl: number } {
    return {
      size: aiCache.size,
      ttl: AI_CACHE_TTL
    }
  }
}
