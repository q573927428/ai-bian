// ==================== 共享实时价格读取与 REST 降级缓存 ====================
import type { BinanceService } from '../../utils/binance'
import { webSocketManager } from '../../utils/websocket-manager'
import { WebSocketStatus } from '../../../types/websocket'

/** REST 补充价格的本地缓存，时间为实际请求完成时间。 */
interface CachedPrice {
  price: number
  timestamp: number
}

/** 优先消费现有 WS 订阅，行情缺失或过期时合并 REST 请求，供持仓风控共享。 */
export class PriceCacheService {
  private cache: Map<string, CachedPrice> = new Map()
  private pending: Map<string, Promise<number>> = new Map()
  private ttlMs = 5000

  /** WS 价格只按原始事件时间判断新鲜度，读取不能延长旧行情的寿命。 */
  async getPrice(binance: BinanceService, symbol: string): Promise<number> {
    const now = Date.now()
    // 行情中心使用 BTCUSDT，策略持仓使用 BTC/USDT，统一键后才能共享价格和在途请求。
    const key = this.normalizeSymbol(symbol)
    const ticker = webSocketManager.getPrice(key)
    if (webSocketManager.getWebSocketState().status === WebSocketStatus.CONNECTED
      && ticker && Number.isFinite(ticker.price) && ticker.price > 0
      && Number.isFinite(ticker.timestamp) && ticker.timestamp <= now
      && now - ticker.timestamp < this.ttlMs) {
      return ticker.price
    }

    const cached = this.cache.get(key)
    if (cached && now - cached.timestamp < this.ttlMs) {
      return cached.price
    }

    const pending = this.pending.get(key)
    if (pending) {
      return await pending
    }

    const request = binance.fetchPrice(symbol)
      .then((price) => {
        // REST 返回非法值也不能放行风控或污染缓存。
        if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol} 当前价格无效`)
        this.setPrice(key, price)
        return price
      })
      .finally(() => {
        this.pending.delete(key)
      })

    this.pending.set(key, request)
    return await request
  }

  /** 写入 REST 价格；WS 原始事件保留在行情中心，不复制成新的本地时间。 */
  setPrice(symbol: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return
    this.cache.set(this.normalizeSymbol(symbol), { price, timestamp: Date.now() })
  }

  /** 兼容策略、行情中心和 CCXT 永续合约的交易对格式。 */
  private normalizeSymbol(symbol: string): string {
    return symbol.split(':')[0]!.replace('/', '').trim().toUpperCase()
  }

  getSnapshot(): Record<string, CachedPrice> {
    return Object.fromEntries(this.cache.entries())
  }
}

export const priceCacheService = new PriceCacheService()
