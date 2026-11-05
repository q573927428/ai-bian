// ==================== USD-M 本地订单簿与序号同步 ====================
import type { DepthSnapshot, DepthUpdate, OrderBookSnapshot } from '../../types/order-book'

/** 维护连续的可见订单簿；序号断档后必须重取快照，禁止继续使用残缺数据。 */
export class LocalOrderBook {
  private bids = new Map<number, number>()
  private asks = new Map<number, number>()
  private pending: DepthUpdate[] = []
  private lastId: number | null = null
  private bridged = false
  private coverage: OrderBookSnapshot['coverage'] = null
  private updatedAt = 0
  private receivedAt = 0
  private loadedAt = 0
  private anchorPrice = 0
  private invalid = false

  constructor(private symbol: string) {}

  /** 高频消息处理只检查同步状态，避免为每条增量排序和复制整个订单簿。 */
  isLive(): boolean { return this.bridged && !this.invalid }

  /**
   * 现价消耗任一侧初始覆盖距离的 75% 时重新居中。
   * 至少间隔 30 秒，避免窄盘口或剧烈波动使快照请求持续消耗权重。
   */
  needsRecenter(now = Date.now()): boolean {
    if (!this.isLive() || !this.coverage || now - this.loadedAt < 30000) return false
    const midpoint = (Math.max(...this.bids.keys()) + Math.min(...this.asks.keys())) / 2
    const lowerTrigger = this.coverage.lower + (this.anchorPrice - this.coverage.lower) * 0.25
    const upperTrigger = this.coverage.upper - (this.coverage.upper - this.anchorPrice) * 0.25
    return midpoint <= lowerTrigger || midpoint >= upperTrigger
  }

  /** 先订阅并缓存增量，再加载 REST 快照；首个事件必须覆盖快照序号。 */
  load(snapshot: DepthSnapshot): void {
    if (!Number.isSafeInteger(snapshot.lastUpdateId) || !snapshot.bids?.length || !snapshot.asks?.length) {
      throw new Error('无效盘口快照')
    }
    this.bids.clear()
    this.asks.clear()
    this.coverage = null
    this.replace(this.bids, snapshot.bids)
    this.replace(this.asks, snapshot.asks)
    if (!this.bids.size || !this.asks.size || Math.max(...this.bids.keys()) >= Math.min(...this.asks.keys())) {
      throw new Error('无效盘口快照价格范围')
    }
    this.coverage = { lower: Math.min(...this.bids.keys()), upper: Math.max(...this.asks.keys()) }
    this.anchorPrice = (Math.max(...this.bids.keys()) + Math.min(...this.asks.keys())) / 2
    this.loadedAt = Date.now()
    this.lastId = snapshot.lastUpdateId
    this.bridged = false
    this.invalid = false
    const pending = this.pending
    this.pending = []
    for (const update of pending) this.update(update)
  }

  /** 校验合约增量连续性；零数量删除该档，不把绝对数量误作增量累加。 */
  update(update: DepthUpdate): void {
    if (update.s !== this.symbol) return
    if (![update.U, update.u, update.pu, update.E].every(Number.isSafeInteger) || update.U > update.u) {
      throw new Error('无效盘口更新序号')
    }
    if (this.lastId === null) {
      if (this.pending.length >= 2000) throw new Error('盘口同步缓冲超限')
      this.pending.push(update)
      return
    }
    if (this.bridged ? update.u <= this.lastId : update.u < this.lastId) return
    if (!this.bridged ? update.U > this.lastId : update.pu !== this.lastId) {
      throw new Error('盘口更新断档')
    }
    // 档位在旧边界之外可以继续改变。若最优买/卖价已穿过边界，过滤这些更新
    // 会留下一个看似正常的旧盘口；此时立即使其失效并重建，不等待居中冷却。
    if (this.coverage && (update.b.some(([p, q]) => Number(q) > 0 && Number(p) >= this.coverage!.upper)
      || update.a.some(([p, q]) => Number(q) > 0 && Number(p) <= this.coverage!.lower))) {
      this.invalid = true
      throw new Error('盘口价格已走出覆盖范围')
    }
    this.replace(this.bids, update.b)
    this.replace(this.asks, update.a)
    this.lastId = update.u
    this.bridged = true
    this.updatedAt = update.E
    this.receivedAt = Date.now()
    // 价格走出初始化覆盖区间时重建，不能把外部零散增量当成完整深度。
    if (!this.bids.size || !this.asks.size || this.bids.size + this.asks.size > 20000) {
      throw new Error('盘口覆盖范围需要重建')
    }
    if (Math.max(...this.bids.keys()) >= Math.min(...this.asks.keys())) throw new Error('盘口价格交叉')
  }

  /** 只发布已衔接且新鲜的盘口；同步中和陈旧数据不携带挂单数组。 */
  snapshot(now = Date.now()): OrderBookSnapshot {
    const status = !this.isLive() ? 'syncing'
      : now - this.receivedAt > 10000 || now - this.updatedAt > 10000 ? 'stale' : 'live'
    return {
      symbol: this.symbol, status, updatedAt: this.updatedAt, receivedAt: this.receivedAt,
      coverage: status === 'live' ? this.coverage : null,
      bids: status === 'live' ? [...this.bids].sort((a, b) => b[0] - a[0]) : [],
      asks: status === 'live' ? [...this.asks].sort((a, b) => a[0] - b[0]) : []
    }
  }

  /** 仅维护初始化时已知的价格范围，防止未知区间混入统计。 */
  private replace(side: Map<number, number>, levels: [string, string][]): void {
    for (const [rawPrice, rawQuantity] of levels) {
      const price = Number(rawPrice)
      const quantity = Number(rawQuantity)
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) {
        throw new Error('无效盘口价格或数量')
      }
      if (this.coverage && (price < this.coverage.lower || price > this.coverage.upper)) continue
      if (quantity === 0) side.delete(price)
      else side.set(price, quantity)
    }
  }
}
