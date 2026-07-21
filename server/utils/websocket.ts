import type { 
  PriceData, 
  KlineData, 
  DepthData, 
  TradeData, 
  WebSocketEvent, 
  WebSocketConfig, 
  WebSocketClientState,
  SubscriptionOptions 
} from '../../types/websocket'
import { WebSocketStatus } from '../../types/websocket'
import WebSocket from 'ws'

// 币安WebSocket端点
const BINANCE_WS_ENDPOINTS = {
  futures: 'wss://fstream.binance.com/market/ws',
  // 本服务订阅的是 @ticker、@kline 等行情流，必须连接 USDⓈ-M Market Streams。
  futuresMarket: 'wss://fstream.binance.com/market/stream',
  futuresTestnet: 'wss://stream.binancefuture.com/ws',
  spot: 'wss://stream.binance.com:9443/ws',
  spotTestnet: 'wss://testnet.binance.vision/ws'
}

// 默认配置
const DEFAULT_CONFIG: WebSocketConfig = {
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  pingInterval: 30000,
  timeout: 10000
}

export class BinanceWebSocketService {
  private ws: WebSocket | null = null
  private config: WebSocketConfig
  private state: WebSocketClientState
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectNotBefore = 0
  private pingTimer: NodeJS.Timeout | null = null
  private connectPromise: Promise<void> | null = null
  private manuallyDisconnected = false
  private requestId = 0
  private pendingPriceSubscriptions = new Set<string>()
  private pendingPriceUnsubscriptions = new Set<string>()
  private subscriptionFlushTimer: NodeJS.Timeout | null = null
  private eventHandlers: Map<string, ((event: WebSocketEvent) => void)[]> = new Map()
  private priceCache: Map<string, PriceData> = new Map()
  private klineCache: Map<string, Map<string, KlineData>> = new Map() // symbol -> interval -> data
  private symbolMapping: Map<string, string> = new Map() // 存储原始symbol到WebSocket格式的映射

