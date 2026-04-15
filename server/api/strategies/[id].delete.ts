// DELETE /api/strategies/[id] - 删除策略

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

    const success = await strategyManager.deleteStrategy(id)

    if (!success) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    return {
      success: true,
      message: '策略已删除'
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `删除策略失败: ${error.message}`
    })
  }
})
