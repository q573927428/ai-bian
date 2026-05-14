// ==================== 历史交易数据分析器 ====================
// 职责：每天定时用 AI 分析历史交易记录，生成结构化学习结果
// 供 AI 分析时作为系统提示词的参考上下文

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { TradeHistory } from '../../types'

// ==================== 类型定义 ====================

export interface LearningResult {
  timestamp: number
  summary: string
  keyPatterns: string[]
  successFactors: string[]
  failureFactors: string[]
  optimizationSuggestions: string[]
}

// ==================== 常量 ====================

const TRADE_HISTORY_PATH = join(process.cwd(), 'data', 'trade-history.json')
const ANALYSIS_RESULT_PATH = join(process.cwd(), 'data', 'trade-history-analysis.json')

let lastAnalysisTime = 0
let cachedAnalysis: LearningResult | null = null

// ==================== 核心方法 ====================

/**
 * 加载历史交易记录
 */
async function loadTradeHistory(): Promise<TradeHistory[]> {
  try {
    const data = await readFile(TRADE_HISTORY_PATH, 'utf-8')
    return JSON.parse(data) as TradeHistory[]
  } catch (error: any) {
    console.warn('[TradeHistoryAnalyzer] 加载历史交易记录失败:', error.message)
    return []
  }
}

/**
 * 保存分析结果到文件
 */
async function saveAnalysisResult(result: LearningResult): Promise<void> {
  try {
    await writeFile(ANALYSIS_RESULT_PATH, JSON.stringify(result, null, 2), 'utf-8')
    cachedAnalysis = result
    lastAnalysisTime = result.timestamp
  } catch (error: any) {
    console.error('[TradeHistoryAnalyzer] 保存分析结果失败:', error.message)
  }
}

/**
 * 执行 AI 历史交易分析
 * 调用 DeepSeek API 分析历史交易数据，生成结构化学习结果
 */