  constructor(config: Partial<WebSocketConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      status: WebSocketStatus.DISCONNECTED,
      connectedSymbols: [],
      subscriptions: { symbols: [] },
      lastActivity: Date.now(),
      reconnectAttempts: 0
    }
  }

  /**
   * 格式化交易对符号为WebSocket格式
   */
  private formatSymbolForWebSocket(symbol: string): string {
    // 移除斜杠并转换为小写
    return symbol.replace('/', '').toLowerCase()
  }

  /**
   * 生成币安WebSocket请求ID。
   *
   * 新版USDⓈ-M Futures WebSocket文档要求动态订阅请求ID使用字符串。
   */
  private createRequestId(): string {
    this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER
    return this.requestId.toString()
  }

  /**
   * 连接到币安WebSocket
   */
  async connect(): Promise<void> {
    if (this.state.status === WebSocketStatus.CONNECTED && this.ws?.readyState === WebSocket.OPEN) {
      return
    }
    if (this.connectPromise) return await this.connectPromise
    if (this.reconnectNotBefore > Date.now()) {
      throw new Error(`WebSocket重连冷却中，${this.reconnectNotBefore - Date.now()}ms 后重试`)
    }

    this.manuallyDisconnected = false
    this.clearReconnectTimer()
    this.updateStatus(WebSocketStatus.CONNECTING)

    const connection = new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(BINANCE_WS_ENDPOINTS.futuresMarket)
        this.ws = socket
        let opened = false
        let connectionTimeout: NodeJS.Timeout | null = null

        const clearConnectionTimeout = () => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout)
            connectionTimeout = null
          }
        }
        
        socket.onopen = () => {
          // 旧连接的迟到事件不能覆盖当前连接状态。
          if (this.ws !== socket) {
            socket.close()
            return
          }
          opened = true
          clearConnectionTimeout()
          console.log('✅ WebSocket连接成功')
          this.updateStatus(WebSocketStatus.CONNECTED)
          this.reconnectNotBefore = 0
          this.state.reconnectAttempts = 0
          this.startPingTimer()
          this.resubscribeExistingStreams()
          this.emitEvent({ type: 'status', data: 'connected', timestamp: Date.now() })
          resolve()
        }

        socket.onmessage = (event) => {
          if (this.ws !== socket) return
          this.handleMessage(event)
        }

        socket.on('ping', (data) => {
          if (this.ws !== socket) return
          // ws 客户端会自动回复 pong，这里只记录活跃时间，避免被状态页误判为长时间无数据。
          this.state.lastActivity = Date.now()
        })

        socket.on('pong', () => {
          if (this.ws !== socket) return
          this.state.lastActivity = Date.now()
        })

        socket.onerror = (error: any) => {
          if (this.ws !== socket) return
          console.error('❌ WebSocket错误:', error)
          this.updateStatus(WebSocketStatus.ERROR)
          this.emitEvent({ 
            type: 'error', 
            data: `WebSocket错误: ${error.message || error}`, 
            timestamp: Date.now() 
          })
          // 主动结束故障连接，避免状态为 ERROR 但底层仍 OPEN 时创建第二条连接。
          socket.terminate()
        }

        socket.onclose = (event: any) => {
          if (this.ws !== socket) return
          clearConnectionTimeout()
          this.ws = null
          const closeCode = event?.code ?? 'unknown'
          const closeReason = event?.reason?.toString?.() || ''
          console.log(`🔌 WebSocket连接关闭 code=${closeCode}${closeReason ? ` reason=${closeReason}` : ''}`)
          this.updateStatus(WebSocketStatus.DISCONNECTED)
          this.state.connectedSymbols = []
          this.clearPendingSubscriptionChanges()
          this.stopPingTimer()
          this.emitEvent({ type: 'status', data: 'disconnected', timestamp: Date.now() })
          if (!opened) {
            reject(new Error(`WebSocket连接关闭 code=${closeCode}${closeReason ? ` reason=${closeReason}` : ''}`))
          }
          if (!this.manuallyDisconnected) {
            const throttled = Number(closeCode) === 1008 || closeReason.toLowerCase().includes('too many requests')
            this.scheduleReconnect(throttled ? 60000 : 0)
          }
        }

        // 设置连接超时
        connectionTimeout = setTimeout(() => {
          if (this.ws === socket && !opened) {
            // terminate 能确保触发 close，统一由 close 完成状态清理和 Promise 拒绝。
            socket.terminate()
          }
        }, this.config.timeout)

      } catch (error) {
        console.error('❌ 创建WebSocket失败:', error)
        this.updateStatus(WebSocketStatus.ERROR)
        reject(error)
      }
    })

    this.connectPromise = connection
    try {
      await connection
    } finally {
      if (this.connectPromise === connection) {
        this.connectPromise = null
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.manuallyDisconnected = true
    this.reconnectNotBefore = 0
    this.stopPingTimer()
    this.clearReconnectTimer()
    
    if (this.ws) {
      this.ws.close()
    }
    
    this.updateStatus(WebSocketStatus.DISCONNECTED)
    this.emitEvent({ type: 'status', data: 'disconnected', timestamp: Date.now() })
  }

  /**
   * 订阅价格数据
   */
  subscribePrices(symbols: string[]): void {
    if (!this.ws || this.state.status !== WebSocketStatus.CONNECTED) {
      throw new Error('WebSocket未连接')
    }

    // 过滤已订阅的symbols
    const newSymbols = symbols.filter(symbol => !this.state.connectedSymbols.includes(symbol))
    
    if (newSymbols.length === 0) {
      return
    }

    // 更新状态和映射
    newSymbols.forEach(symbol => {
      const wsSymbol = this.formatSymbolForWebSocket(symbol)
      this.symbolMapping.set(wsSymbol, symbol) // 存储映射关系
      this.pendingPriceUnsubscriptions.delete(symbol)
      this.pendingPriceSubscriptions.add(symbol)
    })
    
    this.state.connectedSymbols = [...this.state.connectedSymbols, ...newSymbols]
    this.state.subscriptions.symbols = [...this.state.subscriptions.symbols, ...newSymbols]
    this.scheduleSubscriptionFlush()
    
    // console.log(`📡 订阅价格数据: ${newSymbols.join(', ')}`)
  }

  /**
   * 重连后恢复已有订阅。
   */
  private resubscribeExistingStreams(): void {
    if (!this.ws || this.state.status !== WebSocketStatus.CONNECTED) {
      return
    }

    const symbols = this.state.subscriptions.symbols || []
    if (symbols.length === 0) {
      return
    }

    // 重连后一次性恢复全部订阅，清除断线前尚未发送的变更。
    this.clearPendingSubscriptionChanges()
    const streams = symbols.map(symbol => `${this.formatSymbolForWebSocket(symbol)}@ticker`)
    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: streams,
      id: this.createRequestId()
    }

    this.ws.send(JSON.stringify(subscribeMessage))

    symbols.forEach(symbol => {
      const wsSymbol = this.formatSymbolForWebSocket(symbol)
      this.symbolMapping.set(wsSymbol, symbol)
    })

    this.state.connectedSymbols = [...symbols]
  }

  /**
   * 订阅K线数据
   */
  subscribeKlines(symbols: string[], intervals: string[] = ['1m', '5m', '15m']): void {
    if (!this.ws || this.state.status !== WebSocketStatus.CONNECTED) {
      throw new Error('WebSocket未连接')
    }

    // 构建订阅消息
    const streams: string[] = []
    
    symbols.forEach(symbol => {
      intervals.forEach(interval => {
        streams.push(`${this.formatSymbolForWebSocket(symbol)}@kline_${interval}`)
      })
    })

    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: streams,
      id: this.createRequestId()
    }

    this.ws.send(JSON.stringify(subscribeMessage))
    
    // 更新映射关系
    symbols.forEach(symbol => {
      const wsSymbol = this.formatSymbolForWebSocket(symbol)
      if (!this.symbolMapping.has(wsSymbol)) {
        this.symbolMapping.set(wsSymbol, symbol)
      }
    })
    
    // 更新订阅配置
    if (!this.state.subscriptions.intervals) {
      this.state.subscriptions.intervals = []
    }
    
    intervals.forEach(interval => {
      if (!this.state.subscriptions.intervals!.includes(interval)) {
        this.state.subscriptions.intervals!.push(interval)
      }
    })
    
    console.log(`📊 订阅K线数据: ${symbols.join(', ')} - 间隔: ${intervals.join(', ')}`)
  }

  /**
   * 取消订阅
   */
  unsubscribe(symbols: string[]): void {
    if (!this.ws || this.state.status !== WebSocketStatus.CONNECTED) {
      throw new Error('WebSocket未连接')
    }

    // 更新状态和映射
    symbols.forEach(symbol => {
      const wsSymbol = this.formatSymbolForWebSocket(symbol)
      this.symbolMapping.delete(wsSymbol) // 删除映射关系
      this.pendingPriceSubscriptions.delete(symbol)
      this.pendingPriceUnsubscriptions.add(symbol)
    })
    
    this.state.connectedSymbols = this.state.connectedSymbols.filter(
      symbol => !symbols.includes(symbol)
    )
    this.state.subscriptions.symbols = this.state.subscriptions.symbols.filter(
      symbol => !symbols.includes(symbol)
    )
    this.scheduleSubscriptionFlush()
    
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
   * 获取K线数据
   */
  getKline(symbol: string, interval: string): KlineData | undefined {
    const symbolCache = this.klineCache.get(symbol)
    return symbolCache?.get(interval)
  }

  /**
   * 获取当前状态
   */
  getState(): WebSocketClientState {
    return { ...this.state }
  }

  /**
   * 添加事件监听器
   */
  on(eventType: string, handler: (event: WebSocketEvent) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, [])
    }
    this.eventHandlers.get(eventType)!.push(handler)
  }

  /**
   * 移除事件监听器
   */
  off(eventType: string, handler: (event: WebSocketEvent) => void): void {
    const handlers = this.eventHandlers.get(eventType)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * 处理WebSocket消息
   */
  private handleMessage(event: any): void {
    try {
      const rawData = JSON.parse(event.data as string)
      const data = rawData?.stream && rawData?.data ? rawData.data : rawData
      
      // 更新最后活动时间
      this.state.lastActivity = Date.now()

      // 处理ping/pong消息
      if (data.ping) {
        // 响应pong消息
        this.ws?.send(JSON.stringify({ pong: data.ping }))
        return
      }
      
      if (data.pong) {
        // 收到pong响应，连接正常
        return
      }

      if (data.code !== undefined && data.msg) {
        const message = `Binance WebSocket返回错误 code=${data.code}, msg=${data.msg}`
        console.error(`❌ ${message}`)
        this.emitEvent({ type: 'error', data: message, timestamp: Date.now() })
        return
      }

      // 处理不同的消息类型
      if (data.e === '24hrTicker') {
        this.handleTickerMessage(data)
      } else if (data.e === 'kline') {
        this.handleKlineMessage(data)
      } else if (data.e === 'trade') {
        this.handleTradeMessage(data)
      } else if (data.e === 'depth') {
        this.handleDepthMessage(data)
      } else if (data.id && data.result === null) {
        // 订阅/取消订阅成功响应
        // console.log('✅ 订阅操作成功')
      } else {
        // 其他消息类型
        console.log('📨 收到未知消息类型')
      }
    } catch (error: any) {
      console.error('❌ 解析WebSocket消息失败:', error, event.data)
    }
  }

  /**
   * 处理ticker消息
   */
  private handleTickerMessage(data: any): void {
    const binanceSymbol = data.s.toLowerCase()
    const originalSymbol = this.symbolMapping.get(binanceSymbol)

    if (!originalSymbol) {
      // 没有找到映射，可能是未订阅的symbol
      return
    }

    const priceData: PriceData = {
      symbol: originalSymbol,
      price: parseFloat(data.c),
      timestamp: data.E,
      volume: parseFloat(data.v),
      bid: parseFloat(data.b),
      ask: parseFloat(data.a),
      bidSize: parseFloat(data.B),
      askSize: parseFloat(data.A),
      change24hPercent: data.P !== undefined ? parseFloat(data.P) : undefined,
      volume24h: data.q !== undefined ? parseFloat(data.q) : undefined
    }

    // 更新缓存
    this.priceCache.set(originalSymbol, priceData)

    // 触发事件
    this.emitEvent({
      type: 'price',
      data: priceData,
      timestamp: Date.now()
    })
  }

  /**
   * 处理K线消息
   */
  private handleKlineMessage(data: any): void {
    const binanceSymbol = data.s.toLowerCase()
    const originalSymbol = this.symbolMapping.get(binanceSymbol)

    if (!originalSymbol) {
      // 没有找到映射，可能是未订阅的symbol
      return
    }

    const interval = data.k.i
    const kline = data.k
    
    const klineData: KlineData = {
      symbol: originalSymbol,
      interval,
      open: parseFloat(kline.o),
      high: parseFloat(kline.h),
      low: parseFloat(kline.l),
      close: parseFloat(kline.c),
      volume: parseFloat(kline.v),
      timestamp: kline.t,
      isClosed: kline.x
    }

    // 更新缓存
    if (!this.klineCache.has(originalSymbol)) {
      this.klineCache.set(originalSymbol, new Map())
    }
    this.klineCache.get(originalSymbol)!.set(interval, klineData)

    // 触发事件
    this.emitEvent({
      type: 'kline',
      data: klineData,
      timestamp: Date.now()
    })
  }

  /**
   * 处理交易消息
   */
  private handleTradeMessage(data: any): void {
    const tradeData: TradeData = {
      symbol: data.s,
      price: parseFloat(data.p),
      quantity: parseFloat(data.q),
      timestamp: data.T,
      isBuyerMaker: data.m
    }

    // 触发事件
    this.emitEvent({
      type: 'trade',
      data: tradeData,
      timestamp: Date.now()
    })
  }

  /**
   * 处理深度消息
   */
  private handleDepthMessage(data: any): void {
    const depthData: DepthData = {
      symbol: data.s,
      bids: data.b.map((bid: [string, string]) => [parseFloat(bid[0]), parseFloat(bid[1])]),
      asks: data.a.map((ask: [string, string]) => [parseFloat(ask[0]), parseFloat(ask[1])]),
      timestamp: data.E
    }

    // 触发事件
    this.emitEvent({
      type: 'depth',
      data: depthData,
      timestamp: Date.now()
    })
  }

  /**
   * 发送ping消息（币安WebSocket不需要客户端主动发送ping）
   * 保留此方法但改为空实现，因为币安服务器会主动发送ping
   */
  private sendPing(): void {
    // 币安WebSocket服务器会主动发送ping，客户端只需要响应pong即可
    // 不需要主动发送ping消息，避免触发"missing field 'method'"错误
    // if (this.ws && this.state.status === WebSocketStatus.CONNECTED) {
    //   this.ws.send(JSON.stringify({ ping: Date.now() }))
    // }
  }

  /**
   * 开始心跳定时器
   */
  private startPingTimer(): void {
    this.stopPingTimer()
    this.pingTimer = setInterval(() => {
      this.sendPing()
    }, this.config.pingInterval)
  }

  /**
   * 停止心跳定时器
   */
  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /**
   * 合并短时间内的订阅变更，避免逐交易对发送消息触发 Binance WebSocket 频率限制。
   */
  private scheduleSubscriptionFlush(): void {
    if (this.subscriptionFlushTimer) return
    this.subscriptionFlushTimer = setTimeout(() => {
      this.subscriptionFlushTimer = null
      this.flushSubscriptionChanges()
    }, 100)
  }

  private flushSubscriptionChanges(): void {
    if (!this.ws || this.state.status !== WebSocketStatus.CONNECTED) return

    const subscribeStreams = Array.from(this.pendingPriceSubscriptions, symbol =>
      `${this.formatSymbolForWebSocket(symbol)}@ticker`
    )
    const unsubscribeStreams = Array.from(this.pendingPriceUnsubscriptions, symbol =>
      `${this.formatSymbolForWebSocket(symbol)}@ticker`
    )
    this.pendingPriceSubscriptions.clear()
    this.pendingPriceUnsubscriptions.clear()

    if (subscribeStreams.length > 0) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: subscribeStreams,
        id: this.createRequestId()
      }))
    }
    if (unsubscribeStreams.length > 0) {
      this.ws.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: unsubscribeStreams,
        id: this.createRequestId()
      }))
    }
  }

  private clearPendingSubscriptionChanges(): void {
    if (this.subscriptionFlushTimer) {
      clearTimeout(this.subscriptionFlushTimer)
      this.subscriptionFlushTimer = null
    }
    this.pendingPriceSubscriptions.clear()
    this.pendingPriceUnsubscriptions.clear()
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(minimumDelayMs = 0): void {
    if (this.manuallyDisconnected || this.reconnectTimer) {
      return
    }

    if (this.state.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`❌ 达到最大重连次数: ${this.config.maxReconnectAttempts}`)
      return
    }

    this.state.reconnectAttempts++
    const delay = Math.max(
      minimumDelayMs,
      this.config.reconnectInterval * Math.pow(1.5, this.state.reconnectAttempts - 1)
    )
    this.reconnectNotBefore = Date.now() + delay
    
    console.log(`🔄 ${this.state.reconnectAttempts}/${this.config.maxReconnectAttempts} 将在 ${delay}ms后重连...`)
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.manuallyDisconnected) return
      this.reconnectNotBefore = 0
      this.updateStatus(WebSocketStatus.RECONNECTING)
      this.connect().catch(error => {
        console.error('❌ 重连失败:', error)
      })
    }, delay)
  }

  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * 更新状态
   */
  private updateStatus(status: WebSocketStatus): void {
    this.state.status = status
    // console.log(`📊 WebSocket状态更新: ${status}`)
  }

  /**
   * 触发事件
   */
  private emitEvent(event: WebSocketEvent): void {
    const handlers = this.eventHandlers.get(event.type)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event)
        } catch (error) {
          console.error(`❌ 事件处理器错误 (${event.type}):`, error)
        }
      })
    }
  }
}
