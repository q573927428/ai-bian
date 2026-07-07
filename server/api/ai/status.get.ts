import { getStrategyManager } from '../../modules/strategy-manager'

export default defineEventHandler(async () => {
  try {
    const manager = getStrategyManager()
    const engine = manager.getEngine()

    return {
      success: true,
      data: engine.getAIAnalyzerStatus()
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取 AI 状态失败'
    }
  }
})
