import type { AIAnalysis, Direction, RiskLevel, TechnicalIndicators, BotConfig, AIConditionMode, TradingSignal } from '../../types'
import { getLatestLearningResult, checkDailyLearning } from './ai-self-learning'
import fs from 'node:fs/promises'
import path from 'node:path'

interface AIAnalysisCache {
  data: AIAnalysis
  timestamp: number
}

const analysisCache = new Map<string, AIAnalysisCache>()

/**
 * 构建系统提示词
 */
/**
 * 构建系统提示词（包含历史学习经验）
 */
async function buildSystemPrompt(): Promise<string> {
  let basePrompt = `你是一位专业的加密货币期货交易分析师，拥有10年以上的交易经验。
请基于技术分析进行判断，优先考虑趋势一致性、动量强度和风险回报比，
在没有明显优势时倾向于返回IDLE，而不是强行给出方向。
请严格按照指定的JSON格式返回分析结果，不要添加任何额外的文本或解释。`

  // 添加历史学习经验
  const learningResult = await getLatestLearningResult()
  if (learningResult) {
    basePrompt += `

## 历史交易经验总结（请严格参考这些经验进行分析）：
### 成功交易关键因素：
${learningResult.successFactors.map(factor => `- ${factor}`).join('\n')}

### 失败交易风险因素（请尽量避免这些情况）：
${learningResult.failureFactors.map(factor => `- ${factor}`).join('\n')}

### 高胜率交易模式：
${learningResult.keyPatterns.map(pattern => `- ${pattern}`).join('\n')}

### 优化建议：
${learningResult.optimizationSuggestions.map(suggestion => `- ${suggestion}`).join('\n')}
`
  }

  return basePrompt
}

/**
 * 构建AI分析提示词
 */
function buildAIPrompt(
  symbol: string,
  price: number,
  ema20: number,
  ema60: number,
  rsi: number,
  volume: number,
  priceChange24h: number,
  indicators?: TechnicalIndicators,
  config?: BotConfig
): string {
  // 获取策略模式，默认为短期
  const strategyMode = config?.strategyMode || 'short_term'
  
  // 根据策略模式选择指标名称（使用配置的EMA周期）
  const emaPeriods = config?.indicatorsConfig?.emaPeriods
  const emaFastPeriod = emaPeriods?.[strategyMode]?.fast || (strategyMode === 'medium_term' ? 50 : 20)
  const emaMediumPeriod = emaPeriods?.[strategyMode]?.medium || (strategyMode === 'medium_term' ? 100 : 30)
  const emaSlowPeriod = emaPeriods?.[strategyMode]?.slow || (strategyMode === 'medium_term' ? 200 : 60)
  const emaFastName = `EMA${emaFastPeriod}`
  const emaMediumName = `EMA${emaMediumPeriod}`
  const emaSlowName = `EMA${emaSlowPeriod}`
  
  // 根据策略模式选择ADX周期名称
  const adxMainName = strategyMode === 'medium_term' ? '1小时ADX' : '15分钟ADX'
  const adxSecondaryName = strategyMode === 'medium_term' ? '4小时ADX' : '1小时ADX'
  const adxTertiaryName = strategyMode === 'medium_term' ? '日线ADX' : '4小时ADX'
  
  // 基础市场数据
  let prompt = `请对${symbol}进行全面的技术分析并提供交易建议。

## 市场数据：
- 当前价格: ${price.toFixed(4)}
- 价格变化: ${priceChange24h.toFixed(2)}%
- 成交量: ${volume.toFixed(2)}
- RSI(14): ${rsi.toFixed(2)}
- ${emaFastName}: ${ema20.toFixed(4)}
- ${emaMediumName}: ${indicators ? indicators.ema30.toFixed(4) : 'N/A'}
- ${emaSlowName}: ${ema60.toFixed(4)}`

  // 如果提供了完整的技术指标，添加更多分析维度
  if (indicators) {
    prompt += `

## 多时间框架技术指标：
### ADX趋势强度：
- ${adxMainName}: ${indicators.adx15m.toFixed(2)}
- ${adxSecondaryName}: ${indicators.adx1h.toFixed(2)}
- ${adxTertiaryName}: ${indicators.adx4h.toFixed(2)}

### 其他指标：
- ATR: ${indicators.atr.toFixed(4)} (${(indicators.atr / price * 100).toFixed(2)}%)
- ADX斜率: ${indicators.adxSlope.toFixed(4)}
- 持仓量(OI): ${indicators.openInterest.toFixed(2)}
- OI变化率: ${indicators.openInterestChangePercent.toFixed(2)}%
- OI趋势: ${indicators.openInterestTrend}`
  }

  prompt += `

## 分析要求：
请基于以上数据，综合考虑所有你认为重要的因素进行分析，包括但不限于：
1. 趋势强度（ADX值）
2. 趋势方向（EMA排列）
3. 超买超卖状态（RSI）
4. 波动性风险（ATR）
5. 成交量配合
6. 多时间框架一致性

## 交易决策原则：
- 仅在趋势明确且多指标共振时给出LONG或SHORT
- 若趋势不清晰或存在冲突信号，返回IDLE
- 优先选择高胜率、低风险的交易机会
- 避免在震荡区间或高风险环境中入场

## 输出格式要求：
请以严格的JSON格式回复，包含以下字段：
{
  "direction": "LONG/SHORT/IDLE",
  "confidence": 0-100之间的数字,
  "score": 0-100之间的综合评分,
  "riskLevel": "LOW/MEDIUM/HIGH",
  "reasoning": "详细的分析理由（中文，最多150字）",
  "support": 支撑位价格（可选，基于技术分析）,
  "resistance": 阻力位价格（可选，基于技术分析）,
  "keyFactors": ["关键因素1", "关键因素2", "关键因素3"]
}

## 字段说明：
- direction：交易方向，LONG做多，SHORT做空，IDLE观望
- confidence：对方向判断的把握程度，0-100
- score：综合评分，考虑风险回报比、趋势强度等因素，0-100
- riskLevel：风险等级，LOW低，MEDIUM中，HIGH高
- reasoning：详细的分析理由，用中文描述，最多150字
- support：支撑位价格，可选
- resistance：阻力位价格，可选
- keyFactors：影响判断的关键因素列表，数组格式

## 评分标准说明：
### 1. confidence(置信度)判断标准：
- 90-100：完全确定，所有指标都支持同一方向，无任何冲突
- 70-89：比较确定，绝大多数指标支持，仅有非常次要的冲突
- 50-69：基本确定，主要指标支持，有部分次要指标反向
- 0-49：不确定，方向判断有较大分歧

### 2. score(综合评分)判断标准：
- 80-100：极佳机会 ✅ 完美趋势+全指标共振+高盈亏比>3:1
- 60-79：良好机会 ✅ 趋势明确+多数指标一致+盈亏比>2:1
- 40-59：一般机会 ⚠️ 有趋势但存在指标冲突/盈亏比一般
- 20-39：较差机会 ❌ 趋势模糊/风险较高/盈亏比不佳
- 0-19：极差机会 ❌ 完全不适合交易

### 重要要求：
- 优质机会请敢于打高分，不要保守，但是也不要乱给分数

请确保输出是完全有效的JSON格式，不要包含任何其他文本内容。`

  return prompt
}

