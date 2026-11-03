// ==================== 币安广场热度工具 ====================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger'

/**
 * 币安广场热度数据
 */
export interface SquareHeatResult {
  symbol: string
  /** 当前热度值 0~100（基于24小时帖子数） */
  heat: number
  /** 24小时帖子数 */
  postCount: number
  /** 活跃度趋势：增长 / 正常 / 下降 */
  trend: 'increasing' | 'normal' | 'decreasing'
  /** 与历史均值相比的变化百分比 */
  changePercent: number
  /** 历史均值（24小时帖子数） */
  historyAvg: number
  /** 看涨帖子数量 */
  bullishCount: number
  /** 看跌帖子数量 */
  bearishCount: number
  /** 中性帖子数（未表明方向） */
  neutralCount: number
  /** 有明确方向的帖子占全部帖子的比例 */
  directionalCoveragePercent: number
  /** 看涨与看跌样本的净倾向，范围为 -100~100 */
  netDirectionalSentimentPercent: number
  lastUpdated: number
  /** 回退数据必须保留原采集时间，并明确告知消费者已过期。 */
  stale?: boolean
  refreshError?: string
}

/**
 * 历史记录条目
 */
interface HistoryEntry {
  postCount: number
  timestamp: number
  /** 兼容旧历史文件，新增字段允许缺失 */
  bullishCount?: number
  bearishCount?: number
  neutralCount?: number
}

/**
 * 内存缓存条目
 */
interface CacheEntry {
  data: SquareHeatResult
  timestamp: number
}

// 持久化文件路径
const DATA_DIR = join(process.cwd(), 'data')
const HISTORY_FILE = join(DATA_DIR, 'square-heat-history.json')

// 内存缓存：baseAsset_windowMinutes -> CacheEntry
const cache = new Map<string, CacheEntry>()

// 历史记录：baseAsset_windowMinutes -> HistoryEntry[]（最多保留 24 条）
const historyStore = new Map<string, HistoryEntry[]>()

// 缓存 TTL：30 分钟；社区情绪属于慢数据，避免每次策略扫描重复请求接口
export const SQUARE_HEAT_CACHE_TTL_MS = 30 * 60 * 1000

// 历史记录最大保留数
const MAX_HISTORY = 24

// 未传入策略持仓时长时，保持原有 24 小时统计行为
const DEFAULT_WINDOW_MINUTES = 24 * 60

// 币安广场接口默认抓取页数，扩大热门交易对的帖子样本范围
const DEFAULT_FETCH_PAGES = 6

// 当前页窗口内样本不足时，后续分页通常已超出统计窗口，停止继续请求
const MIN_PAGE_WINDOW_POSTS = 90

// 进行中的请求（防抖）
const pendingRequests = new Map<string, Promise<PostSnapshot>>()

/** 同一币种所有窗口共用帖子快照，最长窗口采集一次后按各自时间范围统计。 */
interface PostSnapshot {
  posts: any[]
  timestamp: number
}
const postCache = new Map<string, PostSnapshot>()
const retryAfter = new Map<string, number>()
const lastErrors = new Map<string, string>()
const MAX_STALE_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
const COLLECTION_TIMEOUT_MS = 30000
const FAILURE_COOLDOWN_MS = 60000
// 覆盖看板允许的最长窗口；分页仍有六页上限，不为每个窗口重复下载。
const FETCH_WINDOW_MINUTES = 10000

/** 用币种的稳定偏移将刷新时间分散在第25～30分钟，30分钟仍为有效期上限。 */
function refreshAge(baseAsset: string): number {
  let hash = 2166136261
  for (const char of baseAsset) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return SQUARE_HEAT_CACHE_TTL_MS - (hash % (5 * 60 * 1000))
}

