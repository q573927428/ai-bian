// ==================== 新闻来源汇总与缓存 ====================
import type { NewsItem, NewsResponse } from '../../../types/news'
import { fetchPanews } from './panews'

// 新增来源只需添加独立获取函数，并注册到此列表。
const sources = [{ name: 'PANews', fetch: fetchPanews }]
const CACHE_MS = 5 * 60_000

/** 每个来源独立缓存，失败也记录尝试时间，避免故障时持续请求上游。 */
interface SourceCache {
  items: NewsItem[]
  attemptedAt: number
  updatedAt: string | null
  failed: boolean
  pending?: Promise<void>
}
const cache = new Map<string, SourceCache>()

/** 合并同源并发刷新；失败时保留上次成功数据。 */
async function refreshSource(source: typeof sources[number]): Promise<void> {
  let entry = cache.get(source.name)
  if (!entry) {
    entry = { items: [], attemptedAt: 0, updatedAt: null, failed: false }
    cache.set(source.name, entry)
  }
  if (entry.pending) return entry.pending
  if (Date.now() - entry.attemptedAt < CACHE_MS) return
  const current = entry
  current.pending = (async () => {
    try {
      current.items = await source.fetch()
      current.updatedAt = new Date().toISOString()
      current.failed = false
    } catch (error) {
      current.failed = true
      console.warn(`[News] ${source.name} 更新失败:`, error instanceof Error ? error.message : error)
    } finally {
      current.attemptedAt = Date.now()
      current.pending = undefined
    }
  })()
  return current.pending
}

/** 汇总订阅快讯，按 ID 和链接去重，单个来源故障不影响其他来源。 */
export async function getLatestNews(): Promise<NewsResponse> {
  await Promise.all(sources.map(refreshSource))
  const ids = new Set<string>()
  const urls = new Set<string>()
  const items = sources.flatMap(source => cache.get(source.name)?.items ?? [])
    .filter(item => {
      // 是否精选由订阅地址决定，普通 RSS 未提供重要标记也应正常展示。
      if (!item.title.trim() || !Number.isFinite(Date.parse(item.publishedAt))) return false
      let url: URL
      try { url = new URL(item.url) } catch { return false }
      if (!['http:', 'https:'].includes(url.protocol)) return false
      url.hash = ''
      const key = url.toString()
      if (ids.has(item.id) || urls.has(key)) return false
      ids.add(item.id)
      urls.add(key)
      return true
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 20)

  return {
    items,
    sources: sources.map(source => {
      const entry = cache.get(source.name)!
      return {
        name: source.name,
        status: entry.failed ? (entry.updatedAt ? 'stale' : 'error') : 'ok',
        updatedAt: entry.updatedAt,
      }
    }),
  }
}
