import type { BotBinanceRateLimitConfig } from '../../types'
import { binanceRateLimiter, type BinanceRequestGroup } from './binance-rate-limiter'

class BinanceApiGateway {
  updateConfig(config?: BotBinanceRateLimitConfig): void {
    binanceRateLimiter.updateConfig(config)
  }

  marketData<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return binanceRateLimiter.schedule('marketData', key, fn)
  }

  account<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return binanceRateLimiter.schedule('account', key, fn)
  }

  trade<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return binanceRateLimiter.schedule('trade', key, fn)
  }

  async fetchJson<T>(
    group: BinanceRequestGroup,
    key: string,
    url: string,
    init?: RequestInit
  ): Promise<T> {
    return binanceRateLimiter.schedule(group, key, async () => {
      const response = await fetch(url, init)
      binanceRateLimiter.updateFromHeaders(response.headers)

      if (!response.ok) {
        let body: any = undefined
        try {
          body = await response.json()
        } catch {
          body = undefined
        }
        const error: any = new Error(body?.msg || `${response.status}: ${response.statusText}`)
        error.status = response.status
        error.code = body?.code
        error.body = body
        error.retryAfter = response.headers.get('retry-after')
        throw error
      }

      return await response.json() as T
    })
  }

  getStatus() {
    return binanceRateLimiter.getSnapshot()
  }
}

export const binanceApiGateway = new BinanceApiGateway()