/** 获取共享快照；同币种跨窗口请求合并，失败短暂退避，避免每次扫描都重试。 */
async function getPostSnapshot(baseAsset: string): Promise<PostSnapshot> {
  const cached = postCache.get(baseAsset)
  if (cached && Date.now() - cached.timestamp < refreshAge(baseAsset)) return cached
  const pending = pendingRequests.get(baseAsset)
  if (pending) return pending
  if (Date.now() < (retryAfter.get(baseAsset) ?? 0)) {
    throw new Error(lastErrors.get(baseAsset) || '广场采集暂处于失败冷却期')
  }
  const promise = fetchPosts(baseAsset).then(snapshot => {
    postCache.set(baseAsset, snapshot)
    retryAfter.delete(baseAsset)
    lastErrors.delete(baseAsset)
    return snapshot
  }).catch((error: Error) => {
    retryAfter.set(baseAsset, Date.now() + FAILURE_COOLDOWN_MS)
    lastErrors.set(baseAsset, error.message)
    logger.warn('SquareHeat', `${baseAsset} 情绪采集失败，保留旧数据，60秒后重试: ${error.message}`)
    throw error
  }).finally(() => pendingRequests.delete(baseAsset))
  pendingRequests.set(baseAsset, promise)
  return promise
}

/** 每页和整次采集都有真实取消信号，超时也覆盖响应体读取；失败交由下一轮重试。 */
async function fetchPosts(baseAsset: string): Promise<PostSnapshot> {
  const startedAt = Date.now()
  const collectionSignal = AbortSignal.timeout(COLLECTION_TIMEOUT_MS)
  const fetchedPosts: any[] = []
  const now = Math.floor(startedAt / 1000)
  for (let pageIndex = 1; pageIndex <= DEFAULT_FETCH_PAGES; pageIndex++) {
    const pageStartedAt = Date.now()
    try {
      const url = `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?hashtag=${encodeURIComponent(baseAsset)}&pageIndex=${pageIndex}&pageSize=100&orderBy=LATEST`
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.any([collectionSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // 错误响应不能伪装成“没有帖子”，否则会将失败缓存为零热度。
      if ((json.code != null && String(json.code) !== '000000' && String(json.code) !== '0')
        || json.success === false || !Array.isArray(json.data?.feedData)) {
        throw new Error(`广场返回无效数据 code=${json.code ?? 'unknown'}`)
      }
      const pagePosts = json.data.feedData
      fetchedPosts.push(...pagePosts)
      const pageWindowPostCount = pagePosts.filter((post: any) => {
        const diff = now - Number(post.date)
        return Number.isFinite(diff) && diff >= 0 && diff <= FETCH_WINDOW_MINUTES * 60
      }).length
      if (pagePosts.length === 0 || pageWindowPostCount < MIN_PAGE_WINDOW_POSTS) break
    } catch (error: any) {
      throw new Error(`page=${pageIndex} 耗时=${Date.now() - pageStartedAt}ms 总耗时=${Date.now() - startedAt}ms: ${error.message}`)
    }
  }
  const uniquePosts = new Map<string, any>()
  for (const post of fetchedPosts) {
    const key = String(post.id ?? post.contentId ?? post.postId ?? post.shareId
      ?? `${post.date}_${post.tendency}_${post.title ?? post.content ?? ''}`)
    uniquePosts.set(key, post)
  }
  // if (Date.now() - startedAt >= 8000) {
  //   logger.warn('SquareHeat', `${baseAsset} 情绪采集较慢: ${Date.now() - startedAt}ms，帖子=${uniquePosts.size}`)
  // }
  // 常驻缓存只保留统计字段，避免六页帖子的正文和媒体占用交易进程内存。
  return { posts: Array.from(uniquePosts.values(), post => ({ date: post.date, tendency: post.tendency })), timestamp: Date.now() }
}

// 是否已加载持久化数据
let loaded = false

/**
 * 从文件加载历史数据
 */
function loadHistoryFromFile(): void {
  if (loaded) return
  loaded = true

  try {
    if (existsSync(HISTORY_FILE)) {
      const raw = readFileSync(HISTORY_FILE, 'utf-8')
      const data = JSON.parse(raw) as Record<string, HistoryEntry[]>
      for (const [key, entries] of Object.entries(data)) {
        if (Array.isArray(entries)) {
          historyStore.set(key, entries)
        }
      }
    }
  } catch {
    // 文件损坏等，忽略
  }
}

/**
 * 保存历史数据到文件
 */
function saveHistoryToFile(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }
    const data: Record<string, HistoryEntry[]> = {}
    for (const [key, entries] of historyStore) {
      data[key] = entries
    }
    writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // 写入失败忽略
  }
}

