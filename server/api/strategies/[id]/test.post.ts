// POST /api/strategies/[id]/test - 测试策略信号

import { getStrategyManager } from '../../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  try {
    const strategyManager = getStrategyManager()
    const id = getRouterParam(event, 'id')
    const body = await readBody<{ symbol: string }>(event)

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '策略ID不能为空'
      })
    }

    if (!body.symbol) {
      throw createError({
        statusCode: 400,
        message: '交易对不能为空'
      })
    }

    const result = await strategyManager.testStrategySignal(id, body.symbol)

    return {
      success: true,
      message: '测试完成',
      data: result
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `测试策略失败: ${error.message}`
    })
  }
})
