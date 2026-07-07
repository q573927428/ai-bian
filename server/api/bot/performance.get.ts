import { getStrategyManager } from '../../modules/strategy-manager'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { binanceApiGateway } from '../../utils/binance-api-gateway'

export default defineEventHandler(async () => {
  try {
    const manager = getStrategyManager()
    const engine = manager.getEngine()
    const indicatorsHub = manager.getIndicatorsHub()
    const positionManager = engine.getPositionManager()

    return {
      success: true,
      data: {
        pools: concurrencyPoolManager.getAllStats(),
        binance: binanceApiGateway.getStatus(),
        indicators: indicatorsHub.getCacheStatus(),
        positions: positionManager.getPositionStats(),
        ai: engine.getAIAnalyzerStatus()
      }
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取性能状态失败'
    }
  }
})
