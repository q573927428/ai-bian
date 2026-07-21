import type { BotBinanceRateLimitConfig } from '../../types'
import { logger } from './logger'

export type BinanceRequestGroup = 'marketData' | 'account' | 'trade'

/**
 * Binance 限流队列中的单个任务。
 */
interface QueueTask<T> {
  key: string
  group: BinanceRequestGroup
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: any) => void
  createdAt: number
  attempt: number
}

/**
 * Binance 请求队列和降级状态快照，用于性能监控与故障诊断。
 */
export interface BinanceRateLimitSnapshot {
  usedWeight1m: number
  localEstimatedWeight1m: number
  orderCount10s?: number
  orderCount1m?: number
  queues: Record<BinanceRequestGroup, number>
  active: Record<BinanceRequestGroup, number>
  maxConcurrency: Record<BinanceRequestGroup, number>
  bannedUntil?: number
  degradedUntil?: number
  recent429: number
  recent418: number
  recentErrors: number
  consecutiveTimeouts: number
  deduplicatedRequests: number
  rejectedQueueFull: number
  expiredQueueTasks: number
  backgroundPaused: boolean
  degradedReason?: string
}

const DEFAULT_CONFIG: Required<BotBinanceRateLimitConfig> = {
  marketDataConcurrency: 2,
  accountConcurrency: 1,
  tradeConcurrency: 1,
  maxUsedWeight1mRatio: 0.75,
  retryBaseMs: 1000,
  retryMaxMs: 60000
}

const GROUP_ORDER: BinanceRequestGroup[] = ['trade', 'account', 'marketData']
const GROUP_MIN_INTERVAL_MS: Record<BinanceRequestGroup, number> = {
  marketData: 150,
  account: 250,
  trade: 300
}
const GROUP_ESTIMATED_WEIGHT: Record<BinanceRequestGroup, number> = {
  marketData: 2,
  account: 5,
  trade: 1
}
const MAX_QUEUE_SIZE_PER_GROUP = 300
const QUEUE_TIMEOUT_MS = 30000
const TIMEOUT_DEGRADE_THRESHOLD = 3
const TIMEOUT_DEGRADE_MS = 60000

export class BinanceRateLimiter {
  private config = { ...DEFAULT_CONFIG }
  private queues: Record<BinanceRequestGroup, QueueTask<any>[]> = {
    marketData: [],
    account: [],
    trade: []
  }
  private active: Record<BinanceRequestGroup, number> = {
    marketData: 0,
    account: 0,
    trade: 0
  }
  private processing = false
  private queueWakeTimer: NodeJS.Timeout | null = null
  private pendingRequests = new Map<string, Promise<any>>()
  private usedWeight1m = 0
  private orderCount10s: number | undefined
  private orderCount1m: number | undefined
  private bannedUntil = 0
  private degradedUntil = 0
  private recent429 = 0
  private recent418 = 0
  private recentErrors = 0
  private consecutiveTimeouts = 0
  private deduplicatedRequests = 0
  private rejectedQueueFull = 0
  private expiredQueueTasks = 0
  private retryAttempt = 0
  private degradedReason = ''
  private usedWeightUpdatedAt = 0
  private localWeightEvents: Array<{ timestamp: number; weight: number }> = []
  private lastStartedAt: Record<BinanceRequestGroup, number> = {
    marketData: 0,
    account: 0,
    trade: 0
  }

