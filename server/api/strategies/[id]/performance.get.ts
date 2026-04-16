import type { H3Event } from 'h3'
import { strategyStore } from '../../../modules/strategy-store/StrategyStore'

export default defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      message: '策略ID不能为空'
    })
  }

  try {
    const performance = await strategyStore.getPerformance(id)
    if (!performance) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }
    
    return {
      success: true,
      data: performance
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取性能统计失败: ${error.message}`
    })
  }
})