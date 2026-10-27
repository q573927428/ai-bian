// ==================== 市场广度聚合与看板实时计算 ====================
import type { BreadthPeriod, BreadthStatistics } from '../../types/market-breadth'
import type { PriceData } from '../../types/websocket'

/** 有效样本包含持平，缺失行情不按零处理，空样本的占比和中位数返回 null。 */
export function summarizeBreadth(changes: Record<string, number | null>, referenceTime: number | null, bases: Record<string, number> = {}): BreadthStatistics {
  const values = Object.values(changes).filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b)
  const upCount = values.filter(value => value > 0).length
  const downCount = values.filter(value => value < 0).length
  const middle = Math.floor(values.length / 2)
  const medianChangePct = !values.length ? null : values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2
  return {
    validCount: values.length, upCount, downCount, flatCount: values.length - upCount - downCount,
    missingCount: Object.keys(changes).length - values.length,
    upRatioPct: values.length ? upCount / values.length * 100 : null,
    medianChangePct, referenceTime, changes, bases
  }
}

/** 看板只在浏览器中重新聚合实时行情，不修改 AI 固定快照或请求历史数据。 */
export function calculateLiveBreadth(symbols: string[], prices: Record<string, PriceData>, period: BreadthPeriod,
  bases: Record<string, number>, referenceTime: number | null, now: number): BreadthStatistics {
  const changes: Record<string, number | null> = {}
  for (const symbol of symbols) {
    changes[symbol] = null
    const ticker = prices[symbol]
    if (!ticker || !Number.isFinite(ticker.price) || ticker.price <= 0 || !Number.isFinite(ticker.timestamp)
      || now - ticker.timestamp > 120000 || ticker.timestamp > now + 60000) continue
    const base = bases[symbol]
    // 包括24h在内均复用服务端5m基准，不使用ticker的滚动统计字段。
    const change = Number.isFinite(base) && base! > 0 ? (ticker.price / base! - 1) * 100 : null
    if (typeof change === 'number' && Number.isFinite(change)) changes[symbol] = change
  }
  return summarizeBreadth(changes, referenceTime, bases)
}