/**
 * 获取币安广场热度（带缓存和历史对比）
 * @param symbol 交易对，如 BTCUSDT
 * @returns 热度数据
 */
/**
 * 获取指定持仓周期对应的广场热度。
 * @param symbol 交易对，如 BTCUSDT
 * @param windowMinutes 策略最大持仓时间（分钟），决定情绪统计窗口
 */
export async function getSquareHeat(symbol: string, windowMinutes: number = DEFAULT_WINDOW_MINUTES): Promise<SquareHeatResult> {
  // 首次使用时加载持久化数据
  loadHistoryFromFile()

  const baseAsset = symbol.replace(/\/?USDT$/i, '')
  const normalizedWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes > 0
    ? Math.floor(windowMinutes)
    : DEFAULT_WINDOW_MINUTES
  const cacheKey = `${baseAsset}_${normalizedWindowMinutes}`

  // 1. 检查缓存
  const cached = cache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp < refreshAge(baseAsset))) {
    return cached.data
  }

  try {
    const snapshot = await getPostSnapshot(baseAsset)
    // 同一次帖子快照不重复写历史记录，避免并发消费者改变历史均值。
    const existing = cache.get(cacheKey)
    if (existing?.timestamp === snapshot.timestamp) return existing.data
    const result = calculateSquareHeat(baseAsset, normalizedWindowMinutes, snapshot)
    // 写入缓存
    cache.set(cacheKey, { data: result, timestamp: snapshot.timestamp })
    return result
  } catch (error: any) {
    if (cached && Date.now() - cached.timestamp < MAX_STALE_MS) {
      return { ...cached.data, stale: true, refreshError: error.message }
    }
    // 冷启动没有可信样本时直接报不可用，不制造零热度。
    throw error
  }
}

/**
 * 只读取指定币种和统计窗口的缓存，供看板首屏使用；六小时内旧数据带过期标记。
 * 缓存缺失或过期时不发起网络请求，也不等待正在进行的抓取。
 */
export function getCachedSquareHeat(symbol: string, windowMinutes: number = DEFAULT_WINDOW_MINUTES): SquareHeatResult | undefined {
  const baseAsset = symbol.replace(/\/?USDT$/i, '')
  const normalizedWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes > 0
    ? Math.floor(windowMinutes)
    : DEFAULT_WINDOW_MINUTES
  const cached = cache.get(`${baseAsset}_${normalizedWindowMinutes}`)
  if (!cached || Date.now() - cached.timestamp >= MAX_STALE_MS) return undefined
  const stale = Date.now() - cached.timestamp >= refreshAge(baseAsset)
  return { ...cached.data, stale, refreshError: stale ? lastErrors.get(baseAsset) : undefined }
}

/**
 * 从共享帖子快照计算单个窗口的情绪与历史变化。
 * 所有热度与情绪数据严格使用策略最大持仓时间对应的窗口。
 */
