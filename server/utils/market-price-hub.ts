// ==================== 实时价格广播中心 ====================

import type { PriceData, WebSocketClientState } from '../../types/websocket'
import { getBotConfig } from './storage'
import { webSocketManager } from './websocket-manager'

const BROADCAST_INTERVAL_MS = 200

/**
 * SSE 价格客户端
 *
 * send 负责把具名事件写入单个浏览器连接；不同客户端的写入失败必须彼此隔离。
 */
export interface MarketPriceClient {
  send(event: MarketPriceEventName, payload: MarketPriceEventPayload): Promise<void>
}

/** 行情中心对浏览器发布的事件名称。 */
export type MarketPriceEventName = 'snapshot' | 'prices' | 'status' | 'ping'

/**
 * SSE 事件统一载荷
 *
 * prices 仅在 snapshot/prices 事件中存在，status 仅在状态事件中存在。
 */
export interface MarketPriceEventPayload {
  timestamp: number
  prices?: Record<string, PriceData>
  status?: WebSocketClientState
}

/**
 * 单实例实时价格广播中心
 *
 * 核心职责：
 * 1. 按系统配置统一维护 Binance ticker 订阅
 * 2. 保存最新价格快照，并以固定窗口合并高频价格更新
 * 3. 向每个浏览器的单条 SSE 连接广播增量
 */
export class MarketPriceHub {
  private static instance: MarketPriceHub
  private readonly latestPrices = new Map<string, PriceData>()
  private readonly pendingUpdates = new Map<string, PriceData>()
  private readonly subscribedSymbols = new Set<string>()
  private readonly clients = new Set<MarketPriceClient>()
  private initializePromise: Promise<void> | null = null
  private broadcastTimer: NodeJS.Timeout | null = null
  private latestStatus: WebSocketClientState = webSocketManager.getWebSocketState()

  private readonly handlePriceUpdate = (price: PriceData): void => {
    this.latestPrices.set(price.symbol, price)
    this.pendingUpdates.set(price.symbol, price)
    this.scheduleBroadcast()
  }

  private constructor() {
    webSocketManager.subscribeStatus((state) => {
      this.latestStatus = state
      this.broadcast('status', {
        timestamp: Date.now(),
        status: state
      })
    })
  }

  /** 获取进程内唯一行情中心。 */
  static getInstance(): MarketPriceHub {
    if (!MarketPriceHub.instance) {
      MarketPriceHub.instance = new MarketPriceHub()
    }
    return MarketPriceHub.instance
  }

  /**
   * 初始化 Binance 连接，并把当前 bot 配置同步为统一行情订阅。
   */
  async initialize(): Promise<void> {
    if (this.initializePromise) {
      return await this.initializePromise
    }

    const initialization = (async () => {
      await webSocketManager.initialize()
      const config = await getBotConfig()
      this.applySymbols(config.symbols || [])
      this.latestStatus = webSocketManager.getWebSocketState()
    })()

    this.initializePromise = initialization
    try {
      await initialization
    } finally {
      if (this.initializePromise === initialization) {
        this.initializePromise = null
      }
    }
  }

  /**
   * 热同步交易对列表，仅对上游执行增量订阅和取消订阅。
   */
  async syncSymbols(symbols: string[]): Promise<void> {
    await webSocketManager.initialize()
    this.applySymbols(symbols)
    this.latestStatus = webSocketManager.getWebSocketState()
    this.broadcastSnapshot()
  }

  /** 获取全部最新价格的只读快照。 */
  getSnapshot(symbols?: string[]): Record<string, PriceData> {
    const requestedSymbols = symbols?.length
      ? symbols.map(symbol => this.normalizeSymbol(symbol))
      : Array.from(this.latestPrices.keys())

    const snapshot: Record<string, PriceData> = {}
    requestedSymbols.forEach(symbol => {
      const price = this.latestPrices.get(symbol)
      if (price) snapshot[symbol] = price
    })
    return snapshot
  }

  /** 获取当前 Binance WebSocket 状态。 */
  getStatus(): WebSocketClientState {
    return webSocketManager.getWebSocketState()
  }

  /**
   * 注册浏览器 SSE 客户端。
   *
   * 快照会先进入该客户端的串行发送队列，后续增量不会越过首次快照。
   */
  registerClient(client: MarketPriceClient): () => void {
    void client.send('snapshot', {
      timestamp: Date.now(),
      prices: this.getSnapshot()
    }).catch(() => this.clients.delete(client))

    this.clients.add(client)
    void client.send('status', {
      timestamp: Date.now(),
      status: this.getStatus()
    }).catch(() => this.clients.delete(client))

    return () => this.clients.delete(client)
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '').trim().toUpperCase()
  }

  private applySymbols(symbols: string[]): void {
    const desiredSymbols = new Set(
      symbols.map(symbol => this.normalizeSymbol(symbol)).filter(Boolean)
    )

    const removed = Array.from(this.subscribedSymbols).filter(symbol => !desiredSymbols.has(symbol))
    const added = Array.from(desiredSymbols).filter(symbol => !this.subscribedSymbols.has(symbol))

    removed.forEach(symbol => {
      webSocketManager.unsubscribePrice(symbol, this.handlePriceUpdate)
      this.subscribedSymbols.delete(symbol)
      this.latestPrices.delete(symbol)
      this.pendingUpdates.delete(symbol)
    })

    added.forEach(symbol => {
      // 每个交易对只注册行情中心这一个回调，访问人数不会放大上游回调数量。
      webSocketManager.subscribePrice(symbol, this.handlePriceUpdate)
      this.subscribedSymbols.add(symbol)
    })
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.flushPendingPrices()
    }, BROADCAST_INTERVAL_MS)
  }

  private flushPendingPrices(): void {
    if (this.pendingUpdates.size === 0) return
    const prices = Object.fromEntries(this.pendingUpdates)
    this.pendingUpdates.clear()
    this.broadcast('prices', { timestamp: Date.now(), prices })
  }

  private broadcastSnapshot(): void {
    this.broadcast('snapshot', {
      timestamp: Date.now(),
      prices: this.getSnapshot()
    })
  }

  private broadcast(event: MarketPriceEventName, payload: MarketPriceEventPayload): void {
    this.clients.forEach(client => {
      void client.send(event, payload).catch(() => {
        // 单个连接失效时只剔除该客户端，不能影响其他浏览器或 Binance 消息处理。
        this.clients.delete(client)
      })
    })
  }
}

export const marketPriceHub = MarketPriceHub.getInstance()
