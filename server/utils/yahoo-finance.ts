// ==================== Yahoo Finance 原生 K 线适配 ====================
import type { KLineData } from '../../types/kline-simple'
import type { MacroPeriod } from '../../types/macro-market'

// 本地周期与币安保持一致；Yahoo 原生周线使用 1wk，不能将返回周期误判为不匹配。
const YAHOO_INTERVALS: Record<MacroPeriod, string> = {
  '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1wk',
}

/** Yahoo Chart 响应中用于 OHLCV 标准化的字段。 */
interface YahooPayload {
  chart: {
    error?: { description?: string } | null
    result?: Array<{
      meta: { dataGranularity?: string; regularMarketTime?: number }
      timestamp?: number[]
      indicators: { quote: Array<Record<string, Array<number | null>>> }
    }> | null
  }
}

/** 过滤空值、去重并保留上游原生周期，不聚合或补造休市柱。 */
export function normalizeYahooKlines(payload: YahooPayload, timeframe: MacroPeriod): KLineData[] {
  if (payload.chart.error) throw new Error(payload.chart.error.description || 'Yahoo 返回错误')
  const result = payload.chart.result?.[0]
  if (!result || result.meta.dataGranularity !== YAHOO_INTERVALS[timeframe]) throw new Error('Yahoo 返回周期不匹配或无数据')
  // 恒生科技可能仅返回随报价变化的单点，持续追加会伪造出多根“日线”。
  if (timeframe === '1d' && result.timestamp?.length === 1 && result.timestamp[0] === result.meta.regularMarketTime) {
    throw new Error('Yahoo 仅返回当前报价，暂无原生日线历史')
  }
  const quote = result.indicators.quote[0]
  if (!quote) throw new Error('Yahoo 缺少 OHLC 数据')
  const bars = new Map<number, KLineData>()
  for (const [index, timestamp] of (result.timestamp || []).entries()) {
    const open = quote.open?.[index], high = quote.high?.[index]
    const low = quote.low?.[index], close = quote.close?.[index]
    if (![timestamp, open, high, low, close].every(value => typeof value === 'number' && Number.isFinite(value))) continue
    // Yahoo 有时附加当前报价快照，时间不对应周期起点；它不是独立 K 线。
    if (timestamp === result.meta.regularMarketTime && index > 0) {
      const previous = result.timestamp![index - 1]!
      const seconds = { '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 }[timeframe]
      if (timestamp - previous < seconds) continue
    }
    if (timestamp <= 0 || high! < Math.max(open!, close!) || low! > Math.min(open!, close!) || high! < low!) continue
    const volume = quote.volume?.[index]
    bars.set(timestamp, { timestamp, open: open!, high: high!, low: low!, close: close!, volume: typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 ? volume : 0 })
  }
  return [...bars.values()].sort((a, b) => a.timestamp - b.timestamp)
}

/** 首次补历史，之后重取末尾区间以覆盖尚未收盘的柱；4h 直接请求上游。 */
export async function fetchYahooKlines(symbol: string, timeframe: MacroPeriod, from?: number): Promise<KLineData[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('interval', YAHOO_INTERVALS[timeframe])
  if (from) {
    // 分钟历史有保留上限；服务长期停机后从允许的窗口重新补齐。
    const retention = timeframe === '15m' ? 29 * 86400 : 729 * 86400
    const start = timeframe === '1d' || timeframe === '1w' ? from : Math.max(from, Math.floor(Date.now() / 1000) - retention)
    url.searchParams.set('period1', String(Math.floor(start)))
    url.searchParams.set('period2', String(Math.floor(Date.now() / 1000)))
  } else {
    // 十年原生周线覆盖默认视区及缓存容量，不从日线进行本地聚合。
    url.searchParams.set('range', timeframe === '1w' ? '10y' : timeframe === '1d' ? '5y' : timeframe === '15m' ? '1mo' : '2y')
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`)
  return normalizeYahooKlines(await response.json() as YahooPayload, timeframe)
}
