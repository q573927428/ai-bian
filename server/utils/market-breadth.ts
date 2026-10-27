// ==================== 已选交易对市场广度统一计算与缓存 ====================
import type { BotConfig } from '../../types'
import type { MarketBreadthSnapshot } from '../../types/market-breadth'
import { summarizeBreadth } from '../../app/utils/market-breadth'
import { getSimpleKLineData, initKLineDb } from './kline-simple-storage'
import { marketPriceHub } from './market-price-hub'

let cached: MarketBreadthSnapshot | null = null
let pending: { key: string; promise: Promise<MarketBreadthSnapshot> } | null = null

// 前端与服务端复用聚合口径，但各自保留实时展示和固定快照的更新节奏。
export { summarizeBreadth } from '../../app/utils/market-breadth'

/** 每轮预计算刷新一次；未启动预计算时按相同有效期惰性计算，并合并并发请求。 */
export async function getMarketBreadth(config: BotConfig, force = false): Promise<MarketBreadthSnapshot> {
  const symbols = [...new Set((config.symbols || []).map(symbol => symbol.replace('/', '').trim().toUpperCase()).filter(Boolean))].sort()
  const intervalMs = config.indicatorPrecompute?.enabled === false ? 60000
    : Math.max(60000, Number(config.indicatorPrecompute?.intervalMs ?? 300000))
  const key = JSON.stringify([symbols, intervalMs])
  if (pending?.key === key) return pending.promise
  if (!force && cached && JSON.stringify([cached.symbols, cached.expiresAt - cached.computedAt]) === key && Date.now() < cached.expiresAt) return cached
  const promise = (async (): Promise<MarketBreadthSnapshot> => {
    await initKLineDb()
    const now = Date.now()
    // 只消费行情中心已有快照，不初始化订阅、不发起 REST 请求或 K 线补数。
    const prices = marketPriceHub.getSnapshot(symbols)
    const periods = {} as MarketBreadthSnapshot['periods']
    for (const period of ['5m', '15m', '1h', '4h', '24h'] as const) {
      const periodMs = period === '5m' ? 300000 : period === '15m' ? 900000 : period === '1h' ? 3600000 : period === '4h' ? 14400000 : 86400000
      // 所有窗口统一使用本地5m开盘价；24h是滚动窗口，不是当日日线涨跌幅。
      const referenceTime = Math.floor(now / 300000) * 300000 - periodMs
      const changes: Record<string, number | null> = {}
      const bases: Record<string, number> = {}
      for (const symbol of symbols) {
        const ticker = prices[symbol]
        changes[symbol] = null
        // 历史基准独立于当前行情保存，ticker 稍后到达时前端即可计算，无需等待下轮快照。
        const timestamp = referenceTime / 1000
        const historicalBar = getSimpleKLineData(symbol, '5m', { from: timestamp, to: timestamp, limit: 1 })[0]
        if (historicalBar && Number.isFinite(historicalBar.o) && historicalBar.o > 0) bases[symbol] = historicalBar.o
        // 后台策略不能依赖浏览器启动 ticker 订阅；没有新鲜 ticker 时复用本地最新 5m 收盘价。
        const freshTicker = ticker && Number.isFinite(ticker.price) && ticker.price > 0 && Number.isFinite(ticker.timestamp)
          && now - ticker.timestamp <= 120000 && ticker.timestamp <= now + 60000
        const latest = freshTicker ? undefined : getSimpleKLineData(symbol, '5m', { limit: 1, to: Math.floor(now / 1000) })[0]
        const price = freshTicker ? ticker.price
          : latest && now - latest.t * 1000 <= 600000 && Number.isFinite(latest.c) && latest.c > 0 ? latest.c : null
        if (price === null) continue
        // 缺基准时保留未知，不能退回ticker的24h统计造成前后端口径不同。
        if (historicalBar && Number.isFinite(historicalBar.o) && historicalBar.o > 0) {
          const change = (price / historicalBar.o - 1) * 100
          if (Number.isFinite(change)) changes[symbol] = change
        }
      }
      periods[period] = summarizeBreadth(changes, referenceTime, bases)
    }
    const result: MarketBreadthSnapshot = { scope: 'selected_symbols', selectedCount: symbols.length, symbols, computedAt: now, expiresAt: now + intervalMs, periods }
    return result
  })()
  pending = { key, promise }
  try {
    const result = await promise
    // 配置变更后启动的新计算优先，旧请求不能覆盖新配置的快照。
    if (pending?.promise === promise) cached = result
    return result
  } finally {
    if (pending?.promise === promise) pending = null
  }
}

/** AI 接收市场聚合值及当前交易对涨跌幅，不展开其他交易对明细。 */
export function formatMarketBreadth(snapshot?: MarketBreadthSnapshot, symbol?: string): string {
  if (!snapshot) return '市场广度：暂无可用快照。'
  const lines = (['5m', '15m', '1h', '4h', '24h'] as const).map(period => {
    const stats = snapshot.periods[period]
    // 缺失数据明确标注，不能格式化为 0% 而被误解为持平。
    const ratio = stats.upRatioPct === null ? '暂无数据' : `${stats.upRatioPct.toFixed(2)}%`
    const median = stats.medianChangePct === null ? '暂无数据'
      : `${stats.medianChangePct >= 0 ? '+' : ''}${stats.medianChangePct.toFixed(2)}%`
    return `${period}：涨${stats.upCount}，跌${stats.downCount}，平${stats.flatCount}；上涨占比${ratio}，涨跌幅中位数${median}；有效${stats.validCount}，缺失${stats.missingCount}。`
  })
  const updatedAt = new Date(snapshot.computedAt).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
  const normalizedSymbol = symbol?.replace('/', '').trim().toUpperCase()
  // 使用同一轮快照，便于 AI 对比个币和整体方向，缺失时不能按持平处理。
  const currentSymbolLine = normalizedSymbol ? `当前交易对 ${normalizedSymbol}：${(['5m', '15m', '1h', '4h', '24h'] as const).map(period => {
    const change = snapshot.periods[period].changes[normalizedSymbol]
    const value = typeof change === 'number' && Number.isFinite(change)
      ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '暂无数据'
    return `${period}涨跌幅${value}`
  }).join('；')}。` : null
  return [
    `市场广度（已筛选${snapshot.selectedCount}个币安近30日交易量高且稳定交易对，供市场方向参考）：`,
    `更新时间：${updatedAt}${Date.now() >= snapshot.expiresAt ? '（数据已过期）' : ''}。`,
    ...lines,
    ...(currentSymbolLine ? [currentSymbolLine] : [])
  ].join('\n')
}
