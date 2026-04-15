// GET /api/strategies - 获取所有策略

import { getStrategyManager, initStrategyManager } from '../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  try {
    // 等待策略管理器初始化完成
    let strategyManager
    let retries = 0
    while (retries < 10) {
      try {
        strategyManager = getStrategyManager()
        break
      } catch (e) {
        // 如果未初始化，尝试主动初始化
        if (retries === 0) {
          try {
            await initStrategyManager()
            strategyManager = getStrategyManager()
            break
          } catch (initError) {
            // 初始化失败，继续重试
          }
        }
        retries++
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    if (!strategyManager) {
      throw new Error('策略管理系统正在初始化，请稍后重试')
    }
    const strategies = await strategyManager.getAllStrategies()
    const statuses = await strategyManager.getAllStrategiesStatus()

    return {
      success: true,
      data: strategies,
      statuses
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取策略列表失败: ${error.message}`
    })
  }
})