  updateConfig(config?: BotBinanceRateLimitConfig): void {
    if (!config) return
    this.config = {
      marketDataConcurrency: this.clampInteger(config.marketDataConcurrency, 1, 10, DEFAULT_CONFIG.marketDataConcurrency),
      accountConcurrency: this.clampInteger(config.accountConcurrency, 1, 5, DEFAULT_CONFIG.accountConcurrency),
      tradeConcurrency: this.clampInteger(config.tradeConcurrency, 1, 5, DEFAULT_CONFIG.tradeConcurrency),
      maxUsedWeight1mRatio: this.clampRatio(config.maxUsedWeight1mRatio, DEFAULT_CONFIG.maxUsedWeight1mRatio),
      retryBaseMs: this.clampInteger(config.retryBaseMs, 250, 30000, DEFAULT_CONFIG.retryBaseMs),
      retryMaxMs: this.clampInteger(config.retryMaxMs, 1000, 300000, DEFAULT_CONFIG.retryMaxMs)
    }
    this.processQueue()
  }

  schedule<T>(group: BinanceRequestGroup, key: string, fn: () => Promise<T>): Promise<T> {
    const requestKey = `${group}:${key}`
    const pending = this.pendingRequests.get(requestKey)
    if (pending) {
      this.deduplicatedRequests++
      return pending as Promise<T>
    }

    if (this.queues[group].length >= MAX_QUEUE_SIZE_PER_GROUP) {
      this.rejectedQueueFull++
      return Promise.reject(new Error(`Binance ${group} 队列已满（${MAX_QUEUE_SIZE_PER_GROUP}），拒绝请求: ${key}`))
    }

    const request = new Promise<T>((resolve, reject) => {
      this.queues[group].push({
        key,
        group,
        fn,
        resolve,
        reject,
        createdAt: Date.now(),
        attempt: 0
      })
      this.processQueue()
    })

    this.pendingRequests.set(requestKey, request)
    void request.then(
      () => this.deletePendingRequest(requestKey, request),
      () => this.deletePendingRequest(requestKey, request)
    )
    return request
  }

  updateFromHeaders(headersLike: any): void {
    const getHeader = (name: string): string | null => {
      if (!headersLike) return null
      if (typeof headersLike.get === 'function') {
        return headersLike.get(name) || headersLike.get(name.toLowerCase())
      }
      return headersLike[name] || headersLike[name.toLowerCase()] || null
    }

    const usedWeight = Number(getHeader('x-mbx-used-weight-1m'))
    if (Number.isFinite(usedWeight)) {
      this.usedWeight1m = usedWeight
      this.usedWeightUpdatedAt = Date.now()
    }

    const order10s = Number(getHeader('x-mbx-order-count-10s'))
    if (Number.isFinite(order10s)) {
      this.orderCount10s = order10s
    }

    const order1m = Number(getHeader('x-mbx-order-count-1m'))
    if (Number.isFinite(order1m)) {
      this.orderCount1m = order1m
    }
  }

  reportError(error: any): void {
    this.recentErrors++
    const status = Number(error?.status || error?.response?.status)
    const message = String(error?.message || '')
    const code = Number(error?.code || error?.body?.code)
    const retryAfterSeconds = Number(error?.retryAfter)
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 0

    if (status === 418 || message.includes('418')) {
      this.recent418++
      this.bannedUntil = Date.now() + Math.max(retryAfterMs, this.config.retryMaxMs)
      this.degradedReason = 'Binance 418 banned'
      logger.error('BinanceRateLimiter', `Binance 418 banned, pause until ${new Date(this.bannedUntil).toISOString()}`)
      return
    }

    if (status === 429 || message.includes('429')) {
      this.recent429++
      this.retryAttempt++
      const backoff = Math.min(this.config.retryMaxMs, this.config.retryBaseMs * (2 ** Math.min(this.retryAttempt, 6)))
      this.degradedUntil = Date.now() + Math.max(retryAfterMs, backoff)
      this.degradedReason = 'Binance 429 throttled'
      logger.warn('BinanceRateLimiter', `Binance 429 throttled, pause ${Math.max(retryAfterMs, backoff)}ms`)
      return
    }

    if (code === -1008 || message.includes('-1008')) {
      this.degradedUntil = Date.now() + this.config.retryMaxMs
      this.degradedReason = 'Binance overloaded (-1008)'
      logger.warn('BinanceRateLimiter', `Binance overloaded (-1008), degraded until ${new Date(this.degradedUntil).toISOString()}`)
      return
    }

    if (this.isTimeoutError(error)) {
      this.consecutiveTimeouts++
      if (this.consecutiveTimeouts >= TIMEOUT_DEGRADE_THRESHOLD) {
        this.degradedUntil = Math.max(this.degradedUntil, Date.now() + TIMEOUT_DEGRADE_MS)
        this.degradedReason = `连续 ${this.consecutiveTimeouts} 次 Binance 请求超时`
        logger.warn('BinanceRateLimiter', `${this.degradedReason}，暂停后台请求 ${TIMEOUT_DEGRADE_MS}ms`)
      }
    } else {
      this.consecutiveTimeouts = 0
    }
  }

