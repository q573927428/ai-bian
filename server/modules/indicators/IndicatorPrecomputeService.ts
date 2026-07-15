import type { BotConfig } from '../../../types'
import type { IndicatorData, Timeframe } from '../../../types/strategy'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { logger } from '../../utils/logger'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import type { IndicatorCombinationRegistry } from './IndicatorCombinationRegistry'

interface CachedIndicator {
  data: IndicatorData
  computedAt: number
  stale: boolean
}

export class IndicatorPrecomputeService {
  private cache = new Map<string, CachedIndicator>()
  private dirtyKeys = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private isRunning = false
  private stats = {
    lastStartedAt: 0,
    lastFinishedAt: 0,
    lastDurationMs: 0,
    lastTotal: 0,
    lastSucceeded: 0,
    lastFailed: 0,
    skippedRuns: 0,
    cacheSize: 0
  }

  constructor(
    private registry: IndicatorCombinationRegistry,
    private indicatorsHub: IndicatorsHub,
    private config: BotConfig
  ) {}

  updateConfig(config: BotConfig): void {
    this.config = config
    if (this.timer) {
      this.start()
    }
  }

  start(): void {
    this.stop()
    if (this.config.indicatorPrecompute?.enabled === false) return

    const intervalMs = Math.max(60000, Number(this.config.indicatorPrecompute?.intervalMs ?? 300000))
    this.timer = setInterval(() => {
      this.precomputeAll().catch((error: any) => {
        logger.error('IndicatorPrecomputeService', `指标预计算失败: ${error.message}`)
      })
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async precomputeAll(): Promise<void> {
    if (this.config.indicatorPrecompute?.enabled === false) return
    if (this.isRunning) {
      this.stats.skippedRuns++
      logger.warn('IndicatorPrecomputeService', `上一轮指标预计算尚未完成，跳过本次预计算`)
      return
    }

    this.isRunning = true
    const startedAt = Date.now()
    const combinations = this.registry.getCombinations()
    let succeeded = 0
    let failed = 0

    this.stats.lastStartedAt = startedAt
    this.stats.lastTotal = combinations.length

    const maxConcurrency = Math.max(1, Number(this.config.indicatorPrecompute?.maxConcurrency ?? 8))
    let cursor = 0

    const worker = async () => {
      while (cursor < combinations.length) {
        const combo = combinations[cursor++]
        if (!combo) continue
        try {
          const data = await concurrencyPoolManager.getIndicatorPool().submit(async () => {
            if (combo.type === 'EMA') {
              return await this.indicatorsHub.getEMAByPeriods(combo.symbol, combo.timeframe, combo.params.periods || [14])
            }
            return await this.indicatorsHub.getIndicators(combo.symbol, combo.timeframe, combo.type, combo.params)
          })
          this.cache.set(combo.key, { data, computedAt: Date.now(), stale: false })
          this.dirtyKeys.delete(combo.key)
          succeeded++
        } catch (error: any) {
          failed++
          const cached = this.cache.get(combo.key)
          if (cached) {
            cached.stale = true
          }
          logger.warn('IndicatorPrecomputeService', `预计算指标失败 ${combo.key}: ${error.message}`)
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(maxConcurrency, combinations.length) }, () => worker()))
    } finally {
      this.isRunning = false
      this.stats.lastFinishedAt = Date.now()
      this.stats.lastDurationMs = this.stats.lastFinishedAt - startedAt
      this.stats.lastSucceeded = succeeded
      this.stats.lastFailed = failed
      this.stats.cacheSize = this.cache.size
      logger.info('IndicatorPrecomputeService', `指标预计算完成: ${succeeded}/${combinations.length}，耗时 ${this.stats.lastDurationMs}ms`)
    }
  }

  get(key: string): IndicatorData | undefined {
    const cached = this.cache.get(key)
    if (!cached) return undefined

    const staleTtlMs = Math.max(60000, Number(this.config.indicatorPrecompute?.staleTtlMs ?? 900000))
    if (Date.now() - cached.computedAt > staleTtlMs && cached.stale) {
      return undefined
    }
    return cached.data
  }

  getMany(keys: string[]): Map<string, IndicatorData> {
    const result = new Map<string, IndicatorData>()
    for (const key of keys) {
      const data = this.get(key)
      if (data) result.set(key, data)
    }
    return result
  }

  markDirtyBySymbolTimeframe(symbol: string, timeframe: Timeframe): void {
    for (const combo of this.registry.getCombinations()) {
      if (combo.symbol === symbol && combo.timeframe === timeframe) {
        this.dirtyKeys.add(combo.key)
      }
    }
  }

  getStatus() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      dirtyKeys: this.dirtyKeys.size,
      cacheSize: this.cache.size
    }
  }
}
