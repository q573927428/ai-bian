// ==================== 按分析记录引用读取持久化策略规则 ====================
import { defineEventHandler, getQuery, createError, setResponseHeader } from 'h3'
import { readAIRules } from '../../utils/ai-rules-store'

export default defineEventHandler(async event => {
  const { rulesHash, format } = getQuery(event)
  if (typeof rulesHash !== 'string' || !/^[a-f0-9]{64}$/.test(rulesHash)) {
    throw createError({ statusCode: 400, message: '请提供64位小写十六进制 rulesHash' })
  }
  if (format !== undefined && format !== 'json' && format !== 'text') {
    throw createError({ statusCode: 400, message: 'format 仅支持 json 或 text' })
  }
  try {
    const data = await readAIRules(rulesHash)
    // 纯文本便于浏览器直接查看规则并保留换行；明确类型避免规则内容被当成 HTML。
    if (format === 'text') {
      setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
      setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
      return data.userPrompt
    }
    return { success: true, data }
  } catch (error: any) {
    throw createError({ statusCode: error.code === 'ENOENT' ? 404 : 500, message: error.code === 'ENOENT' ? '未找到对应规则文件' : '规则文件读取或校验失败' })
  }
})
