// ==================== 图表历史 K 线浏览器缓存 ====================
import type { SimpleKLineData } from '../../types/kline-simple'
import { mergeKlineHistory } from './kline-history.ts'

export const KLINE_HISTORY_CACHE_TTL = 30 * 60 * 1000
const PREFIX = 'kline-history:v1:'
const MAX_BARS = 5000
const MAX_ENTRIES = 5

/** 单个图表上下文的历史快照；固定过期时间不会随行情轮询续期。 */
interface HistoryCache {
  expiresAt: number
  data: SimpleKLineData[]
  hasEarlier: boolean
}

/** 隐私模式或禁用本地存储时，缓存不可用不影响行情展示。 */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** 删除过期/损坏缓存，并限制不同交易对、周期缓存的总份数。 */
function prune(storage: Storage, now: number, keepKey: string, reserveSlot = false): void {
  const entries: Array<{ key: string; expiresAt: number }> = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      entries.push({ key, expiresAt: Number(value?.expiresAt) || 0 })
    } catch {
      entries.push({ key, expiresAt: 0 })
    }
  }
  for (const entry of entries) {
    if (entry.expiresAt <= now) storage.removeItem(entry.key)
  }
  const remaining = entries.filter(entry => entry.expiresAt > now && entry.key !== keepKey)
    .sort((a, b) => a.expiresAt - b.expiresAt)
  while (remaining.length > MAX_ENTRIES - (reserveSlot ? 1 : 0)) storage.removeItem(remaining.shift()!.key)
}

/** 保存快照；保留首次加载的有效期，避免高频刷新让旧历史永久有效。 */
export function saveKlineHistoryCache(
  scope: string, data: SimpleKLineData[], hasEarlier: boolean, expiresAt: number,
  now = Date.now(), storage = browserStorage()
): number {
  const expiry = expiresAt || now + KLINE_HISTORY_CACHE_TTL
  if (!storage) return expiry
  try {
    const key = PREFIX + scope
    if (expiry <= now) {
      storage.removeItem(key)
      return expiry
    }
    prune(storage, now, key, true)
    const cache: HistoryCache = {
      expiresAt: expiry, data: data.slice(-MAX_BARS), hasEarlier: hasEarlier || data.length > MAX_BARS
    }
    storage.setItem(key, JSON.stringify(cache))
  } catch {
    // 空间不足、权限限制或序列化失败只影响缓存，不能中断图表刷新。
  }
  return expiry
}

/** 服务器行情成功后才恢复历史；要求缓存与服务器窗口连续，服务器同时间数据始终优先。 */
export function restoreKlineHistoryCache(
  scope: string, fresh: SimpleKLineData[], step: number,
  now = Date.now(), storage = browserStorage()
): HistoryCache | null {
  if (!storage || !fresh.length) return null
  const key = PREFIX + scope
  try {
    prune(storage, now, key)
    const cache: HistoryCache | null = JSON.parse(storage.getItem(key) || 'null')
    if (!cache) return null
    const validBar = (bar: SimpleKLineData) => bar && Number.isSafeInteger(bar.t) && bar.t > 0
      && [bar.o, bar.h, bar.l, bar.c, bar.v].every(value => typeof value === 'number' && Number.isFinite(value))
    if (!Number.isFinite(cache.expiresAt) || cache.expiresAt <= now || cache.expiresAt > now + KLINE_HISTORY_CACHE_TTL
      || !Array.isArray(cache.data) || cache.data.length > MAX_BARS
      || !cache.data.every(validBar) || typeof cache.hasEarlier !== 'boolean') {
      storage.removeItem(key)
      return null
    }
    const historical = cache.data.filter(bar => bar.t < fresh[0]!.t)
    if (!historical.length) return null
    const data = mergeKlineHistory(historical, fresh)
    // 不允许缓存与服务器之间的空窗被画成一段连续走势。
    if (data.some((bar, index) => index > 0 && bar.t - data[index - 1]!.t !== step)) {
      storage.removeItem(key)
      return null
    }
    return { data, expiresAt: cache.expiresAt, hasEarlier: cache.hasEarlier }
  } catch {
    return null
  }
}
