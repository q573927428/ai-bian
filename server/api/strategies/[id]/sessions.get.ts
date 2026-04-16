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

  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string, 10) : undefined

  try {
    const sessions = await strategyStore.getSessions(id, limit)
    
    return {
      success: true,
      data: sessions,
      total: sessions.length
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取会话历史失败: ${error.message}`
    })
  }
})