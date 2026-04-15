import { getStrategyManager } from '../../modules/strategy-manager'
import { logger } from '../../utils/logger'

export default defineEventHandler(async () => {
  try {
    // 获取策略管理器和引擎实例
    const strategyManager = getStrategyManager()
    const engine = (strategyManager as any).engine

    if (engine) {
      // 清理StrategyEngine中的AI缓存
      engine.clearAICache()
      
      // 清理MultiStrategyAIAnalyzer中的AI缓存
      if (engine.aiAnalyzer) {
        engine.aiAnalyzer.clearCache()
      }
    }

    logger.info('API', 'AI缓存已全部清理')

    return {
      success: true,
      message: 'AI缓存已清理完成',
      timestamp: new Date().toISOString()
    }
  } catch (error: any) {
    logger.error('API', `清理AI缓存失败: ${error.message}`)
    throw createError({
      statusCode: 500,
      statusMessage: '清理AI缓存失败',
      message: error.message
    })
  }
})