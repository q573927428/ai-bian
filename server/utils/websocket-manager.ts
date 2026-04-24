import { BinanceWebSocketService } from './websocket'
import type { PriceData, WebSocketEvent, WebSocketClientState } from '../../types/websocket'

// 全局WebSocket管理器
export class WebSocketManager {
  private static instance: WebSocketManager
  private wsService: BinanceWebSocketService
  private subscribers: Map<string, ((data: PriceData) => void)[]> = new Map()
  private priceCache: Map<string, PriceData> = new Map()
  private isInitialized = false

  private constructor() {
    this.wsService = new BinanceWebSocketService({
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      pingInterval: 25000,
      timeout: 8000
    })

    // 设置事件监听器
    this.setupEventListeners()
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager()
    }
    return WebSocketManager.instance
  }

  /**
   * 初始化WebSocket连接
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      await this.wsService.connect()
      this.isInitialized = true
      console.log('✅ WebSocket管理器初始化完成')
    } catch (error) {
      console.error('❌ WebSocket管理器初始化失败:', error)
      throw error
    }
  }

  /**
   * 订阅价格数据
   */
  subscribePrice(symbol: string, callback: (data: PriceData) => void): void {
    // 添加订阅者
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, [])
    }
    const callbacks = this.subscribers.get(symbol)!
    
    // 检查是否已经订阅过，避免重复
    if (callbacks.includes(callback)) {
      return
    }
    
    callbacks.push(callback)

    // 如果已经有缓存数据，立即通知
    const cachedPrice = this.priceCache.get(symbol)
    if (cachedPrice) {
      callback(cachedPrice)
    }

    // 订阅WebSocket
    this.wsService.subscribePrices([symbol])
    
    console.log(`📡 添加价格订阅: ${symbol}, 订阅者数量: ${callbacks.length}`)
  }

  /**
   * 取消订阅价格数据
   */
  unsubscribePrice(symbol: string, callback: (data: PriceData) => void): void {
    const callbacks = this.subscribers.get(symbol)
    if (!callbacks) {
      return
    }

    const index = callbacks.indexOf(callback)
    if (index > -1) {
      callbacks.splice(index, 1)
    }

    // 如果没有订阅者了，取消WebSocket订阅
    if (callbacks.length === 0) {
      this.subscribers.delete(symbol)
      this.wsService.unsubscribe([symbol])
      console.log(`📡 取消价格订阅: ${symbol}`)
    } else {
      console.log(`📡 移除价格订阅者: ${symbol}, 剩余订阅者: ${callbacks.length}`)
    }
  }

  /**
   * 批量订阅价格数据
   */
  subscribePrices(symbols: string[], callback: (data: PriceData) => void): void {
    symbols.forEach(symbol => {
      this.subscribePrice(symbol, callback)
    })
  }

  /**
   * 获取当前价格
   */
  getPrice(symbol: string): PriceData | undefined {
    return this.priceCache.get(symbol)
  }

  /**
   * 获取所有价格
   */
  getAllPrices(): Map<string, PriceData> {
    return new Map(this.priceCache)
  }

  /**
   * 获取WebSocket状态
   */
  getWebSocketState(): WebSocketClientState {
    return this.wsService.getState()
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.wsService.disconnect()
    this.subscribers.clear()
    this.priceCache.clear()
    this.isInitialized = false
    console.log('🔌 WebSocket管理器已断开连接')
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 价格更新事件
    this.wsService.on('price', (event: WebSocketEvent) => {
      if (event.type === 'price') {
        const priceData = event.data as PriceData
        this.handlePriceUpdate(priceData)
      }
    })

    // 状态变化事件
    this.wsService.on('status', (event: WebSocketEvent) => {
      console.log(`📊 WebSocket状态变化: ${event.data}`)
    })

    // 错误事件
    this.wsService.on('error', (event: WebSocketEvent) => {
      console.error('❌ WebSocket错误:', event.data)
    })
  }

  /**
   * 处理价格更新
   */
  private handlePriceUpdate(priceData: PriceData): void {
    const { symbol } = priceData

    // 更新缓存
    this.priceCache.set(symbol, priceData)

    // 通知所有订阅者
    const callbacks = this.subscribers.get(symbol)
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(priceData)
        } catch (error) {
          console.error(`❌ 价格回调执行错误 (${symbol}):`, error)
        }
      })
    }
  }
}

// 导出单例实例
export const webSocketManager = WebSocketManager.getInstance()