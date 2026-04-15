// POST /api/strategies/[id]/toggle - 激活/停用策略

import { getStrategyManager } from '../../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  try {
    const strategyManager = getStrategyManager()
    const id = getRouterParam(event, 'id')
    const body = await readBody<{ active: boolean }>(event)

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '策略ID不能为空'
      })
    }

    const strategy = await strategyManager.toggleStrategy(id, body.active)

    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    return {
      success: true,
      message: body.active ? '策略已激活' : '策略已停用',
      data: strategy
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `切换策略状态失败: ${error.message}`
    })
  }
})
