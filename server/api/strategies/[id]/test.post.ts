// 手动触发策略分析接口
import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getStrategyManager } from '../../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  const strategyId = getRouterParam(event, 'id')
  const { symbol } = await readBody(event)

  if (!strategyId) {
    throw createError({
      statusCode: 400,
      message: '策略ID不能为空'
    })
  }

  if (!symbol) {
    return {
      success: false,
      error: '交易对不能为空'
    }
  }

  try {
    const strategyManager = getStrategyManager()
    const result = await strategyManager.testStrategySignal(strategyId, symbol)
    
    return {
      success: true,
      data: result
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    }
  }
})