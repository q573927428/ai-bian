import { BinanceService } from '../../../utils/binance'
import { webSocketManager } from '../../../utils/websocket-manager'
import type { PriceData } from '../../../../types/websocket'
import { logger } from '../../../utils/logger'

/**
 * 价格服务 - 整合WebSocket和REST API
 */
export class PriceService {
  private binance: BinanceService
  private wsEnabled: boolean = false
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 5000 // 缓存5秒过期

  constructor(binance: BinanceService) {
    this.binance = binance
  }

  /**
   * 初始化WebSocket连接
   */
  async initializeWebSocket(symbols: string[]): Promise<void> {
    try {
      await webSocketManager.initialize()
      
      // 订阅所有交易对的价格
      symbols.forEach(symbol => {
        webSocketManager.subscribePrice(symbol, (data: PriceData) => {
          this.updatePriceCache(symbol, data.price)
        })
      })
      
      this.wsEnabled = true
      logger.success('价格服务', 'WebSocket价格订阅已启动', { symbols })
    } catch (error: any) {
      logger.warn('价格服务', 'WebSocket初始化失败，将使用REST API', error.message)
      this.wsEnabled = false
    }
  }

  /**
   * 获取价格（优先WebSocket缓存，降级到REST API）
   */
  async getPrice(symbol: string): Promise<number> {
    // 尝试从缓存获取
    if (this.wsEnabled) {
      const cached = this.priceCache.get(symbol)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.price
      }
    }

    // 降级到REST API
    try {
      const price = await this.binance.fetchPrice(symbol)
      this.updatePriceCache(symbol, price)
      return price
    } catch (error: any) {
      logger.error('价格服务', `获取${symbol}价格失败`, error.message)
      throw error
    }
  }

  /**
   * 订阅价格更新
   */
  subscribePrice(symbol: string, callback: (price: number) => void): void {
    if (!this.wsEnabled) {
      logger.warn('价格服务', 'WebSocket未启用，无法订阅价格')
      return
    }

    webSocketManager.subscribePrice(symbol, (data: PriceData) => {
      callback(data.price)
    })
  }

  /**
   * 批量订阅价格
   */
  subscribePrices(symbols: string[]): void {
    if (!this.wsEnabled) {
      logger.warn('价格服务', 'WebSocket未启用，无法订阅价格')
      return
    }

    symbols.forEach(symbol => {
      webSocketManager.subscribePrice(symbol, (data: PriceData) => {
        this.updatePriceCache(symbol, data.price)
      })
    })
  }

  /**
   * 断开WebSocket连接
   */
  disconnect(): void {
    if (this.wsEnabled) {
      webSocketManager.disconnect()
      this.wsEnabled = false
      this.priceCache.clear()
      logger.info('价格服务', 'WebSocket连接已断开')
    }
  }

  /**
   * 更新价格缓存
   */
  private updatePriceCache(symbol: string, price: number): void {
    this.priceCache.set(symbol, {
      price,
      timestamp: Date.now()
    })
  }

  /**
   * 获取WebSocket状态
   */
  isWebSocketEnabled(): boolean {
    return this.wsEnabled
  }
}
