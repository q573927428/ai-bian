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
  const symbol = query.symbol as string | undefined

  try {
    const records = await strategyStore.getTradeRecords(id, limit, symbol)
    
    return {
      success: true,
      data: records,
      total: records.length
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取交易记录失败: ${error.message}`
    })
  }
})