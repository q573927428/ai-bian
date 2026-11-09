// ==================== 榜单本地 30 日价格曲线 ====================
import { getSimpleKLineData, initKLineDb } from '../../utils/kline-simple-storage'

/** 带实际时间的本地收盘价序列，前端据此保留缺口和不足 30 天的空白。 */
interface LocalPriceCurve {
  points: [number, number][]
  intervalSeconds: number
  from: number
  to: number
}

/** 批量读取当前页曲线，仅访问本地数据库，缺少历史时不触发同步或远端补数。 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const symbols = [...new Set(String(query.symbols || '').split(',')
    .map(symbol => symbol.trim().replace(/\//g, '').toUpperCase())
    .filter(symbol => /^[A-Z0-9_]{1,40}USDT$/.test(symbol)))].slice(0, 200)
  const data: Record<string, LocalPriceCurve> = {}
  if (!symbols.length) return { success: true, data }

  const to = Math.floor(Date.now() / 1000)
  const from = to - 30 * 86400
  try {
    await initKLineDb()
    for (const symbol of symbols) {
      // 4h 序列兼顾曲线细节与返回体积；没有可用序列再尝试日线和小时线。
      for (const [timeframe, intervalSeconds] of [['4h', 14400], ['1d', 86400], ['1h', 3600]] as const) {
        const candles = getSimpleKLineData(symbol, timeframe, {
          from, to, limit: Math.ceil(30 * 86400 / intervalSeconds) + 1,
        })
        const points: [number, number][] = candles
          .filter(candle => Number.isFinite(candle.t) && candle.t >= from && candle.t <= to && Number.isFinite(candle.c) && candle.c > 0)
          .map(candle => [candle.t, candle.c])
        if (points.length < 2) continue
        data[symbol] = { points, intervalSeconds, from, to }
        break
      }
    }
  } catch {
    // 数据库不可用时曲线留空，不影响主榜单及其刷新。
  }
  return { success: true, data }
})
