// ==================== 币安广场热度工具 ====================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

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
const pendingRequests = new Map<string, Promise<SquareHeatResult>>()

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
  if (cached && (Date.now() - cached.timestamp < SQUARE_HEAT_CACHE_TTL_MS)) {
    return cached.data
  }

  // 2. 检查是否有进行中的请求（防抖）
  const pending = pendingRequests.get(cacheKey)
  if (pending) {
    return pending
  }

  // 3. 发起请求
  const requestPromise = fetchSquareHeat(baseAsset, normalizedWindowMinutes)
  pendingRequests.set(cacheKey, requestPromise)

  try {
    const result = await requestPromise
    // 写入缓存
    cache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  } finally {
    pendingRequests.delete(cacheKey)
  }
}

/**
 * 只读取指定币种和统计窗口的有效缓存，供看板首屏使用。
 * 缓存缺失或过期时不发起网络请求，也不等待正在进行的抓取。
 */
export function getCachedSquareHeat(symbol: string, windowMinutes: number = DEFAULT_WINDOW_MINUTES): SquareHeatResult | undefined {
  const baseAsset = symbol.replace(/\/?USDT$/i, '')
  const normalizedWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes > 0
    ? Math.floor(windowMinutes)
    : DEFAULT_WINDOW_MINUTES
  const cached = cache.get(`${baseAsset}_${normalizedWindowMinutes}`)
  return cached && Date.now() - cached.timestamp < SQUARE_HEAT_CACHE_TTL_MS
    ? cached.data
    : undefined
}

/**
 * 请求并统计广场帖子。
 * 所有热度与情绪数据严格使用策略最大持仓时间对应的窗口。
 */
async function fetchSquareHeat(baseAsset: string, windowMinutes: number): Promise<SquareHeatResult> {
  // 重试配置
  const MAX_RETRIES = 2
  const RETRY_DELAY = 1000 // 1秒

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 币安广场使用基础币种标签，例如 #BTC、#ETH、#DOGE
      const hashtag = baseAsset
      const fetchedPosts: any[] = []
      const now = Math.floor(Date.now() / 1000)
      const primaryWindowSeconds = windowMinutes * 60

      // pageIndex 才是该接口实际使用的分页参数，默认连续抓取 5 页
      for (let pageIndex = 1; pageIndex <= DEFAULT_FETCH_PAGES; pageIndex++) {
        const url =
          `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?hashtag=${hashtag}&pageIndex=${pageIndex}&pageSize=100&orderBy=LATEST`

        const res = await fetch(url, {
          headers: {
            'user-agent': 'Mozilla/5.0'
          }
        })
        if (!res.ok) {
          throw new Error(`币安广场请求失败: HTTP ${res.status}, pageIndex=${pageIndex}`)
        }

        const json = await res.json()
        const pagePosts = Array.isArray(json.data?.feedData) ? json.data.feedData : []
        fetchedPosts.push(...pagePosts)

        // 接口可能返回更早的历史帖子而不是空数组；当前页窗口样本不足时，后续页只会更旧
        const pageWindowPostCount = pagePosts.filter((post: any) => {
          const diff = now - Number(post.date)
          return Number.isFinite(diff) && diff >= 0 && diff <= primaryWindowSeconds
        }).length
        if (pagePosts.length === 0 || pageWindowPostCount < MIN_PAGE_WINDOW_POSTS) {
          break
        }
      }

      // 分页边界可能出现重复帖子，按帖子标识去重后再统计，避免重复放大热度
      const uniquePosts = new Map<string, any>()
      for (const post of fetchedPosts) {
        const postKey = String(
          post.id ?? post.contentId ?? post.postId ?? post.shareId
          ?? `${post.date}_${post.tendency}_${post.title ?? post.content ?? ''}`
        )
        uniquePosts.set(postKey, post)
      }
      const posts = Array.from(uniquePosts.values())

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
      const nowMs = Date.now()

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
    } catch {
      // 如果不是最后一次尝试，等待后重试
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
        continue
      }
      // 最后一次尝试失败，返回默认值
      return {
        symbol: baseAsset,
        heat: 0,
        postCount: 0,
        trend: 'normal',
        changePercent: 0,
        historyAvg: 0,
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        directionalCoveragePercent: 0,
        netDirectionalSentimentPercent: 0,
        lastUpdated: Date.now(),
      }
    }
  }

  // 所有重试都失败
  return {
    symbol: baseAsset,
    heat: 0,
    postCount: 0,
    trend: 'normal',
    changePercent: 0,
    historyAvg: 0,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    directionalCoveragePercent: 0,
    netDirectionalSentimentPercent: 0,
    lastUpdated: Date.now(),
  }
}

/**
 * 清理过期缓存
 */
export function cleanExpiredSquareHeatCache(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= SQUARE_HEAT_CACHE_TTL_MS) {
      cache.delete(key)
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
