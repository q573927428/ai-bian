// ==================== 管理员登录与浏览器凭证签发 ====================
import { createError, defineEventHandler, readBody } from 'h3'
import { issueOperationSession, matchesOperationPassword, operationPassword, operationUsername } from '../../utils/operation-auth'

export default defineEventHandler(async event => {
  const expected = operationPassword(event)
  const username = operationUsername()
  if (!username || !expected) throw createError({ statusCode: 503, message: '请先配置 CONFIG_EDIT_USERNAME 和 CONFIG_EDIT_PASSWORD，登录暂不可用' })
  const body = await readBody(event)
  // 对两项分别校验并统一报错，避免透露账号是否存在；旧版仅传密码的请求不再放行。
  const validUsername = typeof body?.username === 'string' && matchesOperationPassword(body.username.trim(), username)
  const validPassword = typeof body?.password === 'string' && matchesOperationPassword(body.password, expected)
  if (!validUsername || !validPassword) {
    // h3 在生产环境隐藏内部 message，将可公开的统一提示放入 data。
    throw createError({ statusCode: 401, message: '账号或密码错误', data: { message: '账号或密码错误' } })
  }
  return { success: true, verified: true, expiresAt: issueOperationSession(event), message: '登录成功，24 小时内无需重复登录' }
})
