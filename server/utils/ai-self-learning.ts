import fs from 'fs/promises'
import path from 'path'
import type { StrategyAnalysisMetrics } from '../../types'

interface LearningResult {
  timestamp: number
  summary: string
  keyPatterns: string[]
  successFactors: string[]
  failureFactors: string[]
  optimizationSuggestions: string[]
}

const LEARNING_DATA_PATH = path.join(process.cwd(), 'data', 'strategy-analysis.json')
const LEARNING_RESULT_PATH = path.join(process.cwd(), 'data', 'ai-learning-result.json')

let lastLearningTime = 0
let cachedLearningResult: LearningResult | null = null

/**
 * 读取历史交易分析数据
 */
async function loadHistoricalData(): Promise<StrategyAnalysisMetrics[]> {
  try {
    const data = await fs.readFile(LEARNING_DATA_PATH, 'utf-8')
    return JSON.parse(data) as StrategyAnalysisMetrics[]
  } catch (error: any) {
    console.error('加载历史交易数据失败:', error.message)
    return []
  }
}

/**
 * 保存AI学习结果
 */
async function saveLearningResult(result: LearningResult): Promise<void> {
  try {
    await fs.writeFile(LEARNING_RESULT_PATH, JSON.stringify(result, null, 2), 'utf-8')
    cachedLearningResult = result
    lastLearningTime = result.timestamp
  } catch (error: any) {
    console.error('保存学习结果失败:', error.message)
  }
}

/**
 * 执行AI自我学习分析
 */
export async function performSelfLearning(): Promise<LearningResult> {
  const runtimeConfig = useRuntimeConfig()
  const historicalData = await loadHistoricalData()

  if (historicalData.length === 0) {
    return {
      timestamp: Date.now(),
      summary: '无历史交易数据，无法进行学习分析',
      keyPatterns: [],
      successFactors: [],
      failureFactors: [],
      optimizationSuggestions: []
    }
  }

  // 只分析最近3个月的交易数据
  const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recentTrades = historicalData.filter(trade => trade.openTime > threeMonthsAgo)

  if (recentTrades.length === 0) {
    return {
      timestamp: Date.now(),
      summary: '最近3个月无交易数据，无法进行学习分析',
      keyPatterns: [],
      successFactors: [],
      failureFactors: [],
      optimizationSuggestions: []
    }
  }

  try {
    // 构建学习分析提示词
    const prompt = `请作为专业的量化交易策略分析师，对以下加密货币期货交易历史数据进行深度分析，总结交易规律，提炼成功和失败的关键因素，并给出优化建议。

## 交易数据概览：
- 总交易数量: ${recentTrades.length} 笔
- 盈利交易: ${recentTrades.filter(t => t.pnl > 0).length} 笔
- 亏损交易: ${recentTrades.filter(t => t.pnl < 0).length} 笔
- 胜率: ${(recentTrades.filter(t => t.pnl > 0).length / recentTrades.length * 100).toFixed(2)}%
- 总盈亏: ${recentTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)} USDT
- 平均盈亏比: ${(recentTrades.reduce((sum, t) => sum + Math.max(0, t.riskRewardRatio), 0) / Math.max(1, recentTrades.filter(t => t.riskRewardRatio > 0).length)).toFixed(2)}

## 最近20笔交易详情：
${JSON.stringify(recentTrades.slice(-20).map(trade => ({
  symbol: trade.symbol,
  direction: trade.direction,
  pnl: trade.pnl.toFixed(2),
  pnlPercentage: trade.pnlPercentage.toFixed(2),
  exitReason: trade.exitReasonCategory,
  entryRSI: trade.entryRSI,
  entryADX15m: trade.entryADX15m.toFixed(2),
  entryADX1h: trade.entryADX1h.toFixed(2),
  entryADX4h: trade.entryADX4h.toFixed(2),
  riskRewardRatio: trade.riskRewardRatio.toFixed(2),
  aiScore: trade.aiScore,
  aiConfidence: trade.aiConfidence,
  aiRiskLevel: trade.aiRiskLevel
})), null, 2)}

## 分析要求：
1. 总结成功交易（盈利>0）的共同特征和关键因素
2. 总结失败交易（亏损<0）的共同特征和关键风险点
3. 发现可重复的高胜率交易模式
4. 识别需要避免的高风险交易模式
5. 给出具体的交易策略优化建议
6. 针对AI分析部分，给出如何提高AI预测准确性的建议

## 输出格式要求：
请以严格的JSON格式回复，包含以下字段：
{
  "summary": "整体分析总结（200字以内）",
  "keyPatterns": ["重复出现的交易模式1", "重复出现的交易模式2"],
  "successFactors": ["成功交易的关键因素1", "成功交易的关键因素2"],
  "failureFactors": ["失败交易的关键因素1", "失败交易的关键因素2"],
  "optimizationSuggestions": ["具体优化建议1", "具体优化建议2"]
}

请确保输出是完全有效的JSON格式，不要包含任何其他文本内容。`

    // 调用DeepSeek API进行学习分析
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
            content: '你是一位专业的量化交易策略分析师，擅长从历史交易数据中总结规律，提炼有效的交易策略。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      }),
    })

    if (!response.ok) {
      throw new Error(`DeepSeek API请求失败: ${response.statusText}`)
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content || '{}'

    // 提取JSON内容
    let jsonContent = content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      jsonContent = jsonMatch[1]
    }

    const learningResult = JSON.parse(jsonContent) as Omit<LearningResult, 'timestamp'>

    const finalResult: LearningResult = {
      timestamp: Date.now(),
      summary: learningResult.summary || '分析完成',
      keyPatterns: Array.isArray(learningResult.keyPatterns) ? learningResult.keyPatterns : [],
      successFactors: Array.isArray(learningResult.successFactors) ? learningResult.successFactors : [],
      failureFactors: Array.isArray(learningResult.failureFactors) ? learningResult.failureFactors : [],
      optimizationSuggestions: Array.isArray(learningResult.optimizationSuggestions) ? learningResult.optimizationSuggestions : []
    }

    // 保存学习结果
    await saveLearningResult(finalResult)

    return finalResult
  } catch (error: any) {
    console.error('AI自我学习失败:', error.message)
    return {
      timestamp: Date.now(),
      summary: `自我学习失败: ${error.message}`,
      keyPatterns: [],
      successFactors: [],
      failureFactors: [],
      optimizationSuggestions: []
    }
  }
}

/**
 * 检查是否需要执行每日学习（每天凌晨2点执行一次）
 */
export async function checkDailyLearning(): Promise<LearningResult | null> {
  const now = Date.now()
  const lastLearningDate = new Date(lastLearningTime).toDateString()
  const currentDate = new Date(now).toDateString()
  const currentHour = new Date(now).getHours()

  // 每天凌晨2点到4点之间执行一次
  if (lastLearningDate !== currentDate && currentHour >= 2 && currentHour < 4) {
    return await performSelfLearning()
  }

  return null
}

/**
 * 获取最新的学习结果
 */
export async function getLatestLearningResult(): Promise<LearningResult | null> {
  if (cachedLearningResult) {
    return cachedLearningResult
  }

  try {
    const data = await fs.readFile(LEARNING_RESULT_PATH, 'utf-8')
    const result = JSON.parse(data) as LearningResult
    cachedLearningResult = result
    lastLearningTime = result.timestamp
    return result
  } catch (error: any) {
    console.error('读取学习结果失败:', error.message)
    return null
  }
}