// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig, AIProvider } from '../../../types/strategy'
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig, Direction, ScoreBreakdown } from '../../../types'
import type { TradeSignal } from '../../../types/signal'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { strategyStore } from '../strategy-store/StrategyStore'
import { getProviderConfig, callAIAPI, extractJSONContent, type AIChatMessage } from '../../utils/ai-service'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { getAIAnalysisWriter } from '../../utils/jsonl-batch-writer'
import { getLatestAnalysis, formatAnalysisToPromptSection, checkDailyAnalysis } from '../../utils/trade-history-analyzer'
import { shortHash } from '../../utils/stable-hash'

/**
 * AI 分析缓存
 */
interface MultiStrategyAICache {
  signal: TradeSignal
  timestamp: number
}

interface StructuredRules {
  dsl?: string
}

const aiCache = new Map<string, MultiStrategyAICache>()

/**
 * 多策略 AI 分析器
 *
 * 职责：
 * 1. 支持每个策略自定义的 AI 提示词
 * 2. 统一的 AI 调用接口
 * 3. 智能缓存（相同市场数据不重复调用）
 * 4. 降级处理（API 失败时返回安全默认值）
 * 5. 并发控制和批量写入优化
 */
export class MultiStrategyAIAnalyzer {
  private binance: BinanceService
  private config: BotConfig
  private requestTimestamps: number[] = []
  private providerCooldownUntil: Map<string, number> = new Map()
  private stats = {
    totalRequests: 0,
    skippedByRateLimit: 0,
    timeoutCount: 0,
    errorCount: 0,
    cooldownCount: 0
  }

  constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    logger.info('MultiStrategyAIAnalyzer', '多策略 AI 分析器已初始化（含并发控制）')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
  }

  getStatus() {
    return {
      ...this.stats,
      recentRequestsInMinute: this.getRecentRequestCount(),
      providerCooldownUntil: Object.fromEntries(this.providerCooldownUntil.entries()),
      cache: this.getCacheStatus()
    }
  }

  private getRecentRequestCount(): number {
    const now = Date.now()
    this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 60000)
    return this.requestTimestamps.length
  }

  private canRequestAI(provider: string): boolean {
    const now = Date.now()
    const cooldownUntil = this.providerCooldownUntil.get(provider) || 0
    if (cooldownUntil > now) {
      this.stats.cooldownCount++
      return false
    }

    const maxRequestsPerMinute = Math.max(1, Number(this.config.aiRateLimit?.maxRequestsPerMinute ?? 20))
    if (this.getRecentRequestCount() >= maxRequestsPerMinute) {
      this.stats.skippedByRateLimit++
      return false
    }

    return true
  }

  private recordAIRequest(): void {
    this.requestTimestamps.push(Date.now())
    this.stats.totalRequests++
  }

  private recordAIError(provider: string, error: any): void {
    this.stats.errorCount++
    const message = String(error?.message || '')
    if (message.includes('abort') || message.includes('AbortError')) {
      this.stats.timeoutCount++
    }
    const cooldownMs = Math.max(10000, Number(this.config.aiRateLimit?.cooldownAfterErrorMs ?? 60000))
    this.providerCooldownUntil.set(provider, Date.now() + cooldownMs)
  }

  /**
   * 获取AI缓存TTL（毫秒），最小值为10分钟
   */
  private getAiCacheTtl(): number {
    const configuredMinutes = this.config.aiCacheTtlMinutes ?? 10
    const ttl = Math.max(configuredMinutes, 10) * 60 * 1000
    return ttl
  }

  /**
   * 规范化 scoreBreakdown，避免AI随意给分
   */
  private normalizeScoreBreakdown(raw: any): ScoreBreakdown {
    const toNumber = (value: any, fallback: number): number => {
      const n = Number(value)
      return Number.isFinite(n) ? Math.round(n) : fallback
    }

    const clamp = (value: number, min: number, max: number): number => {
      return Math.min(max, Math.max(min, value))
    }

    const baseScore = clamp(toNumber(raw?.baseScore, 0), 0, 30)
    const hardScore = clamp(toNumber(raw?.hardScore, 0), 0, 50)
    const softScore = clamp(toNumber(raw?.softScore, 0), 0, 20)
    const penaltyScore = clamp(toNumber(raw?.penaltyScore, 0), -10, 0)
    const finalScore = clamp(baseScore + hardScore + softScore + penaltyScore, 0, 100)

    return {
      baseScore,
      hardScore,
      softScore,
      penaltyScore,
      finalScore
    }
  }

  /**
   * 分析市场（支持多策略）
   */
  async analyze(
    strategyId: string,
    symbol: string,
    promptConfig: AIPromptConfig,
    indicators: any,
    price: number,
    volume: number,
    candleProgress: number = 0.1
  ): Promise<TradeSignal | null> {
    try {
      // 1. 获取策略规则并检查缓存
      const strategy = await strategyStore.getStrategy(strategyId)
      const structuredRules = (strategy as any)?.structuredRules as StructuredRules | undefined
      const cacheKey = this.buildCacheKey(strategyId, symbol, indicators, price, volume, candleProgress, promptConfig, structuredRules)
      const cached = aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
        logger.info('MultiStrategyAIAnalyzer', `AI缓存命中: ${symbol} [策略 ${strategyId}]`)
        return { ...cached.signal, strategyId }
      }

      // 2. 构建完整提示词

      const fullPrompt = this.buildFullPrompt(
        promptConfig,
        symbol,
        price,
        indicators,
        volume,
        candleProgress,
        structuredRules
      )

      // 3. 调用原有的 AI 分析函数
      const aiResult = await this.callAI(fullPrompt, symbol, price, indicators, volume, strategyId, promptConfig)


      // 即使是 IDLE 也返回完整信息，以便统一记录日志
      if (!aiResult) {
         return null
       }

      // 临时测试：针对不同策略和交易对强制返回信号
      // if (!aiResult) {
      //   return null
      // }
      // if (strategyId === 'strategy_001' && symbol === 'ETH/USDT') { 
      //   aiResult.direction = 'LONG'
      //   aiResult.confidence = 80 // 确保置信度足够
      // } else if (strategyId === 'strategy_002' && symbol === 'SOL/USDT') {
      //   aiResult.direction = 'LONG'
      //   aiResult.confidence = 80 // 确保置信度足够
      // } else {
      //   if (aiResult.direction === 'IDLE') {
      //     return null
      //   }
      // }

      // 4. 转换为标准交易信号（支持 IDLE 状态）
      const signal: TradeSignal = {
        strategyId,
        symbol,
        direction: aiResult.direction === 'LONG' ? 'long' : aiResult.direction === 'SHORT' ? 'short' : 'idle',
        action: aiResult.direction === 'IDLE' ? 'hold' : 'open',
        price,
        stopLoss: 0, // 后续计算
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        indicators: {
          ema: {
            fast: indicators.emaList[0]?.value ?? 0,
            slow: indicators.emaList[indicators.emaList.length - 1]?.value ?? 0
          },
          rsi: aiResult.technicalData.rsi ?? 0,
          atr: indicators.atr
        },
        timestamp: new Date().toISOString(),
        // 新增增强字段
        scoreBreakdown: aiResult.scoreBreakdown,
        riskLevel: aiResult.riskLevel
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
   * 计算K线实体大小
   */
  private calculateCandleBody(candle: any): number {
    if (!candle) return 0
    return Math.abs(candle.close - candle.open)
  }

  /**
   * 计算K线上下影线比例
   */
  private calculateCandleShadowRatios(candle: any): { upperShadowRatio: number; lowerShadowRatio: number } {
    if (!candle) return { upperShadowRatio: 0, lowerShadowRatio: 0 }
    const body = this.calculateCandleBody(candle)
    const totalRange = candle.high - candle.low
    if (totalRange === 0) return { upperShadowRatio: 0, lowerShadowRatio: 0 }
    const upperShadow = candle.high - Math.max(candle.open, candle.close)
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low
    return {
      upperShadowRatio: totalRange > 0 ? upperShadow / totalRange : 0,
      lowerShadowRatio: totalRange > 0 ? lowerShadow / totalRange : 0
    }
  }

  /**
   * 计算价格与EMA的偏离百分比
   */
  private calculatePriceDeviationFromEMA(price: number, emaValue: number): number {
    if (!emaValue || emaValue === 0) return 0
    return (price - emaValue) / emaValue;  //区分正负
    //return Math.abs(price - emaValue) / emaValue // 绝对值 不区分正负
  }

  /**
   * 计算价格在EMA区间内的位置比例 (0~1)
   * 用于策略02：价格在 [EMA60, EMA20] 区间内的位置
   */
  private calculatePricePositionInRange(price: number, lowerEMA: number, upperEMA: number): number {
    const min = Math.min(lowerEMA, upperEMA)
    const max = Math.max(lowerEMA, upperEMA)
    const range = max - min
    if (range === 0) return 0.5
    return (price - min) / range
  }

  /**
   * 准备提示词数据
   */
  private preparePromptData(
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number,
    candleProgress: number
  ) {
    // 技术指标行
    const technicalIndicatorLines: string[] = [];
    
    // EMA
    if (indicators.enabledIndicators?.ema && indicators.emaList.length > 0) {
      const sorted = [...indicators.emaList].sort(
        (a, b) => Number(a.name.replace(/\D/g, '')) - Number(b.name.replace(/\D/g, ''))
      )

      technicalIndicatorLines.push(
        ...sorted.map(e => {
          const slopeStr = e.slope !== undefined ? ` (斜率: ${(e.slope * 100).toFixed(2)}%)` : ''
          return `- ${e.name}: ${(e.value ?? 0).toFixed(4)}${slopeStr}`
        })
      )

      const compare = (a: number, b: number) => a > b ? '>' : a < b ? '<' : '='

      // EMA趋势
      if (sorted.length >= 2) {
        const first = sorted[0]!
        const last = sorted[sorted.length - 1]!

        technicalIndicatorLines.push(
          `- EMA趋势: ${first.name}(${(first.value ?? 0).toFixed(4)}) ${compare(first.value ?? 0, last.value ?? 0)} ${last.name}(${(last.value ?? 0).toFixed(4)})`
        )

        // EMA排列
        technicalIndicatorLines.push(
          `- EMA排列: ${sorted.map((e, i) =>
            i < sorted.length - 1
              ? `${e.name} ${compare(e.value ?? 0, sorted[i + 1]!.value ?? 0)}`
              : e.name
          ).join(' ')}`
        )
      }
    }

    // RSI
    if (indicators.enabledIndicators?.rsi && indicators.rsi !== undefined) {
      technicalIndicatorLines.push(`- RSI(14): ${indicators.rsi.toFixed(2)}`)
    }

    // MACD
    if (indicators.enabledIndicators?.macd && indicators.macd) {
      technicalIndicatorLines.push(`- MACD(12,26,9): MACD=${indicators.macd.macd.toFixed(4)}, Signal=${indicators.macd.signal.toFixed(4)}, Histogram=${indicators.macd.histogram.toFixed(4)}`)
    }

    // ATR
    if (indicators.enabledIndicators?.atr && indicators.atr !== undefined) {
      technicalIndicatorLines.push(`- ATR(14): ${indicators.atr.toFixed(4)}`)
      // ATR波动率百分比（ATR/价格）
      const atrPercent = price > 0 ? (indicators.atr / price * 100) : 0
      technicalIndicatorLines.push(`- ATR波动率: ${atrPercent.toFixed(2)}%`)
    }

    // ADX行
    const adxLines: string[] = []
    if (indicators.enabledIndicators?.adx) {
      if (indicators.adx !== undefined) {
        adxLines.push(`- ADX(${indicators.adxPeriodLabel}): ${indicators.adx.toFixed(2)}`)
      }
      if (indicators.adxSlope !== undefined) {
        adxLines.push(`- ADX斜率：${indicators.adxSlope.toFixed(4)}`)
      }
    }

    // OI行
    const oiLines: string[] = []
    if (indicators.enabledIndicators?.oi) {
      if (indicators.openInterest !== undefined) {
        oiLines.push(`- OI: ${indicators.openInterest.toFixed(2)}`)
      }
      if (indicators.openInterestChangePercent !== undefined) {
        oiLines.push(`- OI 变化: ${indicators.openInterestChangePercent.toFixed(2)}%`)
      }
      if (indicators.openInterestTrend) {
        oiLines.push(`- OI 趋势: ${indicators.openInterestTrend}`)
      }
    }

    // SquareHeat行
    const squareHeatLines: string[] = []
    if (indicators.enabledIndicators?.squareHeat) {
      const heat = indicators.squareHeat !== undefined ? `${indicators.squareHeat}` : '?'
      const change = indicators.squareHeatChangePercent !== undefined
        ? ` ${indicators.squareHeatChangePercent > 0 ? '+' : ''}${indicators.squareHeatChangePercent.toFixed(1)}%`
        : ''
      const trendLabel = indicators.squareHeatTrend === 'increasing' ? '📈增长' : indicators.squareHeatTrend === 'decreasing' ? '📉下降' : '➡️正常'

      // 涨跌比展示
      let sentimentStr = ''
      const bullishP = indicators.squareHeatBullishPercent
      const bearishP = indicators.squareHeatBearishPercent
      if (bullishP !== undefined && bearishP !== undefined) {
        const sentimentIcon = bullishP > bearishP ? '🟢' : bullishP < bearishP ? '🔴' : '⚪'
        sentimentStr = `；24H社区情绪${sentimentIcon}: 看涨${bullishP.toFixed(2)}% / 看跌${bearishP.toFixed(2)}%`
      }

      squareHeatLines.push(`- 币安广场热度(${heat})${change}：${trendLabel}${sentimentStr}`)
    }

    // 启用指标列表
    const enabledIndicatorsList: string[] = []
    if (indicators.enabledIndicators?.ema) enabledIndicatorsList.push('EMA')
    if (indicators.enabledIndicators?.rsi) enabledIndicatorsList.push('RSI')
    if (indicators.enabledIndicators?.macd) enabledIndicatorsList.push('MACD')
    if (indicators.enabledIndicators?.adx) enabledIndicatorsList.push('ADX')
    if (indicators.enabledIndicators?.atr) enabledIndicatorsList.push('ATR')
    if (indicators.enabledIndicators?.oi) enabledIndicatorsList.push('持仓量(OI)')
    if (indicators.enabledIndicators?.volume) enabledIndicatorsList.push('成交量')
    if (indicators.enabledIndicators?.squareHeat) enabledIndicatorsList.push('币安广场热度')

    // K线数据
    const formatCandle = (candle: any) => {
      if (!candle) return ''
      return `  开盘：${candle.open.toFixed(5)}
    最高：${candle.high.toFixed(5)}
    最低：${candle.low.toFixed(5)}
    收盘：${candle.close.toFixed(5)}
    成交量：${candle.volume.toFixed(2)}
    阴阳：${candle.close > candle.open ? '阳线' : '阴线'}`
    }

    // 使用 lastCandle.volume 来计算预计成交量，确保和 candleProgress 来自同一根K线
    const currentCandleVolume = indicators.lastCandle?.volume ?? volume
    const estimatedVolume = candleProgress > 0 ? (currentCandleVolume / candleProgress).toFixed(2) : currentCandleVolume.toFixed(2)

    // ========== 通用预计算数据（按策略启用指标条件输出） ==========

    // K线实体分析（策略01动量判断、策略02反转K线判断需要）
    const candleBodyLines: string[] = []
    if (indicators.lastCandle && indicators.prevCandle) {
      const lastCandleBody = this.calculateCandleBody(indicators.lastCandle)
      const prevCandleBody = this.calculateCandleBody(indicators.prevCandle)
      const candleBodyRatio = prevCandleBody > 0 ? (lastCandleBody / prevCandleBody) : 0
      const shadowRatios = this.calculateCandleShadowRatios(indicators.lastCandle)

      candleBodyLines.push(`- 最新K线实体: ${lastCandleBody.toFixed(5)}`)
      candleBodyLines.push(`- 前一根K线实体: ${prevCandleBody.toFixed(5)}`)
      candleBodyLines.push(`- K线实体比(当前/前一根): ${candleBodyRatio.toFixed(2)}倍`)
      candleBodyLines.push(`- 最新K线上影线比例: ${(shadowRatios.upperShadowRatio * 100).toFixed(1)}%`)
      candleBodyLines.push(`- 最新K线下影线比例: ${(shadowRatios.lowerShadowRatio * 100).toFixed(1)}%`)
    }

    // 价格与EMA偏离百分比（策略04金叉死叉判断需要）
    const emaDeviationLines: string[] = []
    if (indicators.enabledIndicators?.ema && indicators.emaList.length > 0) {
      for (const ema of indicators.emaList) {
        const deviation = this.calculatePriceDeviationFromEMA(price, ema.value ?? 0)
        emaDeviationLines.push(`- 价格偏离${ema.name}: ${(deviation * 100).toFixed(2)}%`)
      }
    }

    // 成交量对比（策略01/03成交量放大判断需要）
    const volumeCompareLines: string[] = []
    if (indicators.enabledIndicators?.volume) {
      if (indicators.volumeEmaAverage !== undefined && indicators.volumeEmaPeriod !== undefined) {
        const volumeEma = Number(indicators.volumeEmaAverage)
        if (volumeEma > 0) {
          const volumeRatio = Number(estimatedVolume) / volumeEma
          volumeCompareLines.push(`- 预计成交量/成交量EMA均值(${indicators.volumeEmaPeriod}周期): ${volumeRatio.toFixed(2)}倍`)
        }
        volumeCompareLines.push(`- 成交量EMA均值(${indicators.volumeEmaPeriod}周期): ${volumeEma.toFixed(2)}`)
      }
    }

    // 价格在EMA区间内的位置（策略02回调位置判断需要）
    const priceInRangeLines: string[] = []
    if (indicators.enabledIndicators?.ema && indicators.emaList.length >= 2) {
      const sorted = [...indicators.emaList].sort(
        (a, b) => Number(a.name.replace(/\D/g, '')) - Number(b.name.replace(/\D/g, ''))
      )
      const minEMA = sorted[0]!
      const maxEMA = sorted[sorted.length - 1]!
      const position = this.calculatePricePositionInRange(price, minEMA.value ?? 0, maxEMA.value ?? 0)
      priceInRangeLines.push(`- 价格在${minEMA.name}-${maxEMA.name}区间位置: ${(position * 100).toFixed(1)}%`)
    }

    return {
      symbol,
      price: (price ?? 0).toFixed(5),
      currentTime: new Date().toISOString(),
      candleProgressPercent: (candleProgress * 100).toFixed(1),
      currentVolume: indicators.enabledIndicators?.volume ? (currentCandleVolume ?? 0).toFixed(2) : '',
      estimatedVolume,
      lastCandle: indicators.lastCandle ? formatCandle(indicators.lastCandle) : '',
      prevCandle: indicators.prevCandle ? formatCandle(indicators.prevCandle) : '',
      technicalIndicatorLines,
      adxLines,
      oiLines,
      squareHeatLines,
      enabledIndicatorsList,
      // 通用预计算数据（按策略启用指标条件输出）
      candleBodyLines,
      emaDeviationLines,
      volumeCompareLines,
      priceInRangeLines
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
    candleProgress: number = 0.1,
    structuredRules?: StructuredRules
  ): string {
    const data = this.preparePromptData(symbol, price, indicators, volume, candleProgress)
    const structuredRulesDslText = (() => {
      const fromPrompt = (promptConfig as any)?.structuredRulesDsl
      if (typeof fromPrompt === 'string' && fromPrompt.trim()) {
        return fromPrompt.trim()
      }
      if (structuredRules?.dsl && typeof structuredRules.dsl === 'string') {
        return structuredRules.dsl.trim()
      }
      return ''
    })()

    //${structuredRulesDslText ? `${structuredRulesDslText}\n` : ''} 如果需要使用则加入到  ## 四、策略（唯一规则）里面
    
    return `
## 一、当前市场真实数据（仅使用以下数据）
交易对：${data.symbol}
当前价格：${data.price} USDT
当前时间：${data.currentTime}
K线完成进度：${data.candleProgressPercent}%
${data.currentVolume ? `当前成交量：${data.currentVolume}` : ''}
预计K线结束成交量：${data.estimatedVolume}（you must use this）

## 二、K线形态数据
${data.lastCandle ? `- 最新K线\n${data.lastCandle}` : ''}
${data.prevCandle ? `- 前一根K线\n${data.prevCandle}` : ''}
${data.candleBodyLines.length > 0 ? data.candleBodyLines.join('\n') : ''}

## 三、技术指标（仅启用的指标有效）
${data.technicalIndicatorLines.join('\n')}
${data.adxLines.length > 0 ? data.adxLines.join('\n') : ''}
${data.oiLines.length > 0 ? data.oiLines.join('\n') : ''}
${data.squareHeatLines.length > 0 ? data.squareHeatLines.join('\n') : ''}
${data.emaDeviationLines.length > 0 ? data.emaDeviationLines.join('\n') : ''}
${data.volumeCompareLines.length > 0 ? data.volumeCompareLines.join('\n') : ''}
${data.priceInRangeLines.length > 0 ? data.priceInRangeLines.join('\n') : ''}
${data.enabledIndicatorsList.length > 0 ? `本次分析仅使用：${data.enabledIndicatorsList.join(', ')}
未启用指标全部忽略` : ''}

--------------------------
## 四、策略（唯一规则）
${promptConfig.userPrompt}
--------------------------
## 输出（必须严格JSON）
{
  "direction": "LONG | SHORT | IDLE",
  "confidence": number,
  "reasoning": string,
  "scoreBreakdown": {
    "baseScore": number,
    "hardScore": number,
    "softScore": number,
    "penaltyScore": number,
    "finalScore": number
  },
  "riskLevel": "LOW | MEDIUM | HIGH"
}

### 输出字段说明：
- confidence: 开仓信心度（宏观）
- scoreBreakdown: 评分拆解，包含 baseScore/hardScore/softScore/penaltyScore/finalScore
- riskLevel: 风险等级，LOW/MEDIUM/HIGH

### scoreBreakdown 计算规则（必须严格遵守）
- baseScore：基础分，范围 0~30（按照趋势、强弱、变化趋势来给分）
- hardScore：硬条件得分，范围 0~50（按硬条件满足比例线性给分）
- softScore：软条件得分，范围 0~20（按软条件满足比例线性给分）
- penaltyScore：惩罚分，范围 -10~0（条件冲突、波动过大、趋势弱时扣分）
- finalScore：策略规则匹配度（微观），必须等于 baseScore + hardScore + softScore + penaltyScore（并限制在 0~100），仅反映策略条件满足程度
- 禁止输出不满足上述范围或不满足求和关系的值
`;
  }

  /**
   * 构建系统提示词（包含历史学习经验）
   * 从 trade-history-analysis.json 读取已保存的分析结果
   */
  private async buildSystemPrompt(hasSquareHeat: boolean = false): Promise<string> {
    // 异步触发每日分析检查（不阻塞主流程）
    checkDailyAnalysis().catch(() => {})

    // 读取开关配置：是否在系统提示词中包含历史分析经验，默认开启
    const enableHistorySection = this.config.aiAnalysisConfig?.enableHistorySection ?? true

    let historySection = ''
    if (enableHistorySection) {
      const historyAnalysis = await getLatestAnalysis()
      historySection = historyAnalysis ? formatAnalysisToPromptSection(historyAnalysis) : ''
    }

    // 根据 squareHeat 是否启用来决定 confidence 描述中是否包含币安广场热度相关字段
    const confidenceMacroFactors = hasSquareHeat
      ? '市场波动性、趋势强度、风险等级、币安广场热度、24H社区情绪'
      : '市场波动性、趋势强度、风险等级'

    // 根据 squareHeat 是否启用来决定 reasoning 格式示例中是否包含币安广场热度相关展示
    const squareHeatReasoningExample = hasSquareHeat
      ? '；币安广场热度(31) -3.2%：➡️正常；24H社区情绪🟢: 看涨77.78% / 看跌22.22%。'
      : ''

    return `
你是专业的量化交易策略执行引擎。
对当前市场数据进行客观分析、计算真实置信度。
${historySection}
【核心原则】
1. 你只做分析，不替用户做最终决策。
2. 先根据策略规则及所需数据确定唯一方向（LONG/SHORT），之后只按该方向执行交易判断：LONG只用做多规则，SHORT只用做空规则。
3. 所有条件必须逐条验证，带上真实数值。
4. 输出必须是合法JSON，无任何多余内容。
5. confidence 不代表是否开仓，而是是结合${confidenceMacroFactors}等宏观因素的开仓信心度（0-100）（宏观）
6. 禁止因为单个条件不满足直接输出 confidence=0。
7. scoreBreakdown.finalScore 为策略规则匹配度（0-100），仅反映策略条件满足程度（微观）。
8. scoreBreakdown 必须满足：baseScore∈[0,30]，hardScore∈[0,50]，softScore∈[0,20]，penaltyScore∈[-10,0]。
9. finalScore 必须严格等于 baseScore + hardScore + softScore + penaltyScore（再截断到0~100）。
10. riskLevel 综合市场波动性、趋势强度等给出风险等级。


----------------------------------
【输出格式】
{
  "direction": "LONG | SHORT | IDLE",
  "confidence": number,
  "reasoning": "一行中文，最多 350 个字符，包含所有条件的判断结果和数值",
  "scoreBreakdown": {
    "baseScore": number,
    "hardScore": number,
    "softScore": number,
    "penaltyScore": number,
    "finalScore": number
  },
  "riskLevel": "LOW | MEDIUM | HIGH"
}

【reasoning 要求】
- 必须包含：方向、关键指标数值、每条条件是否满足、风险等级
- 统一用✔️代表条件满足，❌代表不满足
- 格式示例：方向：LONG，EMA7(52100) > EMA50(51800)；置信度：60；风险等级:MEDIUM；RSI(48)∈[30,65] ✔️ ；OI增加+1.2% ✔️ ；预计成交量(5114.13) < 1.8倍 前K量(10464.66) ❌；ATR波动率 0.52% > 0.38% ✔️ ${squareHeatReasoningExample}
- 所有指标只展示原始数值与大小/区间对比结论，只写判定结果，不写运算逻辑和过程
- 格式清晰、无换行、无计算过程、不矛盾、精简直白
- 只输出当前 prompt 数据中实际包含的指标，未提供的指标不要提及
- 不得包含单引号、双引号、反引号或 Markdown
- 不能超过350字符

`;
  }

  /**
   * 获取AI分析保存配置（带默认值）
   */
  private getAiAnalysisSaveConfig() {
    const config = this.config.aiAnalysisConfig
    return {
      enabled: config?.enabled ?? true,
      maxRecords: config?.maxRecords ?? 1000,
      saveIdle: config?.saveIdle ?? false,
      minConfidence: config?.minConfidence ?? 50
    }
  }

  /**
   * 保存AI分析结果到JSONL文件（批量写入）
   */
  private async saveAIAnalysisToFile(analysis: AIAnalysis): Promise<void> {
    try {
      const saveConfig = this.getAiAnalysisSaveConfig()
      
      // 检查是否启用保存
      if (!saveConfig.enabled) {
        return
      }
      
      // 检查是否需要保存IDLE状态
      if (analysis.direction === 'IDLE' && !saveConfig.saveIdle) {
        return
      }
      
      // 检查置信度筛选
      if (analysis.confidence < saveConfig.minConfidence) {
        return
      }
      
      // 使用批量写入器
      await getAIAnalysisWriter().write(analysis)
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', '保存AI分析结果失败:', error.message)
    }
  }

  /**
   * 调用 AI API（支持多提供商和并发控制）
   */
  private async callAI(
    prompt: string,
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number = 0,
    strategyId: StrategyId,
    promptConfig?: AIPromptConfig
  ): Promise<AIAnalysis | null> {
    // 使用并发池控制AI调用并发数
    return concurrencyPoolManager.getAIPool().submit(async () => {
      try {
        const emaEntries = indicators.emaList
        const runtimeConfig = useRuntimeConfig()

        // 获取 AI 提供商配置（优先使用策略配置，否则使用默认配置）
        const provider = promptConfig?.provider || (runtimeConfig.aiProvider as AIProvider) || 'deepseek'
        if (!this.canRequestAI(provider)) {
          return null
        }
        this.recordAIRequest()
        // 传递策略自定义的 apiUrl/apiKey/model 覆盖默认值（用于 OpenAI 兼容自定义配置）
        const providerConfig = getProviderConfig(provider, runtimeConfig, {
          apiKey: promptConfig?.apiKey,
          apiUrl: promptConfig?.apiUrl,
          model: promptConfig?.model
        })
        
        // 构建系统提示词（根据 squareHeat 是否启用动态调整 confidence 宏观因素描述）
        const hasSquareHeat = !!(indicators.enabledIndicators?.squareHeat)
        const systemPrompt = await this.buildSystemPrompt(hasSquareHeat)
        
        const messages: AIChatMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]

        const content = await callAIAPI(providerConfig, messages, {
          temperature: promptConfig?.temperature ?? 0.5,
          maxTokens: promptConfig?.maxTokens ?? 1000,
          timeoutMs: this.config.aiRateLimit?.timeoutMs ?? 45000
        })

        // 提取JSON内容
        const jsonContent = extractJSONContent(content)
        const aiResult = JSON.parse(jsonContent)

        const direction = (aiResult.direction || 'IDLE') as Direction
        
        // 构建分析理由
        let reasoning = aiResult.reasoning || '无分析理由'
        
        // 验证防护：如果 reasoning 包含 IDLE 或 idle，只降低置信度
        let confidence = aiResult.confidence
        const hasIdleKeyword = reasoning.toLowerCase().includes('idle')
        if (hasIdleKeyword) {
          confidence = Math.min(confidence, 70)
        }
        
        const normalizedScoreBreakdown = this.normalizeScoreBreakdown(aiResult.scoreBreakdown)

        const analysis: AIAnalysis = {
          symbol,
          timestamp: Date.now(),
          strategyId,
          direction: direction,
          confidence: confidence,
          riskLevel: (aiResult.riskLevel || 'MEDIUM') as RiskLevel,
          isBullish: direction === 'LONG',
          reasoning: reasoning,
          scoreBreakdown: normalizedScoreBreakdown,
          technicalData: {
            price,
            ...Object.fromEntries(emaEntries.map(item => [item.name, item.value])),
            ...(indicators.emaMap || {}),
            rsi: indicators.rsi ?? 0,
            macd: indicators.macd?.macd,
            macdSignal: indicators.macd?.signal,
            macdHistogram: indicators.macd?.histogram,
            volume,
            openInterest: indicators.enabledIndicators?.oi ? indicators.openInterest : undefined,
            openInterestChangePercent: indicators.enabledIndicators?.oi ? indicators.openInterestChangePercent : undefined,
            openInterestTrend: indicators.enabledIndicators?.oi ? indicators.openInterestTrend : undefined,
            adx: indicators?.adx ?? 0,
            adxPeriodLabel: indicators?.adxPeriodLabel,
            adxSlope: indicators?.adxSlope,
            support: aiResult.support,
            resistance: aiResult.resistance,
          },
        }

        // 异步保存到文件，不阻塞主流程
        this.saveAIAnalysisToFile(analysis).catch(() => {})

        return analysis
      } catch (error: any) {
        const runtimeConfig = useRuntimeConfig()
        const provider = promptConfig?.provider || (runtimeConfig.aiProvider as AIProvider) || 'deepseek'
        this.recordAIError(provider, error)
        logger.error('MultiStrategyAIAnalyzer', `AI API 调用失败: ${error.message}`)
        
        // 返回默认分析结果（降级处理）
        const fallbackAnalysis: AIAnalysis = {
          symbol,
          timestamp: Date.now(),
          strategyId,
          direction: 'IDLE',
          confidence: 5,
          riskLevel: 'HIGH',
          isBullish: false,
          reasoning: `AI分析暂时不可用: ${error.message}`,
          technicalData: {
            price,
            ...Object.fromEntries(indicators.emaList.map(item => [item.name, item.value])),
            rsi: indicators.rsi ?? 0,
            volume,
          },
        }

        return fallbackAnalysis
      }
    })
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(
    strategyId: StrategyId,
    symbol: string,
    indicators: TechnicalIndicators,
    price: number,
    volume: number = 0,
    candleProgress: number = 0.1,
    promptConfig?: AIPromptConfig,
    structuredRules?: StructuredRules
  ): string {
    const hash = shortHash({
      symbol,
      indicators,
      price: Number(price.toFixed(2)),
      volume: Number(volume.toFixed(2)),
      candleProgress: Number(candleProgress.toFixed(4)),
      userPrompt: promptConfig?.userPrompt,
      provider: promptConfig?.provider,
      model: promptConfig?.model,
      temperature: promptConfig?.temperature,
      structuredRulesDsl: structuredRules?.dsl
    })
    return `ai:${symbol}:${hash}`
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
    const ttl = this.getAiCacheTtl()
    for (const [key, value] of aiCache) {
      if (now - value.timestamp >= ttl) {
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
      ttl: this.getAiCacheTtl()
    }
  }
}
