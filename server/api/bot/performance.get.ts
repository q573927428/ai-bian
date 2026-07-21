import { getStrategyManager } from '../../modules/strategy-manager'
import { concurrencyPoolManager } from '../../utils/concurrency-pool'
import { binanceApiGateway } from '../../utils/binance-api-gateway'

export default defineEventHandler(async () => {
  try {
    const manager = getStrategyManager()
    const engine = manager.getEngine()
    const indicatorsHub = manager.getIndicatorsHub()
    const positionManager = engine.getPositionManager()
    const memory = process.memoryUsage()
    const toMiB = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2))

    return {
      success: true,
      data: {
        pools: concurrencyPoolManager.getAllStats(),
        binance: binanceApiGateway.getStatus(),
        memory: {
          ...memory,
          rssMiB: toMiB(memory.rss),
          heapTotalMiB: toMiB(memory.heapTotal),
          heapUsedMiB: toMiB(memory.heapUsed),
          externalMiB: toMiB(memory.external),
          arrayBuffersMiB: toMiB(memory.arrayBuffers)
        },
        indicators: indicatorsHub.getCacheStatus(),
        positions: positionManager.getPositionStats(),
        strategyLoop: engine.getLoopStats(),
        indicatorPrecompute: engine.getIndicatorPrecomputeStatus(),
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
