// GET /api/positions - 获取所有活跃仓位

import { positionManager } from '../../modules/position-manager/PositionManager'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const strategyId = query.strategyId as string | undefined

    let positions
    if (strategyId) {
      positions = positionManager.getStrategyPositions(strategyId)
    } else {
      positions = positionManager.getActivePositions()
    }

    const stats = positionManager.getPositionStats()

    return {
      success: true,
      data: positions,
      stats
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取仓位失败: ${error.message}`
    })
  }
})
