// ==================== 当前浏览器敏感操作锁定 ====================
import { defineEventHandler } from 'h3'
import { clearOperationSession } from '../../utils/operation-auth'

export default defineEventHandler(event => {
  clearOperationSession(event)
  return { success: true }
})