/**
 * 保存AI分析结果到每日JSON文件
 */
async function saveAIAnalysisToFile(analysis: AIAnalysis): Promise<void> {
  try {
    // 确保目录存在
    const saveDir = path.join(process.cwd(), 'data', 'ai-analysis')
    await fs.mkdir(saveDir, { recursive: true })
    
    // 生成当天文件名
    const date = new Date()
    const dateStr = date.toISOString().split('T')[0]
    const fileName = `ai-analysis-${dateStr}.json`
    const filePath = path.join(saveDir, fileName)
    
    // 读取现有内容或创建新数组
    let records: AIAnalysis[] = []
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8')
      records = JSON.parse(fileContent)
    } catch (error: any) {
      // 文件不存在或解析失败，使用空数组
      if (error.code !== 'ENOENT') {
        console.error('读取AI分析历史文件失败:', error.message)
      }
    }
    
    // 添加新记录并写入文件
    records.push(analysis)
    await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8')
  } catch (error: any) {
    console.error('保存AI分析结果失败:', error.message)
  }
}

/**
 * AI分析服务
 */
export async function analyzeMarketWithAI(
  symbol: string,
  price: number,
  ema20: number,
  ema60: number,
  rsi: number,
  volume: number,
  priceChange24h: number,
  indicators?: TechnicalIndicators,
  config?: BotConfig
): Promise<AIAnalysis> {
  const runtimeConfig = useRuntimeConfig()

  // 检查是否需要执行每日自我学习（后台异步执行，不阻塞当前分析）
  checkDailyLearning().catch(error => {
    console.error('每日学习任务执行失败:', error.message)
  })
  
  // 检查缓存
  const cacheKey = `${symbol}_${Math.floor(Date.now() / (10 * 60 * 1000))}`
  const cached = analysisCache.get(cacheKey)
  
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data
  }

  try {
    // 构建优化的提示词
    const prompt = buildAIPrompt(symbol, price, ema20, ema60, rsi, volume, priceChange24h, indicators, config)
    
    // 构建系统提示词（包含历史学习经验）
    const systemPrompt = await buildSystemPrompt()
    
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
        temperature: 0.5, // 提高温度，允许更多创造性分析
        max_tokens: 1000,
        response_format: { type: "json_object" } // 强制JSON格式输出
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
    // 截断到150字以内
    reasoning = reasoning.length > 150 ? reasoning.slice(0, 147) + '...' : reasoning
    
    const analysis: AIAnalysis = {
      symbol,
      timestamp: Date.now(),
      direction: direction,
      confidence: Math.min(100, Math.max(0, aiResult.confidence || 0)),
      score: Math.min(100, Math.max(0, aiResult.score || 0)),
      riskLevel: (aiResult.riskLevel || 'MEDIUM') as RiskLevel,
      isBullish: direction === 'LONG',
      reasoning: reasoning,
      technicalData: {
        price,
        ema20,
        ema60,
        rsi,
        volume,
        support: aiResult.support,
        resistance: aiResult.resistance,
      },
    }

    // 直接使用AI返回的原始结果，不做任何硬编码调整
    const finalAnalysis = analysis

    // 缓存结果
    analysisCache.set(cacheKey, {
      data: finalAnalysis,
      timestamp: Date.now(),
    })

    // 异步保存到文件，不阻塞主流程
    saveAIAnalysisToFile(finalAnalysis).catch(() => {})

    return finalAnalysis
  } catch (error: any) {
    console.error('AI分析失败:', error.message)
    
    // 返回默认分析结果（降级处理）
    const fallbackAnalysis: AIAnalysis = {
      symbol,
      timestamp: Date.now(),
      direction: 'IDLE',
      confidence: 0,
      score: 0,
      riskLevel: 'HIGH',
      isBullish: false,
      reasoning: `AI分析暂时不可用: ${error.message}`,
      technicalData: {
        price,
        ema20,
        ema60,
        rsi,
        volume,
      },
    }

    // 异步保存到文件，不阻塞主流程
    saveAIAnalysisToFile(fallbackAnalysis).catch(() => {})

    return fallbackAnalysis
  }
}

