// ==================== 按需共享的盘口行情服务 ====================
import WebSocket from 'ws'
import { LocalOrderBook } from './local-order-book'
import { binanceApiGateway } from './binance-api-gateway'
import type { DepthSnapshot, DepthUpdate, OrderBookSnapshot } from '../../types/order-book'

type Listener = (snapshot: OrderBookSnapshot) => void
let snapshotRequestId = 0

/** 容量拒绝属于可预期状态，供 SSE 明确通知浏览器停止自动重连。 */
export class OrderBookCapacityError extends Error {
  constructor() { super('盘口已达 3 个交易对上限，请关闭其他盘口后手动重试') }
}

/** 单交易对共享连接；最后一个图表关闭时释放上游连接和所有计时器。 */
class OrderBookSession {
  readonly listeners = new Set<Listener>()
  private book: LocalOrderBook
  private socket: WebSocket | null = null
  private retryTimer?: ReturnType<typeof setTimeout>
  private broadcastTimer: ReturnType<typeof setInterval>
  private controller: AbortController | null = null
  private stopped = false
  private failures = 0
  private connectedAt = 0

  constructor(private symbol: string) {
    this.book = new LocalOrderBook(symbol)
    this.broadcastTimer = setInterval(() => {
      const snapshot = this.book.snapshot()
      this.publish(snapshot)
      // 同步或行情停滞时换连接重建，避免永久停在空白状态。
      if (this.socket && (Date.now() - (snapshot.receivedAt || this.connectedAt) > 20000
        || snapshot.updatedAt > 0 && Date.now() - snapshot.updatedAt > 20000)) this.retry()
      // 在覆盖耗尽前补一次新快照；普通价格移动无需断开 WebSocket。
      if (snapshot.status === 'live' && this.socket && this.book.needsRecenter()
        && !binanceApiGateway.shouldPauseBackgroundWork()) void this.load(this.socket)
    }, 500)
    this.connect()
  }

  /** 只读行情连接，使用 Public 路由，不与现有 ticker 的 Market 路由混用。 */
  private connect(): void {
    if (this.stopped) return
    this.book = new LocalOrderBook(this.symbol)
    this.connectedAt = Date.now()
    const socket = new WebSocket('wss://fstream.binance.com/public/stream', { handshakeTimeout: 10000 })
    this.socket = socket
    socket.on('open', () => {
      if (this.socket !== socket) return
      socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${this.symbol.toLowerCase()}@depth@100ms`], id: 'depth' }))
    })
    socket.on('message', (raw) => {
      if (this.socket !== socket) return
      try {
        const envelope = JSON.parse(raw.toString())
        const data = envelope.data ?? envelope
        if (data.code !== undefined) throw new Error('盘口订阅失败')
        // 收到订阅确认后才取快照，保证期间的更新已进入缓冲。
        if (data.id === 'depth' && data.result === null) void this.load(socket)
        if (data.e === 'depthUpdate') {
          this.book.update(data as DepthUpdate)
          if (this.book.isLive()) this.failures = 0
        }
      } catch { this.retry() }
    })
    socket.on('error', () => { if (this.socket === socket) this.retry() })
    socket.on('close', () => { if (this.socket === socket) this.retry() })
    // ws 自动回应服务器 ping；无需额外发送 JSON 心跳或重复 pong。
  }

  /** 快照请求共用现有行情限流器，旧连接的迟到响应不能覆盖新订单簿。 */
  private async load(socket: WebSocket): Promise<void> {
    const controller = new AbortController()
    this.controller?.abort()
    this.controller = controller
    // 重新订阅期间继续缓存同一条连接的增量，新快照不能直接覆盖旧簿后跳过序号衔接。
    const book = new LocalOrderBook(this.symbol)
    this.book = book
    this.connectedAt = Date.now()
    this.publish(book.snapshot())
    try {
      if (binanceApiGateway.shouldPauseBackgroundWork()) throw new Error('行情限流中')
      const snapshot = await binanceApiGateway.fetchJson<DepthSnapshot>(
        // 旧观察者关闭会取消其请求；新会话不能被网关去重到那个已取消/过时的 Promise。
        'marketData', `depth:${this.symbol}:${++snapshotRequestId}:1000`,
        `https://fapi.binance.com/fapi/v1/depth?symbol=${this.symbol}&limit=1000`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }
      )
      if (this.socket === socket && this.controller === controller && !this.stopped) book.load(snapshot)
    } catch { if (this.socket === socket && this.controller === controller) this.retry() }
  }

  /** 断线立即清空可见挂单，指数退避防止快照失败后持续轰炸 API。 */
  private retry(): void {
    if (this.stopped || this.retryTimer) return
    const socket = this.socket
    this.socket = null
    this.controller?.abort()
    socket?.terminate()
    this.book = new LocalOrderBook(this.symbol)
    this.publish({ ...this.book.snapshot(), status: 'disconnected' })
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.failures++, 5)) + Math.random() * 1000
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.connect() }, delay)
  }

  private publish(snapshot: OrderBookSnapshot): void {
    for (const listener of this.listeners) listener(snapshot)
  }

  /** 无观察者或 Nitro 关闭时终止连接，释放未完成的快照请求。 */
  stop(): void {
    this.stopped = true
    clearInterval(this.broadcastTimer)
    clearTimeout(this.retryTimer)
    this.controller?.abort()
    const socket = this.socket
    this.socket = null
    socket?.terminate()
    this.listeners.clear()
  }
}

/** 按交易对复用订阅；限制同时观察的交易对数量，避免浏览器放大上游资源用量。 */
class OrderBookHub {
  private sessions = new Map<string, OrderBookSession>()

  subscribe(symbol: string, listener: Listener): () => void {
    let session = this.sessions.get(symbol)
    if (!session) {
      if (this.sessions.size >= 3) throw new OrderBookCapacityError()
      session = new OrderBookSession(symbol)
      this.sessions.set(symbol, session)
    }
    session.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      session.listeners.delete(listener)
      if (!session.listeners.size) { session.stop(); this.sessions.delete(symbol) }
    }
  }

  close(): void {
    for (const session of this.sessions.values()) session.stop()
    this.sessions.clear()
  }
}

export const orderBookHub = new OrderBookHub()
