// ==================== 查询某次 AI 分析的实际请求提示词（仅短期内存） ====================
import { defineEventHandler, getQuery, createError, setResponseHeader } from 'h3'
import { aiPromptCache } from '../../utils/ai-prompt-cache'

export default defineEventHandler(event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const strategyId = typeof query.strategyId === 'string' ? query.strategyId.trim() : ''
  const symbol = typeof query.symbol === 'string' ? query.symbol.trim() : ''
  const timestamp = query.timestamp === undefined ? undefined : Number(query.timestamp)
  const format = query.format ?? 'json'
  const role = query.role ?? 'user'
  if ((format !== 'json' && format !== 'text') || (role !== 'user' && role !== 'system')) {
    throw createError({ statusCode: 400, message: 'format 仅支持 json 或 text；role 仅支持 user 或 system' })
  }
  if (!strategyId || !symbol || (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp <= 0))) {
    throw createError({ statusCode: 400, message: '请提供 strategyId、symbol；timestamp 可选，须为分析记录中的毫秒时间戳' })
  }
  const data = aiPromptCache.get(strategyId, symbol, timestamp)
  if (!data) {
    throw createError({ statusCode: 404, message: '未找到该分析的提示词：仅保留当前进程最近30分钟、最多100条、总计4MiB；重启或淘汰后无法恢复，旧记录不支持查询' })
  }
  // 纯文本模式仅展示选定消息正文，保留换行，禁止浏览器将提示词解释为 HTML。
  if (format === 'text') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
    return data.messages.filter(message => message.role === role).map(message => message.content).join('\n\n')
  }
  return { success: true, data }
})
