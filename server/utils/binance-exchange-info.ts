// ==================== Binance 合约元数据持久化共享缓存 ====================

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { binanceApiGateway } from './binance-api-gateway'

/** 合约基础信息；保留其余官方字段，供精度、过滤器等后续功能复用。 */
export interface BinanceSymbolMetadata {
  symbol: string
  contractType: string
  status: string
  onboardDate?: number
  [key: string]: unknown
}

/** exchangeInfo 完整响应，保留交易所级别的限额和其他元数据。 */
export interface BinanceExchangeInfo {
  symbols: BinanceSymbolMetadata[]
  [key: string]: unknown
}

/** fetchedAt 为上次成功拉取时间，服务重启不会重置缓存有效期。 */
interface PersistedExchangeInfo {
  fetchedAt: number
  data: BinanceExchangeInfo
}

const CACHE_DIR = join(process.cwd(), 'data')
const CACHE_FILE = join(CACHE_DIR, 'binance-exchange-info.json')
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const RETRY_DELAY_MS = 60 * 1000
let cached: PersistedExchangeInfo | null = null
let loadPromise: Promise<void> | null = null
let refreshPromise: Promise<BinanceExchangeInfo> | null = null
let retryAfter = 0

/** 拒绝空列表或损坏结构，避免错误响应覆盖可用的本地元数据。 */
function isExchangeInfo(value: unknown): value is BinanceExchangeInfo {
  const data = value as BinanceExchangeInfo | null
  return !!data && Array.isArray(data.symbols) && data.symbols.length > 0 &&
    data.symbols.every(symbol => symbol && typeof symbol.symbol === 'string' &&
      typeof symbol.contractType === 'string' && typeof symbol.status === 'string')
}

/** 每个进程只读取一次磁盘；损坏或缺失时交给首次网络刷新恢复。 */
async function loadPersistedCache(): Promise<void> {
  try {
    const stored: PersistedExchangeInfo = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
    if (Number.isFinite(stored.fetchedAt) && stored.fetchedAt > 0 &&
      stored.fetchedAt <= Date.now() && isExchangeInfo(stored.data)) {
      cached = stored
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[ExchangeInfo] 读取本地缓存失败:', error)
    }
  }
}

/** 合并并发刷新，先写临时文件再替换，避免中途退出损坏已有缓存。 */
function refreshExchangeInfo(): Promise<BinanceExchangeInfo> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const data = await binanceApiGateway.fetchJson<BinanceExchangeInfo>(
        'marketData', 'exchangeInfo', 'https://fapi.binance.com/fapi/v1/exchangeInfo'
      )
      if (!isExchangeInfo(data)) throw new Error('Binance exchangeInfo 数据格式无效')
      cached = { fetchedAt: Date.now(), data }
      // 磁盘异常不影响本次可用数据；记录失败以便排查持久化问题。
      try {
        await mkdir(CACHE_DIR, { recursive: true })
        const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`
        await writeFile(temporaryFile, JSON.stringify(cached), 'utf8')
        await rename(temporaryFile, CACHE_FILE)
      } catch (error) {
        console.warn('[ExchangeInfo] 持久化缓存失败:', error)
      }
      return data
    } catch (error) {
      // 上游异常时限制重试频率，防止每次页面访问都重复请求 Binance。
      retryAfter = Date.now() + RETRY_DELAY_MS
      throw error
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

/**
 * 获取共享合约元数据：优先内存和磁盘，24 小时后按需后台刷新。
 * 有旧数据时立即返回；首次无缓存才等待网络，失败后一分钟内不重复拉取。
 */
export async function getBinanceExchangeInfo(): Promise<BinanceExchangeInfo> {
  await (loadPromise ??= loadPersistedCache())
  if (cached) {
    if (Date.now() - cached.fetchedAt >= MAX_AGE_MS && Date.now() >= retryAfter) {
      void refreshExchangeInfo().catch(error => {
        console.warn('[ExchangeInfo] 刷新失败，继续使用本地缓存:', error)
      })
    }
    return cached.data
  }
  if (Date.now() < retryAfter) throw new Error('合约元数据暂不可用，请稍后重试')
  return refreshExchangeInfo()
}
