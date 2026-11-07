// ==================== 查询服务端敏感操作解锁状态 ====================
import { defineEventHandler } from 'h3'
import { operationPassword, operationSession, operationUsername } from '../../utils/operation-auth'

export default defineEventHandler(event => {
  const session = operationSession(event)
  return { success: true, requiresPassword: true, configured: !!operationUsername() && !!operationPassword(event), verified: !!session, expiresAt: session?.expiresAt ?? null }
})
