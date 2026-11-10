// ==================== 图表按需加载更早的 K 线 ====================
import { binanceApiGateway } from '../../utils/binance-api-gateway'
import type { SimpleKLineData } from '../../../types/kline-simple'

/** 历史只返回给图表，不写入自动同步的 495 根窗口，避免被同步裁剪。 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const symbol = typeof query.symbol === 'string' ? query.symbol.replace('/', '').toUpperCase() : ''
  const timeframe = typeof query.timeframe === 'string' ? query.timeframe : ''
  const before = Number(query.before)
  if (!/^[A-Z0-9_]{1,40}$/.test(symbol)
    || !['5m', '15m', '1h', '4h', '1d', '1w'].includes(timeframe)
    || !Number.isSafeInteger(before) || before <= 0 || before > Math.floor(Date.now() / 1000)) {
    throw createError({ statusCode: 400, message: '无效的交易对、周期或历史时间边界' })
  }

  // Binance endTime 包含边界，减 1 毫秒确保不会重复当前最早一根。
  const params = new URLSearchParams({ symbol, interval: timeframe, limit: '499', endTime: String(before * 1000 - 1) })
  try {
    const rows = await binanceApiGateway.fetchJson<Array<Array<string | number>>>(
      'marketData', `klines:${symbol}:${timeframe}:0:${before * 1000 - 1}:499`,
      `https://fapi.binance.com/fapi/v1/klines?${params}`,
      { signal: AbortSignal.timeout(15000) }
    )
    const data: SimpleKLineData[] = rows.map(row => ({
      t: Math.floor(Number(row[0]) / 1000),
      o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]),
      q: Number(row[7]), bq: Number(row[10])
    })).filter(bar => bar.t < before)
    return { success: true, data, hasMore: rows.length === 499 }
  } catch (error) {
    console.error(`加载更早K线失败: ${symbol}/${timeframe}`, error)
    throw createError({ statusCode: 502, message: '加载更早K线失败，请稍后重试' })
  }
})
