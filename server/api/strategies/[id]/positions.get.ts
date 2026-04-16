// GET /api/strategies/[id]/positions - 获取策略的活跃持仓

import { positionManager } from '../../../modules/position-manager/PositionManager'
import { strategyStore } from '../../../modules/strategy-store/StrategyStore'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      message: '策略ID不能为空'
    })
  }

  try {
    // 验证策略是否存在
    const strategy = await strategyStore.getStrategy(id)
    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    const positions = positionManager.getStrategyPositions(id)
    
    return {
      success: true,
      data: positions
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取持仓失败: ${error.message}`
    })
  }
})