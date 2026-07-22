// ==================== Binance HTTP 状态识别工具 ====================

export type BinanceRateLimitHttpStatus = 418 | 429

const RATE_LIMIT_HTTP_STATUSES = new Set<number>([418, 429])
const MAX_ERROR_CHAIN_DEPTH = 6

/**
 * 从结构化错误字段或严格的 HTTP 响应文本中识别 Binance 限流状态。
 *
 * 不能直接在完整 message 中搜索数字，因为 CCXT 的错误文本包含请求 URL，
 * 随机 signature 可能恰好包含 418 或 429，从而造成错误封禁和限流误报。
 */
export function detectBinanceRateLimitHttpStatus(error: unknown): BinanceRateLimitHttpStatus | undefined {
  const queue: Array<{ value: any; depth: number }> = [{ value: error, depth: 0 }]
  const visited = new Set<any>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current?.value || visited.has(current.value)) continue

    const value = current.value
    visited.add(value)

    const structuredStatuses = [value.status, value.statusCode, value.response?.status]
    for (const candidate of structuredStatuses) {
      const status = Number(candidate)
      if (RATE_LIMIT_HTTP_STATUSES.has(status)) {
        return status as BinanceRateLimitHttpStatus
      }
    }

    // 兼容 CCXT 只在错误文本中保留 HTTP 状态的情况，但必须同时匹配标准状态描述。
    const message = String(value.message || '')
    const responseTextMatch = message.match(/(?:^|\s)(418|429)\s+(?:I'm a teapot|Too Many Requests)(?=$|[\s:;,.])/i)
    if (responseTextMatch) {
      return Number(responseTextMatch[1]) as BinanceRateLimitHttpStatus
    }

    if (current.depth >= MAX_ERROR_CHAIN_DEPTH) continue
    if (value.cause) queue.push({ value: value.cause, depth: current.depth + 1 })
    if (value.response && typeof value.response === 'object') {
      queue.push({ value: value.response, depth: current.depth + 1 })
    }
  }

  return undefined
}
