// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig, AIProvider } from '../../../types/strategy'
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig, Direction, ScoreBreakdown, EntryCommunitySentiment } from '../../../types'
import type { TradeSignal } from '../../../types/signal'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import { strategyStore } from '../strategy-store/StrategyStore'
import { getProviderConfig, callAIAPI, extractJSONContent, type AIChatMessage } from '../../utils/ai-service'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { getAIAnalysisWriter } from '../../utils/jsonl-batch-writer'
import { getLatestAnalysis, formatAnalysisToPromptSection } from '../../utils/trade-history-analyzer'
import { shortHash } from '../../utils/stable-hash'
import { formatMarketBreadth } from '../../utils/market-breadth'
import type { PriceZone, SupportResistanceSnapshot } from '../../../types/support-resistance'
import type { IndicatorsHub } from '../indicators/IndicatorsHub'
import { formatEnvironmentConfidence, type EnvironmentContext } from '../../../app/utils/environment-confidence'
import { loadEnvironmentContext } from '../../utils/environment-context'
import { createStrategySnapshot, createQuantitativeSnapshot } from '../../utils/ai-analysis-snapshot'
import { getCandleVolume } from '../../utils/candle-volume'
import { aiPromptCache } from '../../utils/ai-prompt-cache'
import { saveAIRules } from '../../utils/ai-rules-store'
import { randomUUID } from 'node:crypto'
import type { TradeDecision } from '../../../types/trade-decision'

/** AI 只接收入场位置摘要；完整区域及时间信息仍由信号和交易记录保存。 */
function formatSupportResistance(snapshot?: SupportResistanceSnapshot): string {
  if (!snapshot) return ''
  const price = (value: number) => Number(value.toPrecision(7)).toString()
  const distance = (value: number | null) => value == null || !Number.isFinite(value) ? '未知' : value.toFixed(2)
  const zone = (value: PriceZone | null) => value
    ? `${price(value.lower)}～${price(value.upper)}（${value.touches}次触碰${value.touches === 1 ? '，候选待验证' : ''}）` : '未识别'
  const states: Record<SupportResistanceSnapshot['status'], string> = {
    insufficient_data: '数据不足', no_levels: '未识别到有效区域', between_levels: '区域之间',
    at_support: '位于支撑区', at_resistance: '位于阻力区',
    breakdown_pending: '价格跌破支撑，待收盘确认', breakout_pending: '价格突破阻力，待收盘确认',
    breakdown_confirmed: '区域更新时已收盘确认跌破', breakout_confirmed: '区域更新时已收盘确认突破'
  }
  return `### 支撑阻力（${snapshot.timeframe}）
- 最近支撑：${zone(snapshot.nearestSupport)}；距离 ${distance(snapshot.supportDistancePercent)}% / ${distance(snapshot.supportDistanceATR)} ATR
- 最近阻力：${zone(snapshot.nearestResistance)}；距离 ${distance(snapshot.resistanceDistancePercent)}% / ${distance(snapshot.resistanceDistanceATR)} ATR
- 状态：${states[snapshot.status]}
区域每5分钟更新，距离随价格更新；未识别不代表没有障碍，收盘突破不代表回踩确认。仅作位置参考，开仓按策略规则判断。
`
}

/**
 * AI 分析缓存
 */
interface MultiStrategyAICache {
  signal: TradeSignal
  timestamp: number
}

/** 策略的结构化规则正文。 */
interface StructuredRules {
  dsl?: string
}