  /**
   * 判断指标预计算、定时K线等非关键后台任务是否应暂停。
   */
  shouldPauseBackgroundWork(): boolean {
    const now = Date.now()
    return this.bannedUntil > now || this.degradedUntil > now
  }

  getBackgroundPauseReason(): string | undefined {
    return this.shouldPauseBackgroundWork() ? (this.degradedReason || 'Binance 请求处于降级状态') : undefined
  }

  getSnapshot(): BinanceRateLimitSnapshot {
    return {
      usedWeight1m: this.usedWeight1m,
      localEstimatedWeight1m: this.getLocalEstimatedWeight1m(),
      orderCount10s: this.orderCount10s,
      orderCount1m: this.orderCount1m,
      queues: {
        marketData: this.queues.marketData.length,
        account: this.queues.account.length,
        trade: this.queues.trade.length
      },
      active: { ...this.active },
      maxConcurrency: this.getMaxConcurrencyByGroup(),
      bannedUntil: this.bannedUntil || undefined,
      degradedUntil: this.degradedUntil || undefined,
      recent429: this.recent429,
      recent418: this.recent418,
      recentErrors: this.recentErrors,
      consecutiveTimeouts: this.consecutiveTimeouts,
      deduplicatedRequests: this.deduplicatedRequests,
      rejectedQueueFull: this.rejectedQueueFull,
      expiredQueueTasks: this.expiredQueueTasks,
      backgroundPaused: this.shouldPauseBackgroundWork(),
      degradedReason: this.getBackgroundPauseReason()
    }
  }

  private processQueue(): void {
    if (this.processing) return
    this.processing = true
    queueMicrotask(() => {
      this.processing = false
      this.drain()
    })
  }

  private drain(): void {
    this.cleanExpiredTasks()

    const now = Date.now()
    if (this.bannedUntil > now) {
      this.scheduleQueueWake(Math.min(this.bannedUntil - now, 30000))
      return
    }

    let started = false
    const maxConcurrency = this.getMaxConcurrencyByGroup()

    for (const group of GROUP_ORDER) {
      while (this.queues[group].length > 0 && this.active[group] < maxConcurrency[group]) {
        if (this.shouldPauseGroup(group)) {
          break
        }
        const waitMs = this.getGroupWaitMs(group)
        if (waitMs > 0) {
          this.scheduleQueueWake(waitMs)
          break
        }
        const task = this.queues[group].shift()
        if (!task) break
        this.lastStartedAt[group] = Date.now()
        this.recordLocalWeight(group)
        this.execute(task)
        started = true
      }
    }

    if (this.hasQueuedTasks()) {
      // 即使活动请求长时间未返回，也要定期清理已超过等待期限的队列任务。
      const delay = started
        ? 1000
        : Math.max(250, Math.min(5000, this.degradedUntil - Date.now()))
      this.scheduleQueueWake(delay)
    }
  }

