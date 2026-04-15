// GET /api/strategies/[id]/versions - 获取版本历史

import { getStrategyManager } from '../../../modules/strategy-manager'

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

    const versions = await strategyManager.getVersionHistory(id)

    if (!versions) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    return {
      success: true,
      data: versions
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取版本历史失败: ${error.message}`
    })
  }
})
