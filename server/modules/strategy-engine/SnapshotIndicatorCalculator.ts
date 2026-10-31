// ==================== 扫描快照指标去重与耗时统计 ====================
import { performance } from 'node:perf_hooks'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import type { IndicatorData } from '../../../types/strategy'
import type { MarketSnapshot } from '../scheduler/SymbolBasedScheduler'
import { shortHash } from '../../utils/stable-hash'

/**
 * 同一轮扫描内按快照对象隔离指标任务，不跨行情窗口复用。
 * Promise 在执行前登记，合并并发及顺序重复请求；每项计算前让出事件循环。
 */
export class SnapshotIndicatorCalculator {
  private tasks = new WeakMap<MarketSnapshot, Map<string, Promise<IndicatorData>>>()
  private stats = { requests: 0, calculated: 0, reused: 0, failed: 0, synchronousMs: 0 }

  /** 同快照、同周期、同参数共享结果；失败任务移除，允许后续策略重试。 */
  get(
    snapshot: MarketSnapshot,
    timeframe: string,
    type: string,
    params: Record<string, unknown>,
    loader: () => Promise<IndicatorData>
  ): Promise<IndicatorData> {
    this.stats.requests++
    let entries = this.tasks.get(snapshot)
    if (!entries) {
      entries = new Map()
      this.tasks.set(snapshot, entries)
    }
    const key = `${timeframe}:${type}:${shortHash(params)}`
    const existing = entries.get(key)
    if (existing) {
      this.stats.reused++
      return existing
    }
    const task = (async () => {
      // Promise 微任务不会放行 I/O；使用 setImmediate 给监控、接口及计时器运行机会。
      await yieldToEventLoop()
      this.stats.calculated++
      try {
        const started = performance.now()
        let pending: Promise<IndicatorData>
        try {
          pending = loader()
        } finally {
          // 本地技术指标在 async 函数首次返回前同步计算；排除调度、AI 和网络等待。
          this.stats.synchronousMs += performance.now() - started
        }
        return await pending
      } catch (error) {
        this.stats.failed++
        entries.delete(key)
        throw error
      }
    })()
    entries.set(key, task)
    return task
  }

  /** 返回独立统计副本，累计同步执行时间不等同于整轮墙钟耗时。 */
  getStats() {
    return { ...this.stats, synchronousMs: Math.round(this.stats.synchronousMs * 100) / 100 }
  }
}
