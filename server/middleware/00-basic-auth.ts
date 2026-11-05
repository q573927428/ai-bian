// ==================== 整站 HTTP Basic Auth 访问保护 ====================
import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader, setResponseHeader } from 'h3'

/** 使用固定长度摘要比较凭证，避免长度差异导致异常或直接逐字符比较。 */
function matchesCredential(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(actual), digest(expected))
}

/** 所有页面与 API 共用服务端门禁；生产环境未配置凭证时拒绝访问。 */
export default defineEventHandler(event => {
  const username = process.env.BASIC_AUTH_USERNAME || ''
  const password = process.env.BASIC_AUTH_PASSWORD || ''

  // 本地开发可不配置；一旦配置任意一项也必须完整验证，避免半配置意外放行。
  if (process.env.NODE_ENV !== 'production' && !username && !password) return

  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  if (!username || username.includes(':') || !password) {
    throw createError({ statusCode: 503, message: '访问保护未完成配置，请联系管理员' })
  }

  const authorization = getRequestHeader(event, 'authorization') || ''
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  if (match && authorization.length <= 8192) {
    const credential = Buffer.from(match[1]!, 'base64').toString('utf8')
    const separator = credential.indexOf(':')
    if (separator >= 0) {
      const validUser = matchesCredential(credential.slice(0, separator), username)
      const validPassword = matchesCredential(credential.slice(separator + 1), password)
      if (validUser && validPassword) return
    }
  }

  // 返回标准挑战，由浏览器弹出账号密码框；API 请求同样不能绕过。
  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="Private", charset="UTF-8"')
  throw createError({ statusCode: 401, message: '请验证访问账号和密码' })
})
