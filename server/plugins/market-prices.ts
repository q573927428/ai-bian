// ==================== 后端实时行情订阅生命周期 ====================
import { marketPriceHub } from '../utils/market-price-hub'
import { logger } from '../utils/logger'
import { WebSocketStatus } from '../../types/websocket'

const RETRY_INTERVAL_MS = 30_000

export default defineNitroPlugin((nitroApp) => {
  let stopped = false
  let initialized = false
  let pending: Promise<void> | null = null

  /** 不阻塞服务启动；连接失败或断线重连耗尽后，仍由后端周期性尝试恢复订阅。 */
  const ensureSubscribed = (): void => {
    if (stopped || pending) return
    if (initialized && marketPriceHub.getStatus().status === WebSocketStatus.CONNECTED) return
    pending = marketPriceHub.initialize()
      .then(() => { initialized = true })
      .catch((error: unknown) => {
        initialized = false
        logger.warn('实时行情', `后台行情订阅初始化失败，30秒后重试：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { pending = null })
  }

  ensureSubscribed()
  const timer = setInterval(ensureSubscribed, RETRY_INTERVAL_MS)
  timer.unref()
  nitroApp.hooks.hook('close', async () => {
    stopped = true
    clearInterval(timer)
    // 等待在途初始化结束再关闭，避免配置读取完成后在已关闭的服务里重新订阅。
    await pending
    marketPriceHub.close()
  })
})
