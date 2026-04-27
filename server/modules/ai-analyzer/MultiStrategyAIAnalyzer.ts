// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig, AIProvider } from '../../../types/strategy';
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig, Direction } from '../../../types';
import type { TradeSignal } from '../../../types/signal';
import { BinanceService } from '../../utils/binance';
import { logger } from '../../utils/logger';
import { strategyStore } from '../strategy-store/StrategyStore';
import { getProviderConfig, callAIAPI, extractJSONContent, type AIChatMessage } from '../../utils/ai-service';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * AI 分析缓存
 */
interface MultiStrategyAICache {
  signal: TradeSignal;
  timestamp: number;
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
 */
export class MultiStrategyAIAnalyzer {
  private binance: BinanceService
  private config: BotConfig

  constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    // logger.info('MultiStrategyAIAnalyzer', '多策略 AI 分析器已初始化')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
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
      // 1. 检查缓存
      const cacheKey = this.buildCacheKey(strategyId, symbol, indicators, price)
      const cached = aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
        return cached.signal
      }

      // 2. 构建完整提示词
      const fullPrompt = this.buildFullPrompt(
        promptConfig,
        symbol,
        price,
        indicators,
        volume,
        candleProgress
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
      const dynamicEmaLines = indicators.emaList
        .map(item => `- ${item.name}: ${(item.value ?? 0).toFixed(4)}`)
        .join('\n')
      technicalIndicatorLines.push(dynamicEmaLines)
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

    // 启用指标列表
    const enabledIndicatorsList: string[] = []
    if (indicators.enabledIndicators?.ema) enabledIndicatorsList.push('EMA')
    if (indicators.enabledIndicators?.rsi) enabledIndicatorsList.push('RSI')
    if (indicators.enabledIndicators?.macd) enabledIndicatorsList.push('MACD')
    if (indicators.enabledIndicators?.adx) enabledIndicatorsList.push('ADX')
    if (indicators.enabledIndicators?.atr) enabledIndicatorsList.push('ATR')
    if (indicators.enabledIndicators?.oi) enabledIndicatorsList.push('持仓量(OI)')
    if (indicators.enabledIndicators?.volume) enabledIndicatorsList.push('成交量')

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
      enabledIndicatorsList
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
    candleProgress: number = 0.1
  ): string {
    const data = this.preparePromptData(symbol, price, indicators, volume, candleProgress)
    
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

## 三、技术指标（仅启用的指标有效）
${data.technicalIndicatorLines.join('\n')}
${data.adxLines.length > 0 ? data.adxLines.join('\n') : ''}
${data.oiLines.length > 0 ? data.oiLines.join('\n') : ''}
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
  "reasoning": string
}
`;
  }

  /**
   * 构建系统提示词（包含历史学习经验）
   */
  private async buildSystemPrompt(): Promise<string> {
    return `
你是专业的量化交易策略执行引擎。
对当前市场数据进行客观分析、计算真实置信度、输出真实方向。

【核心原则】
1. 你只做分析，不替用户做最终决策。
2. 永远输出真实判断的方向（LONG / SHORT / IDLE），如果方向判定后，后面条件尽量围绕方向来判断。
3. 请基于你实际检查出的满足条件的数量，以及每个条件预先设定的重要性权重，真实计算一个 0~100 的置信度分数：满足越多、越重要的条件，分数越高。
4. 所有条件必须逐条验证，带上真实数值。
5. 输出必须是合法JSON，无任何多余内容。

----------------------------------
【输出格式】
{
  "direction": "LONG | SHORT | IDLE",
  "confidence": number,
  "reasoning": "一行中文，包含所有条件的判断结果和数值"
}

【reasoning 要求】
- 必须包含：方向、关键指标数值、每条条件是否满足
- 所有指标只展示原始数值与大小/区间对比结论，只写判定结果，不写运算逻辑和过程；
- 格式清晰、无换行、无计算过程、不矛盾、精简直白，严格对标示例格式
- 示例：EMA7(52100) > EMA50(51800) ，方向 LONG，RSI(48)∈[30,65] 满足，OI增加+1.2% 满足，预计成交量(5114.13) < 1.8倍 前K量(10464.66)  不满足，ATR波动率 0.52% > 0.38% 满足；最终结果为不满足，置信度60。

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
      saveIdle: config?.saveIdle ?? false
    }
  }

  /**
   * 保存AI分析结果到每日JSON文件
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
      
      // 确保目录存在
      const saveDir = path.join(process.cwd(), 'data', 'ai-analysis')
      await fs.mkdir(saveDir, { recursive: true })
      
       // 生成当天文件名（使用本地时区）
       const date = new Date()
       const year = date.getFullYear()
       const month = String(date.getMonth() + 1).padStart(2, '0')
       const day = String(date.getDate()).padStart(2, '0')
       const dateStr = `${year}-${month}-${day}`
      const fileName = `ai-analysis-${dateStr}.json`
      const filePath = path.join(saveDir, fileName)
      
       // 读取现有内容或创建新数组
       let records: AIAnalysis[] = []
       try {
         const fileContent = await fs.readFile(filePath, 'utf-8')
         // 处理空文件或无效JSON
         if (fileContent.trim()) {
           records = JSON.parse(fileContent)
           // 确保解析结果是数组
           if (!Array.isArray(records)) {
             records = []
           }
         }
       } catch (error: any) {
         // 文件不存在、内容为空或解析失败，使用空数组
         if (error.code !== 'ENOENT') {
           logger.error('MultiStrategyAIAnalyzer', '读取AI分析历史文件失败:', error.message)
         }
         records = []
       }
       
      // 添加新记录
      records.push(analysis)
      
      // 如果超过最大数量限制，删除最早的记录
      if (records.length > saveConfig.maxRecords) {
        const excessCount = records.length - saveConfig.maxRecords
        records = records.slice(excessCount)
      }
      
      // 写入文件
      await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8')
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', '保存AI分析结果失败:', error.message)
    }
  }

  /**
   * 调用 AI API（支持多提供商）
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
    try {
      const emaEntries = indicators.emaList
      const runtimeConfig = useRuntimeConfig()

      // 获取 AI 提供商配置（优先使用策略配置，否则使用默认配置）
      const provider = promptConfig?.provider || (runtimeConfig.aiProvider as AIProvider) || 'deepseek'
      const providerConfig = getProviderConfig(provider, runtimeConfig)
      
      // 构建系统提示词
      const systemPrompt = await this.buildSystemPrompt()
      
      const messages: AIChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]

      const content = await callAIAPI(providerConfig, messages, {
        temperature: promptConfig?.temperature ?? 0.5,
        maxTokens: promptConfig?.maxTokens ?? 1000
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
        confidence = 0
      }
      
      const analysis: AIAnalysis = {
        symbol,
        timestamp: Date.now(),
        strategyId,
        direction: direction,
        confidence: confidence,
        riskLevel: (aiResult.riskLevel || 'MEDIUM') as RiskLevel,
        isBullish: direction === 'LONG',
        reasoning: reasoning,
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
  indicators.emaList.map(item => `${item.name}:${(item.value ?? 0).toFixed(2)}`).join('|'),
  (indicators.rsi ?? 0).toFixed(2),
  `${(indicators.macd?.macd ?? 0).toFixed(4)}|${(indicators.macd?.signal ?? 0).toFixed(4)}|${(indicators.macd?.histogram ?? 0).toFixed(4)}`,
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
