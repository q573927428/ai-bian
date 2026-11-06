// ==================== 敏感操作密码与 24 小时签名凭证 ====================
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, deleteCookie, getCookie, getRequestHeader, getRequestURL, setCookie, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'

const TTL = 24 * 60 * 60
const buckets = new Map<string, { count: number; until: number }>()

/** 优先读取运行时密码；显式空值也必须覆盖旧构建配置，确保清空密码不会意外放行。 */
export function operationPassword(event: H3Event): string {
  return String(process.env.CONFIG_EDIT_PASSWORD ?? useRuntimeConfig(event).configEditPassword ?? '')
}

/** 本地开发允许 HTTP；生产使用 Host Cookie，防止其他子域覆盖管理凭证。 */
function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' }
}

function cookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-operation_auth' : 'operation_auth_dev'
}

/** 固定长度摘要比较避免凭证长度和逐字符比较泄露。 */
export function matchesOperationPassword(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(actual), digest(expected))
}

/** 专用用途派生，修改操作密码即撤销所有旧 Cookie，不额外存储会话。 */
function signature(payload: string, password: string): string {
  const key = createHmac('sha256', password).update('ai-bian/operation-auth/key/v1').digest()
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** 每次从 Cookie 和当前密码验证，不相信前端状态或调用方自行设置的 context。 */
export function operationSession(event: H3Event): { expiresAt: number } | null {
  const password = operationPassword(event)
  const token = getCookie(event, cookieName()) || ''
  if (!password || token.length > 256) return null
  const match = /^v1\.(\d{13})\.(\d{13})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return null
  const [, issued, expires, , signed] = match
  const now = Date.now()
  if (Number(issued) > now || Number(expires) - Number(issued) !== TTL * 1000 || Number(expires) <= now) return null
  if (!matchesOperationPassword(signed!, signature(token.slice(0, token.lastIndexOf('.')), password))) return null
  return { expiresAt: Number(expires) }
}

/** 设置固定 24 小时期限，普通请求不续期；返回时间仅用于界面清理。 */
export function issueOperationSession(event: H3Event): number {
  const password = operationPassword(event)
  if (!password) throw createError({ statusCode: 503, message: '请先配置 CONFIG_EDIT_PASSWORD，敏感操作暂不可用' })
  const now = Date.now()
  const expiresAt = now + TTL * 1000
  const payload = `v1.${now}.${expiresAt}.${randomBytes(24).toString('base64url')}`
  setCookie(event, cookieName(), `${payload}.${signature(payload, password)}`, {
    ...cookieOptions(), maxAge: TTL, expires: new Date(expiresAt),
  })
  return expiresAt
}

/** 清除当前浏览器凭证；其他设备撤销通过修改密码完成。 */
export function clearOperationSession(event: H3Event): void {
  deleteCookie(event, cookieName(), cookieOptions())
}

/** 私人响应禁止缓存，避免解锁内容经代理或浏览器缓存暴露给匿名请求。 */
export function privateOperationResponse(event: H3Event): void {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Vary', 'Cookie')
}

/** 按可信连接地址或签名 Cookie 限流，不信任客户端传入的 X-Forwarded-For。 */
export function limitOperationRequests(event: H3Event, scope: 'login' | 'write'): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key)
  const identity = scope === 'login'
    ? event.node.req.socket.remoteAddress || 'unknown'
    : createHash('sha256').update(getCookie(event, cookieName()) || '').digest('hex')
  const key = `${scope}:${identity}`
  const bucket = buckets.get(key)
  const limit = scope === 'login' ? 10 : 120
  if ((bucket && bucket.count >= limit) || (!bucket && buckets.size >= 10_000)) {
    setResponseHeader(event, 'Retry-After', Math.max(1, Math.ceil(((bucket?.until ?? now + 60_000) - now) / 1000)))
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后重试' })
  }
  buckets.set(key, { count: (bucket?.count || 0) + 1, until: bucket?.until ?? now + 60_000 })
}

/** 写请求必须来自配置的站点；生产不根据不可信 Host/转发头推导允许来源。 */
export function assertOperationOrigin(event: H3Event): void {
  const configured = process.env.OPERATION_AUTH_ORIGIN || ''
  const production = process.env.NODE_ENV === 'production'
  // 开发时共用 .env 很常见：本机访问按实际同源验证，不能被其中的线上域名误拦。
  // 禁用转发头推导，且只对回环主机提供这一兼容，生产始终使用显式配置。
  const requestURL = getRequestURL(event, { xForwardedHost: false, xForwardedProto: false })
  const localDevelopment = !production && ['localhost', '127.0.0.1', '[::1]'].includes(requestURL.hostname)
  const source = localDevelopment ? requestURL.origin : configured || (!production ? requestURL.origin : '')
  let expected: string
  try {
    const url = new URL(source)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (production && url.protocol !== 'https:')
      || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid origin')
    expected = url.origin
  } catch {
    throw createError({ statusCode: 503, message: '请配置 OPERATION_AUTH_ORIGIN 为网站 HTTPS 来源' })
  }
  if (getRequestHeader(event, 'origin') !== expected || getRequestHeader(event, 'sec-fetch-site') === 'cross-site') {
    throw createError({ statusCode: 403, message: '不允许跨站或缺少来源的敏感请求' })
  }
}

/** 在读取和缓存请求体时限制实际字节数，覆盖 chunked 请求而非只相信 Content-Length。 */
export async function readOperationBody(event: H3Event, maxBytes: number): Promise<void> {
  const req = event.node.req
  if (Number(getRequestHeader(event, 'content-length')) > maxBytes) {
    throw createError({ statusCode: 413, message: '请求内容过大' })
  }
  const hasBody = Number(getRequestHeader(event, 'content-length')) > 0 || !!getRequestHeader(event, 'transfer-encoding')
  if (!hasBody && event.method === 'DELETE') return
  if (!/^application\/json(?:\s*;|$)/i.test(getRequestHeader(event, 'content-type') || '')
    || getRequestHeader(event, 'content-encoding')) {
    throw createError({ statusCode: 415, message: '敏感请求仅接受未压缩的 application/json' })
  }
  const chunks: Buffer[] = []
  let size = 0
  const body = await new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', onData).off('end', onEnd).off('error', onError).off('aborted', onAborted)
    }
    const fail = (statusCode: number, message: string) => {
      cleanup()
      req.pause()
      setResponseHeader(event, 'Connection', 'close')
      reject(createError({ statusCode, message }))
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) fail(413, '请求内容过大')
      else chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    const onError = () => fail(400, '请求读取失败')
    const onAborted = () => fail(400, '请求已中断')
    const timer = setTimeout(() => fail(408, '请求读取超时'), 10_000)
    req.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted)
    if (req.readableEnded) onEnd()
  })
  // h3 原生请求体缓存：业务路由继续使用 readBody，不再次读取已消费的流。
  ;(req as typeof req & { rawBody?: Buffer }).rawBody = body
  try { JSON.parse(body.toString('utf8')) } catch {
    throw createError({ statusCode: 400, message: '请求内容不是有效 JSON' })
  }
}
