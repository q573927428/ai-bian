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
  /** 看涨占比（基于看涨+看跌，0~100） */
  bullishPercent: number
  /** 看跌占比（基于看涨+看跌，0~100） */
  bearishPercent: number
  /** 中性帖子数（未表明方向） */
  neutralCount: number
  lastUpdated: number
}

/**
 * 历史记录条目
 */
interface HistoryEntry {
  postCount: number
  timestamp: number
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

// 内存缓存：baseAsset -> CacheEntry
const cache = new Map<string, CacheEntry>()

// 历史记录：baseAsset -> HistoryEntry[]（最多保留 24 条，约 24 小时）
const historyStore = new Map<string, HistoryEntry[]>()

// 缓存 TTL：60 分钟
const CACHE_TTL = 60 * 60 * 1000

// 历史记录最大保留数
const MAX_HISTORY = 24

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
export async function getSquareHeat(symbol: string): Promise<SquareHeatResult> {
  // 首次使用时加载持久化数据
  loadHistoryFromFile()

  const baseAsset = symbol.replace(/\/?USDT$/i, '')

  // 1. 检查缓存
  const cached = cache.get(baseAsset)
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data
  }

  // 2. 检查是否有进行中的请求（防抖）
  const pending = pendingRequests.get(baseAsset)
  if (pending) {
    return pending
  }

  // 3. 发起请求
  const requestPromise = fetchSquareHeat(baseAsset)
  pendingRequests.set(baseAsset, requestPromise)

  try {
    const result = await requestPromise
    // 写入缓存
    cache.set(baseAsset, { data: result, timestamp: Date.now() })
    return result
  } finally {
    pendingRequests.delete(baseAsset)
  }
}

/**
 * 调用币安广场 API 获取最新帖子，统计 24 小时内帖子数
 */
async function fetchSquareHeat(baseAsset: string): Promise<SquareHeatResult> {
  // 重试配置
  const MAX_RETRIES = 2
  const RETRY_DELAY = 1000 // 1秒

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // BTC 特殊处理：币安广场 #BTC 获取不到数据，需要用 #BTCUSDT
      const hashtag = baseAsset === 'BTC' ? 'BTCUSDT' : baseAsset
      const url =
        `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag` +
        `?hashtag=%23${hashtag}&pageNum=1&pageSize=200&sortBy=LATEST`

      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0'
        }
      })

      const json = await res.json()
      const posts = json.data?.feedData || []

      const now = Math.floor(Date.now() / 1000)
      const TWENTY_FOUR_HOURS = 3600 * 24
      const FORTY_EIGHT_HOURS = 3600 * 48

      // 先统计 24h 内看涨+看跌的帖子数，判断是否需要扩展窗口
      let bullishBearish24h = 0
      for (const post of posts) {
        const diff = now - post.date
        if (diff <= TWENTY_FOUR_HOURS) {
          const tendency = Number(post.tendency)
          if (tendency === 1 || tendency === 2) {
            bullishBearish24h++
          }
        }
      }

      // 如果 24h 内看涨+看跌帖子数 < 10，扩展到 48h 获取更多样本
      const use48h = bullishBearish24h < 10
      const sentimentWindow = use48h ? FORTY_EIGHT_HOURS : TWENTY_FOUR_HOURS

      // 按时间窗口统计总帖子数、看涨、看跌、中性
      let postCount = 0
      let bullish = 0   // tendency=1 看涨
      let bearish = 0   // tendency=2 看跌
      let neutral = 0   // tendency=0 中性
      for (const post of posts) {
        const diff = now - post.date
        if (diff <= sentimentWindow) {
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

      // 计算涨跌占比（基于看涨+看跌）
      const trendTotal = bullish + bearish
      const bullishPercent = trendTotal > 0 ? Number(((bullish / trendTotal) * 100).toFixed(2)) : 0
      const bearishPercent = trendTotal > 0 ? Number(((bearish / trendTotal) * 100).toFixed(2)) : 0

      // ========== 历史对比逻辑 ==========
      const history = historyStore.get(baseAsset) || []
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
      history.push({ postCount, timestamp: nowMs })
      // 只保留最近 MAX_HISTORY 条
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY)
      }
      historyStore.set(baseAsset, history)

      // 持久化到文件
      saveHistoryToFile()

      return {
        symbol: baseAsset,
        heat,
        postCount,
        trend,
        changePercent: Number(changePercent.toFixed(1)),
        historyAvg: Number(historyAvg.toFixed(1)),
        bullishPercent,
        bearishPercent,
        neutralCount: neutral,
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
        bullishPercent: 0,
        bearishPercent: 0,
        neutralCount: 0,
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
    bullishPercent: 0,
    bearishPercent: 0,
    neutralCount: 0,
    lastUpdated: Date.now(),
  }
}

/**
 * 清理过期缓存
 */
export function cleanExpiredSquareHeatCache(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= CACHE_TTL) {
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
    ttl: CACHE_TTL,
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
