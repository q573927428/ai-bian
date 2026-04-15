// GET /api/strategies/[id] - 获取单个策略

import { getStrategyManager } from '../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  try {
    const strategyManager = getStrategyManager()
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '策略ID不能为空'
      })
    }

    const strategy = await strategyManager.getStrategy(id)

    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    const status = await strategyManager.getStrategyStatus(id)

    return {
      success: true,
      data: strategy,
      status
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取策略失败: ${error.message}`
    })
  }
})
