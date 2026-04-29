// 币安API速率限制器 分配 1800 weight/分钟

export class RateLimiter {
  private usedWeight: number = 0
  private windowStart: number = Date.now()
  private readonly limitPerMinute: number = 1800
  private readonly windowSize: number = 60 * 1000 // 60秒
  private readonly requestQueue: Array<{
    weight: number
    resolve: () => void
  }> = []
  private isProcessingQueue: boolean = false

  constructor() {
    // 定期检查处理队列
    setInterval(() => {
      this.resetIfNeeded()
      this.processQueue()
    }, 1000)
  }

  /**
   * 检查并获取配额
   * @param weight 需要的 weight
   * @returns Promise，在配额可用时 resolve
   */
  async acquire(weight: number = 1): Promise<void> {
    this.resetIfNeeded()

    if (this.usedWeight + weight <= this.limitPerMinute) {
      this.usedWeight += weight
      return
    }

    // 配额不足，加入队列
    return new Promise((resolve) => {
      this.requestQueue.push({ weight, resolve })
      this.processQueue()
    })
  }

  /**
   * 获取当前使用情况
   */
  getUsage(): { used: number; limit: number; remaining: number } {
    this.resetIfNeeded()
    return {
      used: this.usedWeight,
      limit: this.limitPerMinute,
      remaining: this.limitPerMinute - this.usedWeight,
    }
  }

  /**
   * 检查是否需要重置（滑动窗口实现）
   */
  private resetIfNeeded(): void {
    const now = Date.now()
    if (now - this.windowStart >= this.windowSize) {
      // 滑动窗口：计算新窗口开始时间
      const windowsPassed = Math.floor((now - this.windowStart) / this.windowSize)
      this.windowStart += windowsPassed * this.windowSize
      this.usedWeight = 0
    }
  }

  /**
   * 处理队列中的请求
   */
  private processQueue(): void {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true

    while (this.requestQueue.length > 0) {
      this.resetIfNeeded()

      const next = this.requestQueue[0]
      if (next && this.usedWeight + next.weight <= this.limitPerMinute) {
        this.requestQueue.shift()
        this.usedWeight += next.weight
        next.resolve()
      } else {
        // 配额不足，等待重置
        break
      }
    }

    this.isProcessingQueue = false

    // 如果还有队列，设置定时处理
    if (this.requestQueue.length > 0) {
      const now = Date.now()
      const timeUntilReset = this.windowSize - (now - this.windowStart)
      setTimeout(() => {
        this.processQueue()
      }, Math.min(timeUntilReset, 1000))
    }
  }
}

// 导出单例
export const rateLimiter = new RateLimiter()