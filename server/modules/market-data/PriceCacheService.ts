import { BinanceService } from '../../utils/binance'

interface CachedPrice {
  price: number
  timestamp: number
}

export class PriceCacheService {
  private cache: Map<string, CachedPrice> = new Map()
  private pending: Map<string, Promise<number>> = new Map()
  private ttlMs = 5000

  async getPrice(binance: BinanceService, symbol: string): Promise<number> {
    const now = Date.now()
    const cached = this.cache.get(symbol)
    if (cached && now - cached.timestamp < this.ttlMs) {
      return cached.price
    }

    const pending = this.pending.get(symbol)
    if (pending) {
      return await pending
    }

    const request = binance.fetchPrice(symbol)
      .then((price) => {
        this.setPrice(symbol, price)
        return price
      })
      .finally(() => {
        this.pending.delete(symbol)
      })

    this.pending.set(symbol, request)
    return await request
  }

  setPrice(symbol: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return
    this.cache.set(symbol, { price, timestamp: Date.now() })
  }

  getSnapshot(): Record<string, CachedPrice> {
    return Object.fromEntries(this.cache.entries())
  }
}

export const priceCacheService = new PriceCacheService()
