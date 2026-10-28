// ==================== 有效 AI 提示词缓存目录（不返回正文） ====================
import { defineEventHandler, setResponseHeader } from 'h3'
import { aiPromptCache } from '../../utils/ai-prompt-cache'

export default defineEventHandler(event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { success: true, data: aiPromptCache.list(), serverTime: Date.now() }
})
