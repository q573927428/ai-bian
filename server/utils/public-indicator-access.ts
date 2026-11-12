// ==================== 公开指标请求限流与共享快照 ====================
import { createError, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'

/** 单进程有界缓存：相同交易对和周期共用在途任务，随机查询参数不会产生新键。 */
export function createPublicIndicatorAccess() {
  const buckets = new Map<string, { count: number; expires: number }>()
  const snapshots = new Map<string, { expires: number; task: Promise<unknown> }>()
  let total = 0
  let windowEnd = 0
  let active = 0
  const queue: Array<() => void> = []

  /** 在解析参数和执行计算之前限流；不相信可由访客伪造的转发头。 */
  function limit(event: H3Event) {
    const now = Date.now()
    if (now >= windowEnd) { total = 0; windowEnd = now + 60_000 }
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key)
    const address = event.node.req.socket.remoteAddress || 'unknown'
    const bucket = buckets.get(address) ?? { count: 0, expires: now + 60_000 }
    // 全币看板一轮会读取多个交易对：单连接地址每分钟1200次，全进程12000次。
    // 反向代理未做可信地址识别时共享额度，不能直接相信 X-Forwarded-For 来放宽限制。
    if (bucket.count >= 1200 || total >= 12_000 || (!buckets.has(address) && buckets.size >= 2000)) {
      setResponseHeader(event, 'Retry-After', 60)
      throw createError({ statusCode: 429, message: '指标访问过于频繁，请稍后重试' })
    }
    bucket.count++
    total++
    buckets.set(address, bucket)
  }

  /** 快照保留60秒，最多8个计算同时运行；排队与缓存均有上限以保护交易进程。 */
  async function snapshot<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now()
    for (const [entryKey, entry] of snapshots) if (entry.expires <= now) snapshots.delete(entryKey)
    const cached = snapshots.get(key)
    if (cached) return cached.task as Promise<T>
    if (snapshots.size >= 2048 || (active >= 8 && queue.length >= 512)) {
      throw createError({ statusCode: 503, message: '指标服务繁忙，请稍后重试' })
    }
    const entry = { expires: Infinity, task: Promise.resolve(undefined) as Promise<unknown> }
    // 先占用槽位，避免同一轮请求在 await 前一起通过并发判断。
    const permit = active < 8 ? (active++, Promise.resolve()) : new Promise<void>(resolve => queue.push(resolve))
    entry.task = (async () => {
      await permit
      try {
        const result = await loader()
        entry.expires = Date.now() + 60_000
        return result
      } catch (error) {
        snapshots.delete(key)
        throw error
      } finally {
        const next = queue.shift()
        if (next) next()
        else active--
      }
    })()
    snapshots.set(key, entry)
    return entry.task as Promise<T>
  }
  return { limit, snapshot }
}

/** 匿名计算只接受两个选择器，其余参数由服务端配置统一生成。 */
export function publicIndicatorQuery(query: Record<string, unknown>) {
  if ((query.symbol !== undefined && typeof query.symbol !== 'string')
    || (query.timeframe !== undefined && typeof query.timeframe !== 'string')) {
    throw createError({ statusCode: 400, message: '交易对和周期只能指定一次' })
  }
  const symbol = String(query.symbol ?? '').trim().toUpperCase().replace('/', '')
  const timeframe = String(query.timeframe ?? '1h')
  if (!/^[A-Z0-9]{2,40}$/.test(symbol) || !['5m', '15m', '1h', '4h', '1d'].includes(timeframe)) {
    throw createError({ statusCode: 400, message: '无效的交易对或周期' })
  }
  return { symbol, timeframe, includeSlowStats: 'false' }
}