  private async execute<T>(task: QueueTask<T>): Promise<void> {
    this.active[task.group]++
    try {
      const result = await task.fn()
      this.retryAttempt = 0
      this.consecutiveTimeouts = 0
      task.resolve(result)
    } catch (error: any) {
      this.reportError(error)
      task.reject(error)
    } finally {
      this.active[task.group]--
      this.processQueue()
    }
  }

  private shouldPauseGroup(group: BinanceRequestGroup): boolean {
    const now = Date.now()
    if (this.degradedUntil > now) return group !== 'trade'

    // Binance USD-M Futures commonly allows 2400 request weight per minute.
    // Keep a guard band and slow non-trade traffic when usage approaches it.
    if (this.usedWeightUpdatedAt > 0 && now - this.usedWeightUpdatedAt > 65000) {
      this.usedWeight1m = 0
      this.usedWeightUpdatedAt = 0
    }
    const softLimit = 2400 * this.config.maxUsedWeight1mRatio
    const observedWeight = Math.max(this.usedWeight1m, this.getLocalEstimatedWeight1m())
    return group !== 'trade' && observedWeight >= softLimit
  }

  private hasQueuedTasks(): boolean {
    return GROUP_ORDER.some(group => this.queues[group].length > 0)
  }

  private getMaxConcurrencyByGroup(): Record<BinanceRequestGroup, number> {
    const degraded = this.degradedUntil > Date.now()
    return {
      marketData: degraded ? 1 : this.config.marketDataConcurrency,
      account: this.config.accountConcurrency,
      trade: this.config.tradeConcurrency
    }
  }

  private getGroupWaitMs(group: BinanceRequestGroup): number {
    const elapsed = Date.now() - this.lastStartedAt[group]
    return Math.max(0, GROUP_MIN_INTERVAL_MS[group] - elapsed)
  }

  private recordLocalWeight(group: BinanceRequestGroup): void {
    this.localWeightEvents.push({
      timestamp: Date.now(),
      weight: GROUP_ESTIMATED_WEIGHT[group]
    })
    this.pruneLocalWeightEvents()
  }

  private getLocalEstimatedWeight1m(): number {
    this.pruneLocalWeightEvents()
    return this.localWeightEvents.reduce((sum, event) => sum + event.weight, 0)
  }

  private pruneLocalWeightEvents(): void {
    const cutoff = Date.now() - 60000
    this.localWeightEvents = this.localWeightEvents.filter(event => event.timestamp >= cutoff)
  }

  private cleanExpiredTasks(): void {
    const cutoff = Date.now() - QUEUE_TIMEOUT_MS
    for (const group of GROUP_ORDER) {
      const remaining: QueueTask<any>[] = []
      for (const task of this.queues[group]) {
        if (task.createdAt <= cutoff) {
          this.expiredQueueTasks++
          task.reject(new Error(`Binance ${group} 队列等待超过 ${QUEUE_TIMEOUT_MS}ms: ${task.key}`))
        } else {
          remaining.push(task)
        }
      }
      this.queues[group] = remaining
    }
  }

  private scheduleQueueWake(delayMs: number): void {
    if (this.queueWakeTimer) return
    this.queueWakeTimer = setTimeout(() => {
      this.queueWakeTimer = null
      this.processQueue()
    }, Math.max(1, delayMs))
  }

  private deletePendingRequest(key: string, request: Promise<any>): void {
    if (this.pendingRequests.get(key) === request) {
      this.pendingRequests.delete(key)
    }
  }

  private isTimeoutError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase()
    const code = String(error?.code || error?.cause?.code || '').toUpperCase()
    return message.includes('timed out') || message.includes('timeout') || code.includes('TIMEOUT') || code === 'ETIMEDOUT'
  }

  private clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) return fallback
    return Math.min(max, Math.max(min, Math.floor(numberValue)))
  }

  private clampRatio(value: unknown, fallback: number): number {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) return fallback
    return Math.min(0.95, Math.max(0.1, numberValue))
  }
}

export const binanceRateLimiter = new BinanceRateLimiter()