function calculateSquareHeat(baseAsset: string, windowMinutes: number, snapshot: PostSnapshot): SquareHeatResult {
  const now = Math.floor(snapshot.timestamp / 1000)
  const primaryWindowSeconds = windowMinutes * 60
  const posts = snapshot.posts

  // 即使方向样本不足也不扩大窗口，确保数据周期与策略持仓周期一致
  let postCount = 0
  let bullish = 0   // tendency=1 看涨
  let bearish = 0   // tendency=2 看跌
  let neutral = 0   // tendency=0 中性
  for (const post of posts) {
    const diff = now - post.date
    if (diff >= 0 && diff <= primaryWindowSeconds) {
      postCount++
      const tendency = Number(post.tendency)
      if (tendency === 1) {
        bullish++
      } else if (tendency === 2) {
        bearish++
      } else if (tendency === 0) {
        neutral++
      }
    }
  }

  // 热度直接使用时间窗口内的帖子数
  const heat = postCount

  // 覆盖率用于约束情绪结论的可信度，避免少量方向样本被误解为社区整体倾向。
  const trendTotal = bullish + bearish
  const directionalCoveragePercent = postCount > 0
    ? Number(((trendTotal / postCount) * 100).toFixed(2))
    : 0
  const netDirectionalSentimentPercent = trendTotal > 0
    ? Number((((bullish - bearish) / trendTotal) * 100).toFixed(2))
    : 0

  // ========== 历史对比逻辑 ==========
  // 不同策略窗口必须分开计算历史均值，避免 4h 与 24h 数据互相污染
  const historyKey = windowMinutes === DEFAULT_WINDOW_MINUTES
    ? baseAsset
    : `${baseAsset}_${windowMinutes}m`
  const history = historyStore.get(historyKey) || []
  const nowMs = snapshot.timestamp

  // 计算历史均值（排除当前这次）
  const historyAvg = history.length > 0
    ? history.reduce((sum, h) => sum + h.postCount, 0) / history.length
    : 0

  // 计算变化百分比
  let changePercent = 0
  let trend: 'increasing' | 'normal' | 'decreasing' = 'normal'

  if (historyAvg > 0) {
    changePercent = ((postCount - historyAvg) / historyAvg) * 100

    // 增长超过 5% 算增长，下降超过 5% 算下降，其余正常
    if (changePercent > 5) {
      trend = 'increasing'
    } else if (changePercent < -5) {
      trend = 'decreasing'
    } else {
      trend = 'normal'
    }
  }
  // 没有历史数据时，trend 保持 'normal'

  // 保存本次数据到历史记录
  history.push({
    postCount,
    bullishCount: bullish,
    bearishCount: bearish,
    neutralCount: neutral,
    timestamp: nowMs
  })
  // 只保留最近 MAX_HISTORY 条
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY)
  }
  historyStore.set(historyKey, history)

  // 持久化到文件
  saveHistoryToFile()

  return {
    symbol: baseAsset,
    heat,
    postCount,
    trend,
    changePercent: Number(changePercent.toFixed(1)),
    historyAvg: Number(historyAvg.toFixed(1)),
    bullishCount: bullish,
    bearishCount: bearish,
    neutralCount: neutral,
    directionalCoveragePercent,
    netDirectionalSentimentPercent,
    lastUpdated: nowMs,
  }
}

/**
 * 清理过期缓存
 */
export function cleanExpiredSquareHeatCache(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= MAX_STALE_MS) {
      cache.delete(key)
    }
  }
  for (const [key, entry] of postCache) {
    if (now - entry.timestamp >= MAX_STALE_MS) postCache.delete(key)
  }
  for (const [key, nextAttempt] of retryAfter) {
    if (now >= nextAttempt && !postCache.has(key)) {
      retryAfter.delete(key)
      lastErrors.delete(key)
    }
  }
}

/**
 * 获取缓存状态
 */
export function getSquareHeatCacheStatus(): { size: number; ttl: number } {
  return {
    size: cache.size,
    ttl: SQUARE_HEAT_CACHE_TTL_MS,
  }
}

/**
 * 获取历史记录状态
 */
export function getSquareHeatHistoryStatus(): { size: number; maxHistory: number } {
  return {
    size: historyStore.size,
    maxHistory: MAX_HISTORY,
  }
}
