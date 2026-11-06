// ==================== 行情与首页展示所需的公开配置 ====================
import { defineEventHandler } from 'h3'
import { getBotConfig } from '../../utils/storage'

export default defineEventHandler(async () => {
  const config = await getBotConfig()
  // 公开交易对和首页本金展示，不向普通行情消费者提供全局调度、AI 与风控参数。
  return { success: true, data: {
    symbols: config.symbols, initialCapital: config.initialCapital,
    emaPeriods: config.emaPeriods, defaultTimeframe: config.defaultTimeframe,
    chartMarkerConfig: config.chartMarkerConfig, supportResistanceConfig: config.supportResistanceConfig,
    squareHeatWindows: config.squareHeatWindows,
  } }
})
