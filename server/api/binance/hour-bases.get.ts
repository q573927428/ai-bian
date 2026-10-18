// ==================== 已选交易对本地 K 线小时周期参考价格 ====================
import { getBotConfig } from '../../utils/storage'
import { getSimpleKLineData, initKLineDb } from '../../utils/kline-simple-storage'

/** 只读系统已有的 5m K 线，不触发外部行情请求或补数。 */
export default defineEventHandler(async (event) => {
  const period = getQuery(event).period ?? '1h'
  if (period !== '1h' && period !== '4h') {
    throw createError({ statusCode: 400, statusMessage: 'period must be 1h or 4h' })
  }
  const hours = period === '4h' ? 4 : 1
  const config = await getBotConfig()
  await initKLineDb()
  const symbols = [...new Set((config.symbols || []).map(symbol => symbol.replace('/', '').toUpperCase()))]
  // 两个小时周期统一使用目标时刻所在 5m 的开盘价，精度为 5 分钟。
  const referenceTime = Math.floor(Date.now() / 300000) * 300000 - hours * 3600000
  const timestamp = referenceTime / 1000
  const bases: Record<string, number> = {}
  for (const symbol of symbols) {
    const bar = getSimpleKLineData(symbol, '5m', { from: timestamp, to: timestamp, limit: 1 })[0]
    // 缺失目标 K 线时保留待更新状态，避免使用更早行情误报方向。
    if (bar && Number.isFinite(bar.o) && bar.o > 0) bases[symbol] = bar.o
  }
  return { bases, referenceTime }
})
