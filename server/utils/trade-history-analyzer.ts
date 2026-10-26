// ==================== 历史交易数据分析器 ====================
// 职责：每天定时用 AI 分析历史交易记录，生成结构化学习结果
// 供 AI 分析时作为系统提示词的参考上下文

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { logger } from './logger'
import type { TradeHistory } from '../../types'
import { readTradeHistoryFiles } from './trade-history-files'

// ==================== 类型定义 ====================

/** 历史交易学习结果，包含统计总结及供后续交易分析参考的经验。 */
export interface LearningResult {
  timestamp: number
  summary: string
  keyPatterns: string[]
  successFactors: string[]
  failureFactors: string[]
  optimizationSuggestions: string[]
}

// ==================== 常量 ====================

const ANALYSIS_RESULT_PATH = join(process.cwd(), 'data', 'trade-history-analysis.json')

let lastAnalysisTime = 0
let cachedAnalysis: LearningResult | null = null
// 防止凌晨窗口内多个并发请求重复启动分析；Promise 代表当前正在执行的唯一一次分析。
let dailyAnalysisInFlight: Promise<LearningResult> | null = null
let dailyAnalysisTimer: ReturnType<typeof setTimeout> | null = null

// ==================== 核心方法 ====================

/**
 * 加载历史交易记录
 */
async function loadTradeHistory(): Promise<TradeHistory[]> {
  try {
    return readTradeHistoryFiles()
  } catch (error: any) {
    console.warn('[TradeHistoryAnalyzer] 加载历史交易记录失败:', error.message)
    return []
  }
}

/**
 * 保存分析结果到文件（增量追加，保留所有历史记录）
 */
async function saveAnalysisResult(result: LearningResult): Promise<void> {
  try {
    let records: LearningResult[] = []
    if (existsSync(ANALYSIS_RESULT_PATH)) {
      const data = await readFile(ANALYSIS_RESULT_PATH, 'utf-8')
      const parsed = JSON.parse(data)
      records = Array.isArray(parsed) ? parsed : [parsed]
    }
    records.push(result)
    await writeFile(ANALYSIS_RESULT_PATH, JSON.stringify(records, null, 2), 'utf-8')
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

  // 仅记录响应元数据，不记录密钥、完整提示词或模型推理内容。
  const responseDiagnostics: Record<string, unknown> = {}
  try {
    const runtimeConfig = useRuntimeConfig()
    if (!runtimeConfig.deepseekApiKey) throw new Error('DeepSeek API Key 未配置')
    const model = runtimeConfig.deepseekModel || 'deepseek-flash'
    responseDiagnostics.model = model

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
        model,
        // 历史分析只需结构化结论；默认思考会耗尽 2000 token，导致正文为空。
        thinking: { type: 'enabled' },
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
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(120_000),
    })

    responseDiagnostics.status = response.status
    if (!response.ok) {
      throw new Error(`DeepSeek API请求失败: HTTP ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    const choice = result.choices?.[0]
    const content = choice?.message?.content
    responseDiagnostics.finishReason = choice?.finish_reason
    responseDiagnostics.usage = result.usage
    responseDiagnostics.contentLength = typeof content === 'string' ? content.length : 0
    // 明确区分额度耗尽和空正文，避免用 '{}' 掩盖真正失败原因。
    if (choice?.finish_reason === 'length') throw new Error('AI分析输出被截断：token额度已耗尽')
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI分析返回正文为空')

    // 提取JSON内容
    let jsonContent = content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
    // 匹配成功不保证索引项在类型上存在，先校验捕获组再赋值。
    if (jsonMatch && typeof jsonMatch[1] === 'string') {
      jsonContent = jsonMatch[1]
    }

    const learningResult = JSON.parse(jsonContent) as Partial<Omit<LearningResult, 'timestamp'>>

    // AI 返回可解析 JSON 不代表内容符合分析协议；缺字段时必须走降级逻辑，
    // 不能把“分析完成 + 空数组”当成有效结果写入历史文件。
    if (!learningResult || typeof learningResult.summary !== 'string' || !learningResult.summary.trim()
      || !Array.isArray(learningResult.keyPatterns)
      || !Array.isArray(learningResult.successFactors)
      || !Array.isArray(learningResult.failureFactors)
      || !Array.isArray(learningResult.optimizationSuggestions)) {
      throw new Error('AI分析结果字段不完整')
    }

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
    logger.error('TradeHistoryAnalyzer', `AI分析失败: ${error.message}`, responseDiagnostics)

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

  // 进程重启后内存中的 lastAnalysisTime 会丢失，先从文件恢复最新记录，
  // 否则凌晨 2~4 点启动服务时会把当天再次分析一遍。
  if (lastAnalysisTime === 0) {
    await getLatestAnalysis()
  }

  // 多个交易请求可能同时进入这里；只有第一个请求可以创建分析任务。
  if (dailyAnalysisInFlight) {
    return false
  }

  const lastDate = new Date(lastAnalysisTime).toDateString()
  const currentDate = new Date(now).toDateString()
  const currentHour = new Date(now).getHours()

  // 每天凌晨2点到4点之间执行一次
  if (lastDate !== currentDate && currentHour >= 2 && currentHour < 4) {
    const analysisPromise = performTradeHistoryAnalysis()
    dailyAnalysisInFlight = analysisPromise
    try {
      await analysisPromise
    } finally {
      // 无论成功或失败都释放锁，允许后续日期继续分析。
      dailyAnalysisInFlight = null
    }
    return true
  }

  return false
}

/**
 * 启动独立的每日分析调度器。任务不再依赖交易请求触发，
 * 每天北京时间 02:05 执行一次，执行结束后安排下一天。
 */
export function startDailyAnalysisScheduler(): void {
  if (dailyAnalysisTimer) return

  const scheduleNext = () => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(2, 5, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    dailyAnalysisTimer = setTimeout(async () => {
      dailyAnalysisTimer = null
      try {
        await checkDailyAnalysis()
      } catch (error: any) {
        console.error('[TradeHistoryAnalyzer] 定时分析失败:', error?.message || error)
      } finally {
        scheduleNext()
      }
    }, Math.max(1000, next.getTime() - now.getTime()))
    dailyAnalysisTimer.unref?.()
  }

  scheduleNext()
}

export function stopDailyAnalysisScheduler(): void {
  if (dailyAnalysisTimer) {
    clearTimeout(dailyAnalysisTimer)
    dailyAnalysisTimer = null
  }
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
    const parsed = JSON.parse(data)
    const records: LearningResult[] = Array.isArray(parsed) ? parsed : [parsed]
    const latest = records[records.length - 1] ?? null
    cachedAnalysis = latest
    lastAnalysisTime = latest?.timestamp ?? 0
    return latest
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
