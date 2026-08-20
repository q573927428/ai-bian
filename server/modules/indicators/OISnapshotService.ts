// ==================== OI 统一内存快照服务 ====================

import type { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import {
  findOIInSeriesAtOrBefore,
  normalizeOISeries,
  upsertOISeriesPoint,
  type OISeriesPoint
} from '../../utils/oi-series'

const FIVE_MINUTES_MS = 5 * 60 * 1000
const HISTORY_LIMIT = 300
const RETENTION_MS = 25 * 60 * 60 * 1000
const MAX_BASELINE_GAP_MS = 10 * 60 * 1000
const HISTORY_RETRY_COOLDOWN_MS = 60 * 1000

/**
 * 当前 OI 内存快照
 *
 * timestamp 保留交易所返回的原始时间，fetchedAt 用于监控本地数据年龄。
 */
export interface CurrentOISnapshot {
  value: number
  timestamp: number
  fetchedAt: number
}

/**
 * OI 变化计算结果
 */
export interface OIChangeResult {
  current: CurrentOISnapshot
  baseline: OISeriesPoint
  changePercent: number
}

/**
 * 单个交易对的 OI 内存诊断快照
 *
 * 仅暴露历史覆盖范围和指定回看窗口的基准点，不复制完整历史数组，避免诊断请求放大内存占用。
 */
export interface OISymbolDiagnostics {
  historyReady: boolean
  current?: CurrentOISnapshot
  historyPoints: number
  oldestHistoryTimestamp?: number
  newestHistoryTimestamp?: number
  baseline?: OISeriesPoint
  calculatedChangePercent?: number
}

/**
 * OI 统一内存快照服务
 *
 * 核心职责：
 * 1. 冷启动时每个交易对仅拉取一次 300 条 5m 历史 OI
 * 2. 维护最新 OI，并在内存中更新每个 5m 时间桶
 * 3. 使用同一条 5m 序列为所有策略周期计算 OI 变化率
 */
export class OISnapshotService {
  private binance: BinanceService
  private currentBySymbol = new Map<string, CurrentOISnapshot>()
  private historyBySymbol = new Map<string, OISeriesPoint[]>()
  private bootstrapPromises = new Map<string, Promise<void>>()
  private refreshPromises = new Map<string, Promise<CurrentOISnapshot>>()
  private historyReadySymbols = new Set<string>()
  private lastHistoryAttemptBySymbol = new Map<string, number>()
  private stats = {
    historyRequests: 0,
    currentRequests: 0,
    failedRequests: 0,
    lastPrunedAt: 0
  }

  constructor(binance: BinanceService) {
    this.binance = binance
  }

  updateBinance(binance: BinanceService): void {
    this.binance = binance
  }

  /**
   * 确保交易对历史和当前 OI 已初始化。
   *
   * 历史请求失败时保留未就绪状态，后续扫描按冷却时间重试，不能把缺失基准误算成 0%。
   */
  async bootstrapSymbol(symbol: string): Promise<void> {
    if (this.historyReadySymbols.has(symbol) && this.currentBySymbol.has(symbol)) return
    const pending = this.bootstrapPromises.get(symbol)
    if (pending) return pending

    const promise = (async () => {
      const now = Date.now()
      const lastAttempt = this.lastHistoryAttemptBySymbol.get(symbol) ?? 0
      const shouldFetchHistory = !this.historyReadySymbols.has(symbol)
        && now - lastAttempt >= HISTORY_RETRY_COOLDOWN_MS

      if (shouldFetchHistory) {
        this.lastHistoryAttemptBySymbol.set(symbol, now)
        try {
          this.stats.historyRequests++
          const history = await this.binance.fetchOpenInterestHistory(symbol, '5m', undefined, HISTORY_LIMIT)
          const points = history
            .filter(item => item.timestamp > 0 && Number.isFinite(item.openInterest) && item.openInterest > 0)
            .map(item => ({
              timestamp: this.toFiveMinuteBucket(item.timestamp),
              openInterest: item.openInterest
            }))
          if (points.length === 0) {
            throw new Error('Binance 未返回有效的历史 OI')
          }
          this.historyBySymbol.set(symbol, normalizeOISeries(points))
          this.historyReadySymbols.add(symbol)
        } catch (error: any) {
          this.stats.failedRequests++
          logger.warn('OISnapshotService', `${symbol} 首次历史 OI 拉取失败，后续扫描将重试: ${error.message}`)
        }
      }

      if (!this.currentBySymbol.has(symbol)) {
        await this.refreshCurrent(symbol)
      }
    })().finally(() => {
      this.bootstrapPromises.delete(symbol)
    })

    this.bootstrapPromises.set(symbol, promise)
    return promise
  }

  /**
   * 获取并缓存最新 OI，同时更新内存中的当前 5m 桶。
   */
  async refreshCurrent(symbol: string): Promise<CurrentOISnapshot> {
    const pending = this.refreshPromises.get(symbol)
    if (pending) return pending

    const promise = (async () => {
      this.stats.currentRequests++
      try {
        const oi = await this.binance.fetchOpenInterest(symbol)
        const fetchedAt = Date.now()
        const timestamp = Number(oi.timestamp) > 0 ? Number(oi.timestamp) : fetchedAt
        const current = { value: oi.openInterest, timestamp, fetchedAt }
        this.currentBySymbol.set(symbol, current)

        const points = this.historyBySymbol.get(symbol) || []
        upsertOISeriesPoint(points, {
          timestamp: this.toFiveMinuteBucket(timestamp),
          openInterest: oi.openInterest
        })
        this.historyBySymbol.set(symbol, points)
        return current
      } catch (error) {
        this.stats.failedRequests++
        throw error
      }
    })().finally(() => {
      this.refreshPromises.delete(symbol)
    })

    this.refreshPromises.set(symbol, promise)
    return promise
  }

  getCurrent(symbol: string): CurrentOISnapshot | undefined {
    return this.currentBySymbol.get(symbol)
  }

  /**
   * 按分钟窗口计算变化率；历史未就绪或目标基准缺失时返回 undefined，要求策略失败关闭。
   */
  calculateChange(symbol: string, lookbackMinutes: number): OIChangeResult | undefined {
    if (!this.historyReadySymbols.has(symbol)) return undefined
    const current = this.currentBySymbol.get(symbol)
    const points = this.historyBySymbol.get(symbol)
    if (!current || !points || points.length === 0) return undefined

    const targetTimestamp = current.timestamp - Math.max(1, lookbackMinutes) * 60 * 1000
    const baseline = findOIInSeriesAtOrBefore(points, targetTimestamp)
    const hasUsableBaseline = baseline
      && targetTimestamp - baseline.timestamp <= MAX_BASELINE_GAP_MS
      && baseline.openInterest > 0
    if (!hasUsableBaseline) return undefined

    return {
      current,
      baseline,
      changePercent: ((current.value - baseline.openInterest) / baseline.openInterest) * 100
    }
  }

  /**
   * 获取单个交易对当前 OI、历史覆盖范围及指定窗口所用基准点。
   */
  getSymbolDiagnostics(symbol: string, lookbackMinutes: number): OISymbolDiagnostics {
    const points = this.historyBySymbol.get(symbol) || []
    const change = this.calculateChange(symbol, lookbackMinutes)

    return {
      historyReady: this.historyReadySymbols.has(symbol),
      current: this.currentBySymbol.get(symbol),
      historyPoints: points.length,
      oldestHistoryTimestamp: points[0]?.timestamp,
      newestHistoryTimestamp: points[points.length - 1]?.timestamp,
      baseline: change?.baseline,
      calculatedChangePercent: change?.changePercent
    }
  }

  /**
   * 清理 25 小时之前的内存快照，为完整 24 小时窗口保留一个小时缓冲。
   */
  pruneExpiredHistory(now: number = Date.now()): number {
    this.stats.lastPrunedAt = now
    const cutoff = now - RETENTION_MS
    let removed = 0
    for (const [symbol, points] of this.historyBySymbol) {
      const retained = points.filter(point => point.timestamp >= cutoff)
      removed += points.length - retained.length
      this.historyBySymbol.set(symbol, retained)
    }
    return removed
  }

  getStatus() {
    const now = Date.now()
    const ages = Array.from(this.currentBySymbol.values()).map(item => now - item.fetchedAt)
    return {
      ...this.stats,
      historyLimit: HISTORY_LIMIT,
      retentionHours: RETENTION_MS / 60 / 60 / 1000,
      historyReadySymbols: this.historyReadySymbols.size,
      currentSymbols: this.currentBySymbol.size,
      memoryHistoryPoints: Array.from(this.historyBySymbol.values()).reduce((sum, items) => sum + items.length, 0),
      oldestCurrentAgeMs: ages.length > 0 ? Math.max(...ages) : 0
    }
  }

  close(): void {
    this.currentBySymbol.clear()
    this.historyBySymbol.clear()
    this.historyReadySymbols.clear()
    this.lastHistoryAttemptBySymbol.clear()
  }

  private toFiveMinuteBucket(timestamp: number): number {
    return Math.floor(timestamp / FIVE_MINUTES_MS) * FIVE_MINUTES_MS
  }
}
