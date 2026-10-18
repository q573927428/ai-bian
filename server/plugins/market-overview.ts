// ==================== 市场概览后台同步生命周期 ====================
import { MARKET_REFRESH_MS, refreshMarketOverview } from '../utils/market-overview'

export default defineNitroPlugin((nitroApp) => {
  // 启动立即预热，定时任务不阻塞服务器启动或接口响应。
  void refreshMarketOverview()
  const timer = setInterval(() => { void refreshMarketOverview() }, MARKET_REFRESH_MS)
  timer.unref()
  nitroApp.hooks.hook('close', () => { clearInterval(timer) })
})
