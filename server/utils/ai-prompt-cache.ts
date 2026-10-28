// ==================== AI 实际请求提示词短期内存缓存 ====================
import { Buffer } from 'node:buffer'

/** 通过策略、交易对和分析时间精确定位；messages 保存实际发送的系统及用户消息。 */
export interface CachedAIPrompt {
  strategyId: string
  symbol: string
  timestamp: number
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

/** 只驻留当前进程；按有效期、条数及总字节数淘汰，防止调试缓存无限增长。 */
export class AIPromptCache {
  private entries: Array<{ value: CachedAIPrompt; expiresAt: number; bytes: number }> = []
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly maxBytes: number
  constructor(maxEntries = 100, ttlMs = 30 * 60_000, maxBytes = 4 * 1024 * 1024) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlMs
    this.maxBytes = maxBytes
  }

  /** 在真实分析完成后缓存请求副本，不保留 API 连接参数。 */
  put(value: CachedAIPrompt, now = Date.now()): void {
    this.prune(now)
    const copy = JSON.parse(JSON.stringify(value)) as CachedAIPrompt
    const bytes = Buffer.byteLength(JSON.stringify(copy), 'utf8')
    if (bytes > this.maxBytes) return
    this.entries.push({ value: copy, expiresAt: now + this.ttlMs, bytes })
    let total = this.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    while (this.entries.length > this.maxEntries || total > this.maxBytes) {
      total -= this.entries.shift()!.bytes
    }
  }

  /** 有 timestamp 时严格匹配，未命中不回退其他分析；省略时返回该策略和交易对最新一条。 */
  get(strategyId: string, symbol: string, timestamp?: number, now = Date.now()): CachedAIPrompt | null {
    this.prune(now)
    const normalize = (value: string) => value.replace('/', '').toUpperCase()
    const found = [...this.entries].reverse().find(({ value }) => value.strategyId === strategyId
      && normalize(value.symbol) === normalize(symbol) && (timestamp === undefined || value.timestamp === timestamp))
    return found ? JSON.parse(JSON.stringify(found.value)) : null
  }

  /** 只返回仍有效的请求目录，不复制或传输提示词正文；供前端决定是否展示查看入口。 */
  list(now = Date.now()) {
    this.prune(now)
    return [...this.entries].reverse().map(({ value, expiresAt, bytes }) => ({
      strategyId: value.strategyId, symbol: value.symbol, timestamp: value.timestamp, expiresAt, bytes
    }))
  }

  /** 读写时清理过期请求，过期内容绝不返回。 */
  private prune(now: number): void {
    this.entries = this.entries.filter(entry => entry.expiresAt > now)
  }
}

export const aiPromptCache = new AIPromptCache()