/** 与看板使用同一口径，描述当前 H 的方向及相对上组的变化。 */
function getMacdTrendResult(macd: NonNullable<TechnicalIndicators['macd']>): string {
  if (!Number.isFinite(macd.histogram) || !Number.isFinite(macd.previousHistogram)) return '数据不足'
  const current = macd.histogram
  const previous = macd.previousHistogram
  if (current === 0) return '动能中性'
  if (current === previous) return current > 0 ? '多头持平' : '空头持平'
  const stronger = current > 0 ? current > previous : current < previous
  return `${current > 0 ? '多头' : '空头'}${stronger ? '增强' : '减弱'}`
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

  constructor(binance: BinanceService, config: BotConfig, private indicatorsHub?: IndicatorsHub) {
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
      const environmentContext = await loadEnvironmentContext(this.indicatorsHub, symbol, indicators.marketBreadth)
      // 环境版本与五周期变化都必须参与缓存，不能复用旧口径的置信度。
      const cacheKey = this.buildCacheKey(strategyId, symbol, { ...indicators, environmentContext }, price, volume, candleProgress, promptConfig, structuredRules)
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
        structuredRules,
        environmentContext
      )

      // 3. 调用原有的 AI 分析函数
      const strategySnapshot = createStrategySnapshot(strategy, promptConfig)
      const quantitativeSnapshot = createQuantitativeSnapshot(indicators, volume, candleProgress)
      const aiResult = await this.callAI(fullPrompt, symbol, price, indicators, volume, strategyId, promptConfig, environmentContext, strategySnapshot, quantitativeSnapshot)


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
      // 将 prompt 中使用的成交量派生值随信号传递，保证最终落盘值与 AI 实际分析值一致。
      const { currentCandleVolume, estimatedVolume, progress: volumeProgress } = getCandleVolume(indicators, volume, candleProgress)
      // 与 Prompt 展示精度保持一致，历史订单记录 AI 决策时实际看到的 K 线进度。
      const candleProgressPercent = Number((candleProgress * 100).toFixed(1))
      const volumeEmaAverage = Number(indicators.volumeEmaAverage ?? 0)
      const estimatedEmaRatioPercent = volumeEmaAverage > 0
        ? (estimatedVolume / volumeEmaAverage) * 100
        : undefined
      const openInterest = Number(indicators.openInterest ?? 0)
      const atrVolatilityPercent = indicators.atr !== undefined && price > 0
        ? (indicators.atr / price) * 100
        : undefined
      const communitySentiment: EntryCommunitySentiment | undefined = indicators.enabledIndicators?.squareHeat
        && indicators.squareHeat !== undefined
        ? {
            windowMinutes: Number(indicators.squareHeatWindowMinutes ?? 24 * 60),
            dataUpdatedAt: Number(indicators.squareHeatDataUpdatedAt ?? Date.now()),
            heat: Number(indicators.squareHeat),
            postCount: Number(indicators.squareHeatPostCount ?? 0),
            historyAveragePostCount: Number(indicators.squareHeatHistoryAvg ?? 0),
            heatChangePercent: Number(indicators.squareHeatChangePercent ?? 0),
            heatTrend: indicators.squareHeatTrend ?? 'normal',
            bullishCount: Number(indicators.squareHeatBullishCount ?? 0),
            bearishCount: Number(indicators.squareHeatBearishCount ?? 0),
            neutralCount: Number(indicators.squareHeatNeutralCount ?? 0),
            directionalCoveragePercent: Number(indicators.squareHeatDirectionalCoveragePercent ?? 0),
            netDirectionalSentimentPercent: Number(indicators.squareHeatNetDirectionalSentimentPercent ?? 0)
          }
        : undefined
      const signal: TradeSignal = {
        decisionSnapshot: aiResult.decisionSnapshot,
        environmentContext: aiResult.environmentContext,
        strategyId,
        symbol,
        direction: aiResult.direction === 'LONG' ? 'long' : aiResult.direction === 'SHORT' ? 'short' : 'idle',
        action: aiResult.direction === 'IDLE' ? 'hold' : 'open',
        price,
        stopLoss: 0, // 后续计算
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        indicators: {
          supportResistance: indicators.supportResistance,
          ema: {
            fast: indicators.emaList[0]?.value ?? 0,
            slow: indicators.emaList[indicators.emaList.length - 1]?.value ?? 0
          },
          rsi: aiResult.technicalData.rsi ?? 0,
          macd: indicators.enabledIndicators?.macd ? indicators.macd : undefined,
          atr: indicators.atr,
          candleProgressPercent,
          atrVolatilityPercent,
          oi: indicators.enabledIndicators?.oi && indicators.openInterest !== undefined
            ? {
                value: openInterest,
                changePercent: indicators.openInterestChangePercent,
                trend: indicators.openInterestTrend ?? 'flat'
              }
            : undefined,
          volume: indicators.enabledIndicators?.volume
            ? {
                current: currentCandleVolume,
                prev: indicators.volumePrev,
                average: indicators.volumeAverage ?? 0,
                ratio: indicators.volumeEmaAverage && indicators.volumeEmaAverage > 0
                  ? estimatedVolume / indicators.volumeEmaAverage
                  : undefined,
                estimatedVolume,
                emaAverage: volumeEmaAverage,
                emaPeriod: indicators.volumeEmaPeriod,
                timeframe: indicators.volumeTimeframe,
                candleTimestamp: indicators.volumeCandleTimestamp,
                candleProgress: volumeProgress,
                estimatedEmaRatioPercent
              }
            : undefined,
          communitySentiment
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
    const emaLines: string[] = []
    const momentumLines: string[] = []
    const volatilityLines: string[] = []
    
    // EMA
    if (indicators.enabledIndicators?.ema && indicators.emaList.length > 0) {
      const sorted = [...indicators.emaList].sort(
        (a, b) => Number(a.name.replace(/\D/g, '')) - Number(b.name.replace(/\D/g, ''))
      )

      emaLines.push(
        ...sorted.map(e => {
          const slopeStr = e.slope !== undefined ? ` (斜率: ${(e.slope * 100).toFixed(2)}%)` : ''
          return `- ${e.name}: ${(e.value ?? 0).toFixed(4)}${slopeStr}`
        })
      )

      const compare = (a: number, b: number) => a > b ? '>' : a < b ? '<' : '='

      // EMA趋势
      if (sorted.length >= 2) {
        // EMA排列
        emaLines.push(
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
      momentumLines.push(`- RSI(14): ${indicators.rsi.toFixed(2)}`)
    }

    // MACD
    if (indicators.enabledIndicators?.macd && indicators.macd) {
      momentumLines.push(
        `- MACD(12,26,9，实时未收盘):`,
        `  当前：MACD=${indicators.macd.macd.toFixed(4)}, Signal=${indicators.macd.signal.toFixed(4)}, Histogram=${indicators.macd.histogram.toFixed(4)}`,
        `  上一组：MACD=${indicators.macd.previousMacd.toFixed(4)}, Signal=${indicators.macd.previousSignal.toFixed(4)}, Histogram=${indicators.macd.previousHistogram.toFixed(4)}`,
        `  Crossover=${indicators.macd.crossover}`,
        `  HistogramTrend=${indicators.macd.histogramTrend}`
      )
    }

    // ATR
    if (indicators.enabledIndicators?.atr && indicators.atr !== undefined) {
      volatilityLines.push(`- ATR(14): ${indicators.atr.toFixed(4)}`)
      // ATR波动率百分比（ATR/价格）
      const atrPercent = price > 0 ? (indicators.atr / price * 100) : 0
      volatilityLines.push(`- ATR波动率: ${atrPercent.toFixed(2)}%`)
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
      // ADX 表示趋势强度，PDI/MDI 提供多空方向，供策略提示词比较。
      if (indicators.pdi !== undefined) {
        adxLines.push(`- PDI(+DI): ${indicators.pdi.toFixed(2)}`)
      }
      if (indicators.mdi !== undefined) {
        adxLines.push(`- MDI(-DI): ${indicators.mdi.toFixed(2)}`)
      }
      if (indicators.diSpread !== undefined && indicators.diGapChange !== undefined) {
        // 方向持平或差距不变时归为中性；缺少历史时不输出信号。
        const direction = indicators.diSpread > 0 ? '多头' : '空头'
        const strength = indicators.diGapChange > 0 ? '增强' : '减弱'
        const signal = indicators.diSpread === 0 || indicators.diGapChange === 0
          ? '中性'
          : `${direction}${strength}`
        adxLines.push(`- DI信号趋势: ${signal}`)
      }
    }

    // OI行
    const oiLines: string[] = []
    if (indicators.enabledIndicators?.oi) {
      const context = indicators.openInterestContext
      if (context) {
        oiLines.push(`- 回看窗口：${context.lookbackMinutes}分钟`)
      }
      if (indicators.openInterest !== undefined) {
        oiLines.push(`- OI: ${indicators.openInterest.toFixed(2)}`)
      }
      if (context) {
        oiLines.push(`- 基准OI：${context.baselineValue.toFixed(2)}`)
      }
      if (indicators.openInterestChangePercent !== undefined) {
        oiLines.push(`- OI 变化: ${indicators.openInterestChangePercent.toFixed(2)}%`)
      }
      if (indicators.openInterestTrend) {
        oiLines.push(`- OI 趋势: ${indicators.openInterestTrend}`)
      }
      if (context) {
        // 无效时间不伪造为当前时间；历史数据缺少上下文时保留原有字段。
        const formatTime = (value: number) => Number.isFinite(value) && value > 0
          && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : '未知'
        oiLines.push(
          `- 基准时间：${formatTime(context.baselineTimestamp)}`,
          `- 更新时间：${formatTime(context.updatedAt)}`,
          `- 趋势分类阈值：±${context.trendThresholdPercent.toFixed(2)}%（窗口变化超过阈值才标记增加或减少）`
        )
      }
      if (oiLines.length > 0) {
        oiLines.push('口径：OI增加表示未平仓合约增加，不单独代表看多或看空；结合相同时间窗口的价格变化、主动资金流和成交量判断。OI不按K线进度放大。')
      }
    }

    // SquareHeat行
    const squareHeatLines: string[] = []
    if (indicators.enabledIndicators?.squareHeat) {
      const squareHeatWindow = this.formatSquareHeatWindow(indicators.squareHeatWindowMinutes)
      const heat = indicators.squareHeat !== undefined ? `${indicators.squareHeat}` : '?'
      const change = indicators.squareHeatChangePercent !== undefined
        ? ` ${indicators.squareHeatChangePercent > 0 ? '+' : ''}${indicators.squareHeatChangePercent.toFixed(1)}%`
        : ''
      const trendLabel = indicators.squareHeatTrend === 'increasing' ? '📈增长' : indicators.squareHeatTrend === 'decreasing' ? '📉下降' : '➡️正常'

      // 同时展示方向覆盖率与净情绪，避免少量方向样本被解读为社区整体强烈看涨或看跌。
      let sentimentStr = ''
      const coveragePercent = indicators.squareHeatDirectionalCoveragePercent
      const netSentimentPercent = indicators.squareHeatNetDirectionalSentimentPercent
      if (coveragePercent !== undefined && netSentimentPercent !== undefined) {
        const sentimentIcon = netSentimentPercent > 0 ? '🟢' : netSentimentPercent < 0 ? '🔴' : '⚪'
        const bullishCount = indicators.squareHeatBullishCount ?? 0
        const bearishCount = indicators.squareHeatBearishCount ?? 0
        const neutralCount = indicators.squareHeatNeutralCount ?? 0
        const directionalCount = bullishCount + bearishCount
        const bullishDirectionalPercent = directionalCount > 0
          ? (bullishCount / directionalCount) * 100
          : 0
        const sentimentDirection = netSentimentPercent > 0 ? '偏多' : netSentimentPercent < 0 ? '偏空' : '多空均衡'
        sentimentStr = `；${squareHeatWindow}社区情绪${sentimentIcon}: 共${bullishCount + bearishCount + neutralCount}帖，看涨${bullishCount} / 看跌${bearishCount} / 中立${neutralCount}；明确表态${directionalCount}帖(${coveragePercent.toFixed(2)}%)，方向样本${sentimentDirection}${directionalCount > 0 ? `（看涨占明确表态${bullishDirectionalPercent.toFixed(2)}%）` : ''}`
      }

      const postCount = indicators.squareHeatPostCount ?? 0
      const historyAveragePostCount = indicators.squareHeatHistoryAvg ?? 0
      const updatedAt = Number(indicators.squareHeatDataUpdatedAt)
      const updatedAtText = Number.isFinite(updatedAt) && updatedAt > 0
        ? `，数据更新时间${new Date(updatedAt).toISOString()}`
        : ''
      squareHeatLines.push(
        `- 币安广场热度(${heat})${change}：${trendLabel}`,
        `- 帖子数：${postCount}；历史平均帖子数：${historyAveragePostCount}`,
        ...(sentimentStr ? sentimentStr.slice(1).split('；').map(line => `- ${line}`) : []),
        ...(updatedAtText ? [`- ${updatedAtText.slice(1)}`] : [])
      )
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
    if (indicators.moneyFlowPrompt) enabledIndicatorsList.push('主动资金流')
    if (indicators.enabledIndicators?.squareHeat) enabledIndicatorsList.push('币安广场热度')

    // K线数据
    const formatCandle = (candle: any) => {
      if (!candle) return ''
      return `  开盘：${candle.open.toFixed(5)}
    最高：${candle.high.toFixed(5)}
    最低：${candle.low.toFixed(5)}
    收盘价（当前K线为快照值）：${candle.close.toFixed(5)}${indicators.enabledIndicators?.volume ? `
    成交量：${candle.volume.toFixed(2)}` : ''}
    阴阳：${candle.close > candle.open ? '阳线' : candle.close < candle.open ? '阴线' : '平盘'}`
    }

    // 量能使用自身周期的快照进度，不借用价格行为K线的进度。
    const { currentCandleVolume, estimatedVolume, progress: volumeProgress } = getCandleVolume(indicators, volume, candleProgress)

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
          const volumeRatio = estimatedVolume / volumeEma
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

    /** 空分组不输出标题，避免未启用指标进入分析上下文。 */
    const section = (title: string, lines: string[]) => lines.length > 0
      ? `### ${title}\n${lines.join('\n')}` : ''
    if (indicators.enabledIndicators?.macd && indicators.macd) {
      momentumLines.push(`- MACD趋势结果（实时未收盘）：${getMacdTrendResult(indicators.macd)}`)
    }
    if (priceInRangeLines.length > 0) {
      priceInRangeLines.push('区间口径：较低EMA为0%，较高EMA为100%；负值表示低于区间，超过100%表示高于区间。')
    }
    const volumeLines = indicators.enabledIndicators?.volume ? [
      `- 成交量周期：${indicators.volumeTimeframe ?? indicators.adxPeriodLabel}；该周期K线进度：${(volumeProgress * 100).toFixed(1)}%`,
      `- 当前累计成交量：${currentCandleVolume.toFixed(2)}`,
      `- 预计K线结束成交量：${estimatedVolume.toFixed(2)}`,
      ...(indicators.volumePrev !== undefined ? [`- 前一根成交量：${indicators.volumePrev.toFixed(2)}`] : []),
      ...volumeCompareLines,
      '成交量EMA包含该周期当前K线的快照值，与预筛使用同一份数据。',
      '量能条件使用预计K线结束成交量；该值为估算值，非已完成成交量。'
    ] : []
    const technicalSections = [
      section('EMA趋势与价格位置', [...emaLines, ...emaDeviationLines, ...priceInRangeLines]),
      section('动能', momentumLines),
      section('趋势强度与方向', adxLines),
      section('波动', volatilityLines),
      section('持仓量', oiLines),
      formatSupportResistance(indicators.supportResistance).trim(),
      section('社区热度与情绪', squareHeatLines),
      section('主动资金流', indicators.moneyFlowPrompt ? [indicators.moneyFlowPrompt] : [])
    ].filter(Boolean)

    return {
      symbol,
      price: (price ?? 0).toFixed(5),
      currentTime: new Date(indicators.snapshotTimestamp ?? Date.now()).toISOString(),
      candleProgressPercent: (candleProgress * 100).toFixed(1),
      currentVolume: indicators.enabledIndicators?.volume ? (currentCandleVolume ?? 0).toFixed(2) : '',
      estimatedVolume: estimatedVolume.toFixed(2),
      lastCandle: indicators.lastCandle ? formatCandle(indicators.lastCandle) : '',
      prevCandle: indicators.prevCandle ? formatCandle(indicators.prevCandle) : '',
      technicalSections,
      volumeSection: section('成交量', volumeLines),
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
   * 将社区情绪统计窗口格式化为 AI 可读的周期标签。
   */
  private formatSquareHeatWindow(minutes: unknown): string {
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) return '24H'
    if (value % (24 * 60) === 0) return `${value / (24 * 60)}D`
    if (value % 60 === 0) return `${value / 60}H`
    return `${value}M`
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
    structuredRules?: StructuredRules,
    environmentContext?: EnvironmentContext
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
## 一、市场快照
交易对：${data.symbol}
数据时间：${data.currentTime}
当前价格：${data.price} USDT
当前K线进度：${data.candleProgressPercent}%（${candleProgress < 1 ? '未收盘' : '已完成'}）
${data.enabledIndicatorsList.length > 0 ? `启用指标：${data.enabledIndicatorsList.join('、')}` : '启用指标：无'}
${indicators.supportResistance ? `位置参考：支撑阻力（${indicators.supportResistance.timeframe}）` : ''}
仅使用提供的数据；未启用指标不参与判断。
当前价格与K线收盘价可能来自不同快照；形态按提供的OHLC计算，不用当前价格替换。

## 二、K线与成交量
### K线形态
${data.lastCandle ? `- 当前K线（${candleProgress < 1 ? '未收盘' : '已完成'}）\n${data.lastCandle}` : ''}
${data.prevCandle ? `- 前一根K线\n${data.prevCandle}` : ''}
${data.candleBodyLines.join('\n')}
${candleProgress < 1 ? '当前实体及影线为未收盘快照；实体比不代表完整K线的动能确认。' : ''}

${data.volumeSection}

## 三、技术指标
${data.technicalSections.join('\n\n')}

### 近30日持续高交易量且稳定交易对市场背景
${formatMarketBreadth(indicators.marketBreadth, symbol)}

--------------------------
## 四、策略（唯一规则）
${promptConfig.userPrompt}
--------------------------
## 五、置信度结果
${formatEnvironmentConfidence(environmentContext)}
## 输出（必须严格JSON）
{
  "direction": "LONG | SHORT",
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
- confidence: LONG/SHORT使用对应方向的上述置信度结果（0~100）
- scoreBreakdown: 评分拆解，包含 baseScore/hardScore/softScore/penaltyScore/finalScore
- riskLevel: 风险等级，LOW/MEDIUM/HIGH

### scoreBreakdown 计算规则（必须严格遵守）
- baseScore：基础分，范围 0~30（结合策略适配度、趋势强弱及市场背景评分；综合当前交易对 1h、4h、24h 涨跌幅的方向、幅度及相互关系，符合策略时加分，不利于策略时酌情扣分；缺失数据不参与判断，持平视为中性）
- hardScore：硬条件得分，范围 0~50（按硬条件满足比例线性给分）
- softScore：软条件得分，范围 0~20（按软条件满足比例线性给分）
- penaltyScore：惩罚分，范围 -10~0（仅对前三项未覆盖且违反当前策略规则的独立异常扣分，如条件冲突、波动异常、过度追价，不得重复扣分）
- finalScore：策略规则匹配度（微观），必须等于 max(0, min(100, baseScore + hardScore + softScore + penaltyScore))，仅反映策略条件满足程度
- 禁止输出不满足上述范围或不满足求和关系的值
`;
  }

  /**
   * 构建系统提示词（包含历史学习经验）
   * 从 trade-history-analysis.json 读取已保存的分析结果
   */
  private async buildSystemPrompt(hasSquareHeat: boolean = false, squareHeatWindowMinutes?: number): Promise<string> {
    // 读取开关配置：是否在系统提示词中包含历史分析经验，默认开启
    const enableHistorySection = this.config.aiAnalysisConfig?.enableHistorySection ?? true

    let historySection = ''
    if (enableHistorySection) {
      const historyAnalysis = await getLatestAnalysis()
      historySection = historyAnalysis ? formatAnalysisToPromptSection(historyAnalysis) : ''
    }

    const squareHeatWindow = this.formatSquareHeatWindow(squareHeatWindowMinutes)

    // 根据 squareHeat 是否启用来决定 reasoning 格式示例中是否包含币安广场热度相关展示
    const squareHeatReasoningExample = hasSquareHeat
      ? `；币安广场热度(31) -3.2%：➡️正常；${squareHeatWindow}社区情绪🟢: 看涨(7) / 看跌(2) / 中立(78)，方向覆盖率 10.34%，多空情绪指数 +55.56%。`
      : ''

    return `
你是专业的量化交易策略执行引擎。
对当前市场数据进行客观分析。
${historySection}
【核心原则】
1. 你只做分析，不替用户做最终决策。
2. 先根据策略规则及所需数据确定唯一方向（LONG/SHORT），之后只按该方向执行交易判断：LONG只用做多规则，SHORT只用做空规则。
3. 所有条件必须逐条验证，带上真实数值。
4. 输出必须是合法JSON，无任何多余内容。
5. confidence 使用用户提示词中对应方向的置信度结果（0-100）。
6. scoreBreakdown.finalScore 为策略规则匹配度（0-100），仅反映策略条件满足程度（微观）。
7. scoreBreakdown 必须满足：baseScore∈[0,30]，hardScore∈[0,50]，softScore∈[0,20]，penaltyScore∈[-10,0]。
8. finalScore 必须严格等于 baseScore + hardScore + softScore + penaltyScore（再截断到0~100）。
9. riskLevel 综合市场波动性、趋势强度等给出风险等级。


----------------------------------
【输出格式】
{
  "direction": "LONG | SHORT",
  "confidence": number,
  "reasoning": "一行中文，最多 500 个字符，包含所有条件的判断结果和数值",
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
- 不能超过500字符

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
  private async saveAIAnalysisToFile(analysis: AIAnalysis, userPrompt?: string): Promise<void> {
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
      
      // 先确保持久化规则存在；失败时不写出无法追溯正文的悬空引用。
      if (analysis.strategySnapshot?.rulesHash) {
        if (userPrompt === undefined || await saveAIRules(userPrompt) !== analysis.strategySnapshot.rulesHash) {
          throw new Error('AI 分析引用的规则与实际提示词不一致')
        }
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
    promptConfig?: AIPromptConfig,
    environmentContext?: EnvironmentContext,
    strategySnapshot?: AIAnalysis['strategySnapshot'],
    quantitativeSnapshot?: ReturnType<typeof createQuantitativeSnapshot>
  ): Promise<(AIAnalysis & { decisionSnapshot?: TradeDecision }) | null> {
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
        const systemPrompt = await this.buildSystemPrompt(hasSquareHeat, indicators.squareHeatWindowMinutes)
        
        const messages: AIChatMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]

        // 调试时从最终用户提示词截取原文，确保看到的就是本次请求实际携带的市场背景。
        if (process.env.AI_DEBUG_MARKET_BREADTH === '1') {
          const sectionStart = prompt.indexOf('### 已选交易对市场背景')
          const sectionEnd = prompt.indexOf('\n--------------------------', sectionStart)
          const section = sectionStart < 0 ? '本次提示词未包含市场广度。'
            : prompt.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd).trim()
          logger.info('AI市场广度', `策略=${strategyId} 交易对=${symbol}\n${section}`)
        }

        const analysisId = randomUUID()
        const requestedAt = Date.now()
        let effectiveParameters: Record<string, unknown> = {}
        const content = await callAIAPI(providerConfig, messages, {
          onRequestParameters: parameters => { effectiveParameters = parameters },
          temperature: promptConfig?.temperature ?? 0.5,
          maxTokens: promptConfig?.maxTokens ?? 3000,
          thinkingEnabled: promptConfig?.thinkingEnabled,
          thinkingProvider: provider,
          timeoutMs: this.config.aiRateLimit?.timeoutMs ?? 45000
        })

        // 提取JSON内容
        const jsonContent = extractJSONContent(content)
        const aiResult = JSON.parse(jsonContent)

        let direction: Direction = ['LONG', 'SHORT', 'IDLE'].includes(aiResult.direction) ? aiResult.direction : 'IDLE'
        
        // 构建分析理由
        const reasoning = typeof aiResult.reasoning === 'string' ? aiResult.reasoning : '无分析理由'
        
        // AI决定交易方向，程序按该方向绑定环境分，避免误用反方向的置信度。
        const assessment = direction === 'LONG' ? environmentContext?.long : direction === 'SHORT' ? environmentContext?.short : undefined
        // 没有对应方向的有效分数时不放行开仓。
        if (direction !== 'IDLE' && !assessment?.available) direction = 'IDLE'
        // 观望时保留双方向中较低的环境分，便于观察；数据不足仍不伪造有效分数。
        const confidence = direction === 'IDLE'
          ? environmentContext?.long.available && environmentContext?.short.available
            ? Math.min(environmentContext.long.confidence!, environmentContext.short.confidence!)
            : 0
          : assessment!.confidence!

        const normalizedScoreBreakdown = this.normalizeScoreBreakdown(aiResult.scoreBreakdown)

        const analysis: AIAnalysis = {
          strategySnapshot,
          environmentContext,
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
            ...quantitativeSnapshot,
            price,
            ...Object.fromEntries(emaEntries.map(item => [item.name, item.value])),
            ...(indicators.emaMap || {}),
            rsi: indicators.rsi ?? 0,
            macd: indicators.macd?.macd,
            macdSignal: indicators.macd?.signal,
            macdHistogram: indicators.macd?.histogram,
            previousMacd: indicators.macd?.previousMacd,
            previousMacdSignal: indicators.macd?.previousSignal,
            previousMacdHistogram: indicators.macd?.previousHistogram,
            macdCrossover: indicators.macd?.crossover,
            macdHistogramTrend: indicators.macd?.histogramTrend,
            volume,
            openInterest: indicators.enabledIndicators?.oi ? indicators.openInterest : undefined,
            openInterestChangePercent: indicators.enabledIndicators?.oi ? indicators.openInterestChangePercent : undefined,
            openInterestTrend: indicators.enabledIndicators?.oi ? indicators.openInterestTrend : undefined,
            adx: indicators?.adx ?? 0,
            adxPeriodLabel: indicators?.adxPeriodLabel,
            adxSlope: indicators?.adxSlope,
            supportResistance: indicators.supportResistance,
            support: aiResult.support,
            resistance: aiResult.resistance,
          },
        }

        // 与分析记录 timestamp 精确关联；完整请求只保留在有界内存中，不写入 JSONL。
        aiPromptCache.put({ strategyId, symbol, timestamp: analysis.timestamp, messages })

        // 异步保存到文件，不阻塞主流程
        this.saveAIAnalysisToFile(analysis, promptConfig?.userPrompt).catch(() => {})

        // 仅返回给内部信号；不把完整正文重复写入普通 AI 分析 JSONL。
        const decisionSnapshot: TradeDecision = JSON.parse(JSON.stringify({
          schemaVersion: 1,
          analysisId,
          requestedAt,
          completedAt: analysis.timestamp,
          strategyId,
          symbol,
          messages,
          provider,
          model: providerConfig.model,
          parameters: effectiveParameters,
          rawResponse: content,
          analysis
        }))
        return { ...analysis, decisionSnapshot }
      } catch (error: any) {
        const runtimeConfig = useRuntimeConfig()
        const provider = promptConfig?.provider || (runtimeConfig.aiProvider as AIProvider) || 'deepseek'
        this.recordAIError(provider, error)
        logger.error('MultiStrategyAIAnalyzer', `AI API 调用失败: ${error.message}`, { strategyId, symbol, provider })
        
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
      thinkingEnabled: promptConfig?.thinkingEnabled,
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
