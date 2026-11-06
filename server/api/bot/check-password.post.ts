// ==================== 操作密码验证与浏览器凭证签发 ====================
import { createError, defineEventHandler, readBody } from 'h3'
import { issueOperationSession, matchesOperationPassword, operationPassword } from '../../utils/operation-auth'

export default defineEventHandler(async event => {
  const expected = operationPassword(event)
  if (!expected) throw createError({ statusCode: 503, message: '请先配置 CONFIG_EDIT_PASSWORD，敏感操作暂不可用' })
  const body = await readBody(event)
  if (typeof body?.password !== 'string' || !matchesOperationPassword(body.password, expected)) {
    throw createError({ statusCode: 401, message: '操作密码错误' })
  }
  return { success: true, verified: true, expiresAt: issueOperationSession(event), message: '已解锁，24 小时内无需重复输入' }
})
