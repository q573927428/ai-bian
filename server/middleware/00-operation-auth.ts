// ==================== 普通浏览放行与敏感 API 统一门禁 ====================
import { createError, defineEventHandler, getRequestURL } from 'h3'
import { assertOperationOrigin, limitOperationRequests, operationPassword, operationSession, operationUsername, privateOperationResponse, readOperationBody } from '../utils/operation-auth'

/** 同时保护 GET 和 HEAD；详情、日志、档案不能从替代只读入口泄露。 */
const sensitiveReads = [
  /^\/api\/strategies\/[^/]+(?:\/.*)?$/,
  /^\/api\/bot\/(?:config|history)(?:\/.*)?$/,
  /^\/api\/ai\/(?:prompt|prompts|rules|trade-decision)$/,
  /^\/api\/scripts(?:\/.*)?$/,
  /^\/api\/scan-results$/,
]

/** 所有 API 写方法默认受保护，新写接口无需额外登记；验证失败不进入交易业务。 */
export default defineEventHandler(async event => {
  const rawPath = getRequestURL(event).pathname
  let path: string
  try { path = decodeURIComponent(rawPath).replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase() } catch {
    throw createError({ statusCode: 400, message: '无效的请求路径' })
  }
  if (path !== '/api' && !path.startsWith('/api/')) return
  privateOperationResponse(event)
  const read = event.method === 'GET' || event.method === 'HEAD'
  if (read) {
    if (!sensitiveReads.some(pattern => pattern.test(path))) return
  } else {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
      throw createError({ statusCode: 405, message: '不支持的 API 请求方法' })
    }
    assertOperationOrigin(event)
    // 登录只豁免凭证检查，不豁免来源、请求大小和猜密码限流。
    if (path === '/api/bot/check-password' && event.method === 'POST') {
      limitOperationRequests(event, 'login')
      await readOperationBody(event, 4096)
      return
    }
    // 退出允许已过期的浏览器清理 Cookie，同样必须通过来源检查。
    if (path === '/api/bot/lock' && event.method === 'POST') {
      await readOperationBody(event, 4096)
      return
    }
  }
  if (!operationUsername() || !operationPassword(event)) throw createError({ statusCode: 503, message: '请先配置 CONFIG_EDIT_USERNAME 和 CONFIG_EDIT_PASSWORD，敏感操作暂不可用' })
  if (!operationSession(event)) throw createError({ statusCode: 401, message: '请先使用账号和密码登录，登录状态保留 24 小时' })
  if (!read) {
    limitOperationRequests(event, 'write')
    await readOperationBody(event, 1024 * 1024)
  }
})
