// 强制开仓接口 - 告知AI置信度100和finalScore评分100，直接开仓
import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getStrategyManager } from '../../../modules/strategy-manager'

export default defineEventHandler(async (event) => {
  const strategyId = getRouterParam(event, 'id')
  const { symbol, direction } = await readBody(event)

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

  if (!direction || !['long', 'short'].includes(direction)) {
    return {
      success: false,
      error: '方向必须为 long 或 short'
    }
  }

  try {
    const strategyManager = getStrategyManager()
    const result = await strategyManager.forceOpenPosition(strategyId, symbol, direction)
    
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