/**
 * 检查AI分析条件
 */
/**
 * 检查AI分析条件
 * @returns 统一格式的AI检测信号
 */
export function checkAIAnalysisConditions(
  aiAnalysis: AIAnalysis,
  minScore: number,
  minConfidence: number,
  maxRiskLevel: RiskLevel,
  conditionMode: AIConditionMode = 'SCORE_ONLY'
): TradingSignal {
  // 1. 风险等级权重映射（常量提升，只初始化一次）
  const RISK_LEVEL_WEIGHT: Readonly<Record<RiskLevel, number>> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  } as const

  // 2. 收集所有不通过原因
  const failReasons: string[] = []
  const data: Record<string, any> = {
    score: aiAnalysis.score,
    confidence: aiAnalysis.confidence,
    riskLevel: aiAnalysis.riskLevel,
    minScore,
    minConfidence,
    maxRiskLevel,
    conditionMode
  }

  // 3. 逐项校验
  if (aiAnalysis.direction === 'IDLE') {
    failReasons.push('方向为IDLE')
  }

  if (aiAnalysis.score < minScore) {
    failReasons.push(`评分(${aiAnalysis.score}) < ${minScore}`)
  }

  if (conditionMode === 'SCORE_AND_CONFIDENCE' && aiAnalysis.confidence < minConfidence) {
    failReasons.push(`置信度(${aiAnalysis.confidence}) < ${minConfidence}`)
  }

  if (RISK_LEVEL_WEIGHT[aiAnalysis.riskLevel] > RISK_LEVEL_WEIGHT[maxRiskLevel]) {
    failReasons.push(`风险等级(${aiAnalysis.riskLevel}) > ${maxRiskLevel}`)
  }

  // 4. 统一返回结果
  const triggered = failReasons.length === 0
  let direction: 'LONG' | 'SHORT' | null = null
  let reason = ''
  
  if (triggered) {
    direction = aiAnalysis.direction === 'LONG' || aiAnalysis.direction === 'SHORT' ? aiAnalysis.direction : null
    reason = `AI检测通过，方向${direction}，得分${aiAnalysis.score}，置信度${aiAnalysis.confidence}`
  } else {
    direction = null
    reason = `AI检测不通过：${failReasons.join('，')}`
  }

  return {
    type: 'AI',
    triggered,
    direction,
    reason,
    data
  }
}

/**
 * 清除过期缓存
 */
export function clearExpiredCache(maxAge: number = 30 * 60 * 1000): void {
  const now = Date.now()
  for (const [key, cache] of Array.from(analysisCache.entries())) {
    if (now - cache.timestamp > maxAge) {
      analysisCache.delete(key)
    }
  }
}