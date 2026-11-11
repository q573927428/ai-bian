// ==================== 市场广度聚合与看板实时计算 ====================
import type { BreadthPeriod, BreadthStatistics, BreadthAssetCategory, MarketBreadthSnapshot } from '../../types/market-breadth'
import type { PriceData } from '../../types/websocket'

export const BREADTH_CATEGORY_LABELS: Record<BreadthAssetCategory, string> = {
  crypto: '加密资产', tradfi: '传统金融资产', unknown: '分类未知'
}

/** 官方标的类型优先于合约形式，避免把普通永续形式的传统资产当成加密资产。 */
export function classifyBreadthAsset(metadata?: { symbol?: string; contractType: string; underlyingType?: unknown; underlyingSubType?: unknown }): BreadthAssetCategory {
  if (!metadata) return 'unknown'
  // 黄金锚定代币按底层资产归入传统金融，避免其普通 COIN 合约形式掩盖市场驱动差异。
  if (metadata.symbol === 'PAXGUSDT' || metadata.symbol === 'XAUTUSDT') return 'tradfi'
  const type = typeof metadata.underlyingType === 'string' ? metadata.underlyingType.toUpperCase() : ''
  const subtypes = Array.isArray(metadata.underlyingSubType) ? metadata.underlyingSubType : []
  if (metadata.contractType === 'TRADIFI_PERPETUAL' || subtypes.includes('TradFi')
    || ['EQUITY', 'CN_EQUITY', 'HK_EQUITY', 'KR_EQUITY', 'COMMODITY', 'FX', 'PREMARKET'].includes(type)) return 'tradfi'
  // INDEX 可能属于加密或传统市场；要求明确 Crypto 标签，或已知的 DEFI 加密指数。
  if (metadata.contractType === 'PERPETUAL' && (type === 'COIN' || subtypes.includes('Crypto')
    || (type === 'INDEX' && metadata.symbol === 'DEFIUSDT'))) return 'crypto'
  return 'unknown'
}

/** 从同一固定快照筛选当前标的同类样本；未知分类不混排，也不回退到全市场。 */
export function selectBreadthForSymbol(snapshot: MarketBreadthSnapshot | undefined, symbol: string): MarketBreadthSnapshot | undefined {
  if (!snapshot?.assetCategories) return undefined
  const normalized = symbol.replace('/', '').trim().toUpperCase()
  const category = snapshot.assetCategories[normalized]
  if (!category || category === 'unknown' || !snapshot.symbols.includes(normalized)) return undefined
  const symbols = snapshot.symbols.filter(item => snapshot.assetCategories![item] === category)
  // 同类完整快照可直接复用，保留原始计数校验；混合快照才需要重新聚合。
  if (symbols.length === snapshot.symbols.length) return { ...snapshot, assetCategory: category }
  const periods = {} as MarketBreadthSnapshot['periods']
  for (const period of ['5m', '15m', '1h', '4h', '24h'] as const) {
    const stats = snapshot.periods[period]
    const pick = <T>(values: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(
      symbols.filter(item => values && Object.hasOwn(values, item)).map(item => [item, values![item]!]))
    const changes = Object.fromEntries(symbols.map(item => [item, stats.changes[item] ?? null]))
    periods[period] = { ...summarizeBreadth(changes, stats.referenceTime, pick(stats.bases)),
      atrs: pick(stats.atrs), atrPercents: pick(stats.atrPercents), normalizedChanges: pick(stats.normalizedChanges),
      rankingUnavailableReasons: pick(stats.rankingUnavailableReasons) }
  }
  return { ...snapshot, symbols, selectedCount: symbols.length, assetCategory: category, periods }
}

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
