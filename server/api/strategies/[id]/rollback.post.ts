// POST /api/strategies/[id]/rollback - 回滚策略版本

import { getStrategyManager } from '../../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  try {
    const strategyManager = getStrategyManager()
    const id = getRouterParam(event, 'id')
    const body = await readBody<{ targetVersion: number }>(event)

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '策略ID不能为空'
      })
    }

    if (!body.targetVersion) {
      throw createError({
        statusCode: 400,
        message: '目标版本号不能为空'
      })
    }

    const strategy = await strategyManager.rollbackStrategy(id, body.targetVersion)

    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略或版本不存在'
      })
    }

    return {
      success: true,
      message: `策略已回滚到 v${strategy.version}`,
      data: strategy
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `回滚策略失败: ${error.message}`
    })
  }
})
