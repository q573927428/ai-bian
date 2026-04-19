// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig } from '../../../types/strategy'
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig, Direction } from '../../../types'
import type { TradeSignal } from '../../../types/signal'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import fs from 'node:fs/promises'
import path from 'node:path'

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
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
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

      // 临时测试：针对不同策略和交易对强制返回信号
      // if (!aiResult) {
      //   return null
      // }
      // if (strategyId === 'strategy_001' && symbol === 'ETH/USDT') { 
      //   aiResult.direction = 'LONG'
      //   aiResult.score = 80 // 确保置信度足够
      // } else if (strategyId === 'strategy_002' && symbol === 'SOL/USDT') {
      //   aiResult.direction = 'LONG'
      //   aiResult.score = 80 // 确保置信度足够
      // } else {
      //   if (aiResult.direction === 'IDLE') {
      //     return null
      //   }
      // }

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
    // 构建技术指标部分的提示词（根据指标启用状态）
    const technicalIndicatorLines: string[] = []
    
    // 只在启用EMA时显示
    if (indicators.enabledIndicators?.ema && indicators.emaList.length > 0) {
      const dynamicEmaLines = indicators.emaList
        .map(item => `- ${item.name}: ${(item.value ?? 0).toFixed(4)}`)
        .join('\n')
      technicalIndicatorLines.push(dynamicEmaLines)
    }

    // 只在启用RSI时显示
    if (indicators.enabledIndicators?.rsi && indicators.rsi !== undefined) {
      technicalIndicatorLines.push(`- RSI(14): ${indicators.rsi.toFixed(2)}`)
    }

    // 只在启用MACD时显示
    if (indicators.enabledIndicators?.macd && indicators.macd) {
      technicalIndicatorLines.push(`- MACD(12,26,9): MACD=${indicators.macd.macd.toFixed(4)}, Signal=${indicators.macd.signal.toFixed(4)}, Histogram=${indicators.macd.histogram.toFixed(4)}`)
    }

    // 只在启用ATR时显示
    if (indicators.enabledIndicators?.atr && indicators.atr !== undefined) {
      technicalIndicatorLines.push(`- ATR(14): ${indicators.atr.toFixed(4)}`)
    }

    // 动态构建ADX显示行（根据实际配置的周期数量）
    const adxLines: string[] = []
    if (indicators.enabledIndicators?.adx) {
      if (indicators.adxMain !== undefined) {
        adxLines.push(`- ADX(${indicators.adxPeriodLabels.main}): ${indicators.adxMain.toFixed(2)}`)
      }
      
      // 只有当有第二个周期时才显示
      if (indicators.adxSecondary !== undefined) {
        adxLines.push(`- ADX(${indicators.adxPeriodLabels.secondary}): ${indicators.adxSecondary.toFixed(2)}`)
      }
      
      // 只有当有第三个周期时才显示
      if (indicators.adxTertiary !== undefined) {
        adxLines.push(`- ADX(${indicators.adxPeriodLabels.tertiary}): ${indicators.adxTertiary.toFixed(2)}`)
      }
    }

    // 只在启用OI时显示
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

    // 构建启用的指标列表说明
    const enabledIndicatorsList = []
    if (indicators.enabledIndicators?.ema) enabledIndicatorsList.push('EMA')
    if (indicators.enabledIndicators?.rsi) enabledIndicatorsList.push('RSI')
    if (indicators.enabledIndicators?.macd) enabledIndicatorsList.push('MACD')
    if (indicators.enabledIndicators?.adx) enabledIndicatorsList.push('ADX')
    if (indicators.enabledIndicators?.atr) enabledIndicatorsList.push('ATR')
    if (indicators.enabledIndicators?.oi) enabledIndicatorsList.push('持仓量(OI)')
    if (indicators.enabledIndicators?.volume) enabledIndicatorsList.push('成交量')

    // 👇 约束内容定义在这里
  const constraints = `
  ## 重要输出约束
  - 必须使用 JSON 格式，不要包含 Markdown 代码块标记（如 \`\`\`json）。
  - "direction" 必须是 "LONG", "SHORT", "IDLE" 之一。
  - "reasoning" 必须引用提供的具体数值（如：RSI 数值、EMA 排列情况），严禁使用模糊描述。
  - 若判断为 IDLE，confidence 不得高于 20。`

     return `
## 当前市场数据
 交易对: ${symbol}
 价格: ${(price ?? 0).toFixed(4)}
 24h 涨跌: ${(priceChange24h ?? 0).toFixed(2)}%
 ${indicators.enabledIndicators?.volume ? `成交量: ${(volume ?? 0).toFixed(2)}` : ''}
 时间: ${new Date().toISOString()}

  ## 技术指标
  ${technicalIndicatorLines.join('\n')}
  ${adxLines.length > 0 ? adxLines.join('\n') : ''}
  ${oiLines.length > 0 ? oiLines.join('\n') : ''}

${enabledIndicatorsList.length > 0 ? `
---
**重要提示**: 本次分析仅基于以下启用的指标: ${enabledIndicatorsList.join(', ')}
请忽略未提供的指标，专注于分析可用的数据。
` : ''}

## 交易逻辑
${promptConfig.userPrompt}

请返回 JSON 格式的交易信号，格式如下：
{
  "direction": "LONG" | "SHORT" | "IDLE",
  "confidence": 0-100,
  "score": 0-100,
  "reasoning": "分析理由"
}
${constraints}
`
  }

  /**
   * 构建系统提示词（包含历史学习经验）
   */
  private async buildSystemPrompt(): Promise<string> {
    let basePrompt = `你是一位专业的加密货币期货交易分析师，拥有10年以上的交易经验。
请基于技术分析进行判断，优先考虑趋势一致性、动量强度和风险回报比，
在没有明显优势时倾向于返回IDLE，而不是强行给出方向。
请严格按照指定的JSON格式返回分析结果，不要添加任何额外的文本或解释。`

    return basePrompt
  }

  /**
   * 保存AI分析结果到每日JSON文件
   */
  private async saveAIAnalysisToFile(analysis: AIAnalysis): Promise<void> {
    try {
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
      
      // 添加新记录并写入文件
      records.push(analysis)
      await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8')
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', '保存AI分析结果失败:', error.message)
    }
  }

  /**
   * 调用 AI API（直接实现原有逻辑）
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
      const emaEntries = indicators.emaList
      const runtimeConfig = useRuntimeConfig()

      // 构建系统提示词
      const systemPrompt = await this.buildSystemPrompt()
      
      // 调用DeepSeek API
      const response = await fetch(`${runtimeConfig.deepseekApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runtimeConfig.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.5,
          max_tokens: 1000,
          response_format: { type: "json_object" }
        }),
      })

      if (!response.ok) {
        throw new Error(`DeepSeek API请求失败: ${response.statusText}`)
      }

      const result = await response.json()
      const content = result.choices?.[0]?.message?.content || '{}'

      // 提取JSON内容（可能包含markdown代码块）
      let jsonContent = content
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        jsonContent = jsonMatch[1]
      }

      const aiResult = JSON.parse(jsonContent)

      const direction = (aiResult.direction || 'IDLE') as Direction
      
      // 构建分析理由，限制总长度不超过150字
      let reasoning = aiResult.reasoning || '无分析理由'
      reasoning = reasoning
      
      const analysis: AIAnalysis = {
        symbol,
        timestamp: Date.now(),
        strategyId,
        direction: direction,
        confidence: Math.min(100, Math.max(0, aiResult.confidence || 0)),
        score: Math.min(100, Math.max(0, aiResult.score || 0)),
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
          adxMain: indicators?.adxMain ?? 0,
          adxSecondary: indicators?.adxSecondary ?? 0,
          adxTertiary: indicators?.adxTertiary ?? 0,
          adxPeriodLabels: indicators?.adxPeriodLabels,
          support: aiResult.support,
          resistance: aiResult.resistance,
        },
      }

      // 只保存非IDLE的分析结果
      // if (analysis.direction !== 'IDLE') {
      //   // 异步保存到文件，不阻塞主流程
      //   this.saveAIAnalysisToFile(analysis).catch(() => {})
      // }
      this.saveAIAnalysisToFile(analysis).catch(() => {})

      logger.info('扫描结果', ` ${analysis.symbol} @${analysis.technicalData.price} ${analysis.direction} 置信度（${analysis.confidence}） 评分（${analysis.score}）[策略 - ${analysis.strategyId}]`);

      return analysis
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', `AI API 调用失败: ${error.message}`)
      
      // 返回默认分析结果（降级处理）
      const fallbackAnalysis: AIAnalysis = {
        symbol,
        timestamp: Date.now(),
        strategyId,
        direction: 'IDLE',
        confidence: 0,
        score: 0,
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

      // 降级处理的结果通常是IDLE，不保存到文件

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
