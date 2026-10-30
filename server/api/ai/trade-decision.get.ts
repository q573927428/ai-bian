// ==================== 按订单关联读取完整入场决策档案 ====================
import { defineEventHandler, getQuery, createError, setResponseHeader } from 'h3'
import { isAnalysisId, isAnalysisMonth, readTradeDecision } from '../../utils/trade-decision-store'

export default defineEventHandler(async event => {
  const { analysisId, month, format, role } = getQuery(event)
  if (!isAnalysisId(analysisId)) throw createError({ statusCode: 400, message: '请提供有效的 analysisId' })
  if (month !== undefined && !isAnalysisMonth(month)) throw createError({ statusCode: 400, message: 'month 必须为 YYYY-MM 格式的有效月份' })
  if (format !== undefined && format !== 'json' && format !== 'text') {
    throw createError({ statusCode: 400, message: 'format 仅支持 json 或 text' })
  }
  if (role !== undefined && role !== 'user' && role !== 'system') {
    throw createError({ statusCode: 400, message: 'role 仅支持 user 或 system' })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  try {
    const data = await readTradeDecision(analysisId, undefined, month)
    if (format === 'text') {
      setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
      return data.messages.filter(message => message.role === (role ?? 'user')).map(message => message.content).join('\n\n')
    }
    return { success: true, data }
  } catch (error: any) {
    throw createError({ statusCode: error.code === 'ENOENT' ? 404 : 500, message: error.code === 'ENOENT' ? '该订单的决策档案不存在' : '交易决策档案读取或校验失败' })
  }
})
