// ==================== 独立宏观 K 线同步服务 ====================
import { MACRO_MARKETS, MACRO_PERIODS, macroStorageSymbol } from '../../../types/macro-market'
import { initKLineDb, getSimpleKLineData, appendSimpleKLineData } from '../../utils/kline-simple-storage'
import { fetchYahooKlines } from '../../utils/yahoo-finance'

/** 每个标的周期独立记录新鲜度、错误和退避状态。 */
interface MacroSyncStatus {
  updatedAt: number | null
  error?: string
  failures: number
  nextAttempt: number
}
const statuses = new Map<string, MacroSyncStatus>()
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let stopped = true

/** 供本地接口展示最后成功时间与上游错误，不触发额外同步。 */
export function getMacroSyncStatus(id: string, period: string): MacroSyncStatus | undefined {
  return statuses.get(`${id}:${period}`)
}

/** 顺序请求减少上游限流；失败只影响当前标的周期，缓存始终保留。 */
async function syncMarkets(): Promise<void> {
  await initKLineDb()
  for (const market of MACRO_MARKETS.filter(item => item.source === 'yahoo')) {
    for (const period of MACRO_PERIODS) {
      if (stopped) return
      const key = `${market.id}:${period}`
      const status = statuses.get(key) || { updatedAt: null, failures: 0, nextAttempt: 0 }
      if (Date.now() < status.nextAttempt) continue
      const symbol = macroStorageSymbol(market)
      const startedAt = Date.now()
      console.log(`[MacroSync] 开始同步: ${market.name} (${market.symbol})/${period}`)
      try {
        const cached = getSimpleKLineData(symbol, period, { limit: 495 })
        // 数据不足时重新补历史；否则回退两根，修正上游的末根修订。
        const from = cached.length >= 400 ? cached[Math.max(0, cached.length - 3)]?.t : undefined
        const bars = await fetchYahooKlines(market.symbol, period, from)
        if (!bars.length) throw new Error('Yahoo 未返回有效 K 线')
        if (!appendSimpleKLineData(symbol, period, bars)) throw new Error('宏观 K 线写入失败')
        const refreshMs = { '15m': 120000, '1h': 300000, '4h': 600000, '1d': 1800000, '1w': 3600000 }[period]
        statuses.set(key, { updatedAt: Date.now(), failures: 0, nextAttempt: Date.now() + refreshMs })
        // 条数包含末根修订和历史回填，不能作为新增 K 线数量解读。
        console.log(`[MacroSync] 同步成功: ${market.name} (${market.symbol})/${period}，写入 ${bars.length} 条K线，耗时 ${Date.now() - startedAt}ms`)
      } catch (error) {
        const failures = status.failures + 1
        const message = error instanceof Error ? error.message : String(error)
        statuses.set(key, { ...status, error: message, failures, nextAttempt: Date.now() + Math.min(1800000, 60000 * 2 ** Math.min(failures, 5)) })
        console.warn(`[MacroSync] ${market.symbol}/${period}: ${message}`)
      }
    }
  }
}

/** 独立后台启动，不阻塞币安初始化及策略预计算。 */
export function startMacroSync(): void {
  if (!stopped) return
  stopped = false
  console.log('[MacroSync] 宏观K线后台同步服务已启动（Yahoo 来源）')
  const tick = () => {
    if (stopped) return
    running = syncMarkets().catch(error => console.warn('[MacroSync]', error)).finally(() => {
      running = undefined
      if (!stopped) {
        timer = setTimeout(tick, 30000)
        timer.unref()
      }
    })
  }
  tick()
}

/** 先等待在途写入完成，再允许主插件关闭共享数据库。 */
export async function stopMacroSync(): Promise<void> {
  stopped = true
  if (timer) clearTimeout(timer)
  await running
}
