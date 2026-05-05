// ==================== 全局并发闸门 ====================

import { logger } from './logger'

/**
 * 并发池配置
 */
export interface ConcurrencyPoolConfig {
  name: string
  maxConcurrency: number
  queueTimeout?: number // 毫秒，默认 30000
}

/**
 * 并发池任务
 */
interface PoolTask<T> {
  id: string
  fn: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
  timestamp: number
}

/**
 * 并发池
 *
 * 控制特定类型任务的并发数量，防止瞬时洪峰导致雪崩
 */
export class ConcurrencyPool<T = any> {
  private config: ConcurrencyPoolConfig
  private queue: PoolTask<T>[] = []
  private activeCount = 0
  private taskIdCounter = 0

  // 统计信息
  private stats = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    rejectedTasks: 0,
    avgWaitTime: 0,
    totalWaitTime: 0
  }

  constructor(config: ConcurrencyPoolConfig) {
    this.config = {
      ...config,
      queueTimeout: config.queueTimeout ?? 30000
    }
    logger.info('ConcurrencyPool', `并发池已创建: ${config.name}, 最大并发: ${config.maxConcurrency}`)
  }

  /**
   * 提交任务到并发池
   */
  async submit(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const taskId = `${this.config.name}_${++this.taskIdCounter}`
      const task: PoolTask<T> = {
        id: taskId,
        fn,
        resolve,
        reject,
        timestamp: Date.now()
      }

      this.stats.totalTasks++
      this.queue.push(task)
      this.processQueue()
    })
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    // 清理超时任务
    this.cleanTimeoutTasks()

    // 检查是否可以处理新任务
    while (this.activeCount < this.config.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) {
        this.executeTask(task)
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: PoolTask<T>): Promise<void> {
    this.activeCount++

    const waitTime = Date.now() - task.timestamp
    this.stats.totalWaitTime += waitTime
    this.stats.avgWaitTime = this.stats.totalWaitTime / this.stats.completedTasks || waitTime

    try {
      const result = await task.fn()
      this.stats.completedTasks++
      task.resolve(result)
    } catch (error) {
      this.stats.failedTasks++
      task.reject(error)
    } finally {
      this.activeCount--
      this.processQueue()
    }
  }

  /**
   * 清理超时任务
   */
  private cleanTimeoutTasks(): void {
    const now = Date.now()
    const timeout = this.config.queueTimeout!

    const remaining: PoolTask<T>[] = []
    for (const task of this.queue) {
      if (now - task.timestamp > timeout) {
        this.stats.rejectedTasks++
        task.reject(new Error(`任务超时: ${this.config.name} 队列等待超过 ${timeout}ms`))
      } else {
        remaining.push(task)
      }
    }

    if (remaining.length !== this.queue.length) {
      this.queue = remaining
      logger.warn('ConcurrencyPool', `${this.config.name} 已清理 ${this.stats.rejectedTasks} 个超时任务`)
    }
  }

  /**
   * 更新最大并发数
   */
  updateMaxConcurrency(maxConcurrency: number): void {
    this.config.maxConcurrency = maxConcurrency
    logger.info('ConcurrencyPool', `${this.config.name} 最大并发已更新为: ${maxConcurrency}`)
    this.processQueue()
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      maxConcurrency: this.config.maxConcurrency
    }
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * 获取活跃任务数
   */
  getActiveCount(): number {
    return this.activeCount
  }
}

/**
 * 全局并发池管理器
 */
export class ConcurrencyPoolManager {
  private pools: Map<string, ConcurrencyPool> = new Map()
  private initialized = false

  // 默认并发配置（可通过bot-config.json覆盖）
  private defaultConfig = {
    indicator: { maxConcurrency: 16 },
    ai: { maxConcurrency: 6 },
    tradeApi: { maxConcurrency: 4 }
  }

  constructor() {
    // 初始化默认并发池（确保只初始化一次）
    this.initDefaultPools()
  }

  private initDefaultPools(): void {
    if (this.initialized) {
      return
    }
    this.createPool('indicator', this.defaultConfig.indicator.maxConcurrency)
    this.createPool('ai', this.defaultConfig.ai.maxConcurrency)
    this.createPool('tradeApi', this.defaultConfig.tradeApi.maxConcurrency)
    this.initialized = true
  }

  /**
   * 创建并发池（如果已存在则返回现有池）
   */
  createPool(name: string, maxConcurrency: number): ConcurrencyPool {
    // 检查是否已存在同名池
    const existingPool = this.pools.get(name)
    if (existingPool) {
      return existingPool
    }
    const pool = new ConcurrencyPool({ name, maxConcurrency })
    this.pools.set(name, pool)
    return pool
  }

  /**
   * 获取并发池
   */
  getPool(name: string): ConcurrencyPool | undefined {
    return this.pools.get(name)
  }

  /**
   * 获取指标并发池
   */
  getIndicatorPool(): ConcurrencyPool {
    return this.pools.get('indicator')!
  }

  /**
   * 获取AI并发池
   */
  getAIPool(): ConcurrencyPool {
    return this.pools.get('ai')!
  }

  /**
   * 获取交易API并发池
   */
  getTradeApiPool(): ConcurrencyPool {
    return this.pools.get('tradeApi')!
  }

  /**
   * 更新并发配置
   */
  updateConfig(config: {
    indicatorConcurrency?: number
    aiConcurrency?: number
    tradeApiConcurrency?: number
  }): void {
    if (config.indicatorConcurrency !== undefined) {
      this.getIndicatorPool().updateMaxConcurrency(config.indicatorConcurrency)
    }
    if (config.aiConcurrency !== undefined) {
      this.getAIPool().updateMaxConcurrency(config.aiConcurrency)
    }
    if (config.tradeApiConcurrency !== undefined) {
      this.getTradeApiPool().updateMaxConcurrency(config.tradeApiConcurrency)
    }
  }

  /**
   * 获取所有并发池统计
   */
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {}
    for (const [name, pool] of this.pools) {
      stats[name] = pool.getStats()
    }
    return stats
  }
}

// 单例实例（使用更安全的单例模式）
let instance: ConcurrencyPoolManager | null = null

export function getConcurrencyPoolManager(): ConcurrencyPoolManager {
  if (!instance) {
    instance = new ConcurrencyPoolManager()
  }
  return instance
}

// 保持向后兼容
export const concurrencyPoolManager = getConcurrencyPoolManager()