export async function performTradeHistoryAnalysis(): Promise<LearningResult> {
  const trades = await loadTradeHistory()

  if (trades.length === 0) {
    const emptyResult: LearningResult = {
      timestamp: Date.now(),
      summary: '无历史交易数据，无法进行分析',
      keyPatterns: [],
      successFactors: [],
      failureFactors: [],
      optimizationSuggestions: []
    }
    await saveAnalysisResult(emptyResult)
    return emptyResult
  }

  // 只分析最近3个月的交易
  const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recentTrades = trades.filter(t => t.closeTime > threeMonthsAgo)
  const targetTrades = recentTrades.length > 0 ? recentTrades : trades

  // 基础统计
  const totalTrades = targetTrades.length
  const winningTrades = targetTrades.filter(t => t.pnl > 0)
  const losingTrades = targetTrades.filter(t => t.pnl < 0)
  const winCount = winningTrades.length
  const lossCount = losingTrades.length
  const winRate = totalTrades > 0 ? (winCount / totalTrades * 100) : 0
  const totalPnL = targetTrades.reduce((sum, t) => sum + t.pnl, 0)

  // 按策略分组统计
  const strategyStats: Record<string, { total: number; wins: number; pnl: number }> = {}
  for (const t of targetTrades) {
    const sid = t.strategyId || 'unknown'
    if (!strategyStats[sid]) strategyStats[sid] = { total: 0, wins: 0, pnl: 0 }
    strategyStats[sid].total++
    strategyStats[sid].pnl += t.pnl
    if (t.pnl > 0) strategyStats[sid].wins++
  }

  // 按交易对分组统计
  const symbolStats: Record<string, { total: number; wins: number; pnl: number }> = {}
  for (const t of targetTrades) {
    const sym = t.symbol
    if (!symbolStats[sym]) symbolStats[sym] = { total: 0, wins: 0, pnl: 0 }
    symbolStats[sym].total++
    symbolStats[sym].pnl += t.pnl
    if (t.pnl > 0) symbolStats[sym].wins++
  }

  // 按平仓原因分组统计
  const exitStats: Record<string, { total: number; wins: number; pnl: number }> = {}
  for (const t of targetTrades) {
    const reason = t.closeCategory || 'unknown'
    if (!exitStats[reason]) exitStats[reason] = { total: 0, wins: 0, pnl: 0 }
    exitStats[reason].total++
    exitStats[reason].pnl += t.pnl
    if (t.pnl > 0) exitStats[reason].wins++
  }

  // 按方向分组统计
  const directionStats: Record<string, { total: number; wins: number; pnl: number }> = {}
  for (const t of targetTrades) {
    const dir = t.direction || 'UNKNOWN'
    if (!directionStats[dir]) directionStats[dir] = { total: 0, wins: 0, pnl: 0 }
    directionStats[dir].total++
    directionStats[dir].pnl += t.pnl
    if (t.pnl > 0) directionStats[dir].wins++
  }

  try {
    const runtimeConfig = useRuntimeConfig()

    // 构建 AI 分析提示词
    const prompt = `请作为专业的量化交易策略分析师，对以下加密货币期货交易历史数据进行深度分析，总结交易规律，提炼成功和失败的关键因素，并给出优化建议。

## 交易数据概览：
- 总交易数量: ${totalTrades} 笔
- 盈利交易: ${winCount} 笔
- 亏损交易: ${lossCount} 笔
- 胜率: ${winRate.toFixed(2)}%
- 总盈亏: ${totalPnL.toFixed(2)} USDT

## 按策略统计：
${Object.entries(strategyStats).map(([id, s]) =>
  `- ${id}: ${s.total}笔, 胜率${(s.total > 0 ? s.wins / s.total * 100 : 0).toFixed(1)}%, 盈亏${s.pnl.toFixed(2)}USDT`
).join('\n')}

## 按交易对统计：
${Object.entries(symbolStats).map(([sym, s]) =>
  `- ${sym}: ${s.total}笔, 胜率${(s.total > 0 ? s.wins / s.total * 100 : 0).toFixed(1)}%, 盈亏${s.pnl.toFixed(2)}USDT`
).join('\n')}

## 按平仓原因统计：
${Object.entries(exitStats).map(([reason, s]) =>
  `- ${reason}: ${s.total}笔, 胜率${(s.total > 0 ? s.wins / s.total * 100 : 0).toFixed(1)}%, 盈亏${s.pnl.toFixed(2)}USDT`
).join('\n')}

## 按方向统计：
${Object.entries(directionStats).map(([dir, s]) =>
  `- ${dir}: ${s.total}笔, 胜率${(s.total > 0 ? s.wins / s.total * 100 : 0).toFixed(1)}%, 盈亏${s.pnl.toFixed(2)}USDT`
).join('\n')}

## 最近20笔交易详情：
${JSON.stringify(targetTrades.slice(-20).map(trade => ({
  symbol: trade.symbol,
  direction: trade.direction,
  pnl: Number(trade.pnl.toFixed(2)),
  pnlPercentage: Number(trade.pnlPercentage.toFixed(2)),
  exitReason: trade.closeCategory || 'unknown',
  entryRSI: trade.entryIndicators?.RSI,
  entryADX: trade.entryIndicators?.ADX,
  entryConfidence: trade.entryConfidence,
  entryScore: trade.entryScore,
  entryRiskLevel: trade.entryRiskLevel,
  holdingMinutes: trade.holdingMinutes
})), null, 2)}

## 分析要求：
1. 总结成功交易（盈利>0）的共同特征和关键因素
2. 总结失败交易（亏损<0）的共同特征和关键风险点
3. 发现可重复的高胜率交易模式
4. 识别需要避免的高风险交易模式
5. 给出具体的交易策略优化建议

## 输出格式要求：
请以严格的JSON格式回复，包含以下字段：
{
  "summary": "整体分析总结（200字以内）",
  "keyPatterns": ["重复出现的交易模式1", "重复出现的交易模式2", "重复出现的交易模式3"],
  "successFactors": ["成功交易的关键因素1", "成功交易的关键因素2", "成功交易的关键因素3"],
  "failureFactors": ["失败交易的关键因素1", "失败交易的关键因素2", "失败交易的关键因素3"],
  "optimizationSuggestions": ["具体优化建议1", "具体优化建议2", "具体优化建议3"]
}

注意：每个数组必须且只能包含3个元素，不要多也不要少。

请确保输出是完全有效的JSON格式，不要包含任何其他文本内容。`

    // 调用 DeepSeek API 进行学习分析
    const response = await fetch(`${runtimeConfig.deepseekApiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${runtimeConfig.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
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
        response_format: { type: 'json_object' }
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

    // 辅助函数：确保数组不超过3个元素
    const limitArrayLength = (arr: unknown): string[] => {
      if (!Array.isArray(arr)) return []
      return arr.slice(0, 3)
    }

    const finalResult: LearningResult = {
      timestamp: Date.now(),
      summary: learningResult.summary || '分析完成',
      keyPatterns: limitArrayLength(learningResult.keyPatterns),
      successFactors: limitArrayLength(learningResult.successFactors),
      failureFactors: limitArrayLength(learningResult.failureFactors),
      optimizationSuggestions: limitArrayLength(learningResult.optimizationSuggestions)
    }

    // 保存分析结果
    await saveAnalysisResult(finalResult)

    return finalResult
  } catch (error: any) {
    console.error('[TradeHistoryAnalyzer] AI分析失败:', error.message)

    // 降级处理：返回基于统计的简单分析
    const fallbackResult: LearningResult = {
      timestamp: Date.now(),
      summary: `基于${totalTrades}笔交易统计：胜率${winRate.toFixed(1)}%，总盈亏${totalPnL.toFixed(2)}USDT。AI深度分析暂不可用，以上为基础统计数据。`,
      keyPatterns: [],
      successFactors: [],
      failureFactors: [],
      optimizationSuggestions: ['等待AI服务恢复后重新分析']
    }
    await saveAnalysisResult(fallbackResult)
    return fallbackResult
  }
}

/**
 * 检查是否需要执行每日分析（每天凌晨2点执行一次）
 * 返回 true 表示已执行分析，false 表示未到执行时间
 */
export async function checkDailyAnalysis(): Promise<boolean> {
  const now = Date.now()
  const lastDate = new Date(lastAnalysisTime).toDateString()
  const currentDate = new Date(now).toDateString()
  const currentHour = new Date(now).getHours()

  // 每天凌晨2点到4点之间执行一次
  if (lastDate !== currentDate && currentHour >= 2 && currentHour < 4) {
    await performTradeHistoryAnalysis()
    return true
  }

  return false
}

/**
 * 获取最新的分析结果（从缓存或文件读取）
 */
export async function getLatestAnalysis(): Promise<LearningResult | null> {
  // 优先返回缓存
  if (cachedAnalysis) {
    return cachedAnalysis
  }

  // 从文件读取
  try {
    if (!existsSync(ANALYSIS_RESULT_PATH)) {
      return null
    }
    const data = await readFile(ANALYSIS_RESULT_PATH, 'utf-8')
    const result = JSON.parse(data) as LearningResult
    cachedAnalysis = result
    lastAnalysisTime = result.timestamp
    return result
  } catch (error: any) {
    console.warn('[TradeHistoryAnalyzer] 读取分析结果失败:', error.message)
    return null
  }
}

/**
 * 格式化分析结果为提示词文本
 */
export function formatAnalysisToPromptSection(analysis: LearningResult): string {
  const lines: string[] = []
  lines.push('')
  lines.push('【历史交易学习经验（基于历史数据分析，仅供参考）】')
  lines.push(`- ${analysis.summary}`)

  if (analysis.keyPatterns.length > 0) {
    lines.push('- 关键交易模式:')
    for (const p of analysis.keyPatterns) {
      lines.push(`  * ${p}`)
    }
  }

  if (analysis.successFactors.length > 0) {
    lines.push('- 成功交易因素:')
    for (const f of analysis.successFactors) {
      lines.push(`  * ${f}`)
    }
  }

  if (analysis.failureFactors.length > 0) {
    lines.push('- 失败交易因素:')
    for (const f of analysis.failureFactors) {
      lines.push(`  * ${f}`)
    }
  }

  if (analysis.optimizationSuggestions.length > 0) {
    lines.push('- 优化建议:')
    for (const s of analysis.optimizationSuggestions) {
      lines.push(`  * ${s}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
