// PUT /api/strategies/[id] - 更新策略

import { getStrategyManager } from '../../modules/strategy-manager'
import type { UpdateStrategyInput } from '../../../types/strategy'

export default defineEventHandler(async (event) => {
  try {
    const strategyManager = getStrategyManager()
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '策略ID不能为空'
      })
    }

    const body = await readBody<{ updates: UpdateStrategyInput; changes: string }>(event)

    if (!body.changes) {
      throw createError({
        statusCode: 400,
        message: '变更说明不能为空'
      })
    }

    const strategy = await strategyManager.updateStrategy(id, body.updates, body.changes)

    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    return {
      success: true,
      message: `策略已更新到 v${strategy.version}`,
      data: strategy
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `更新策略失败: ${error.message}`
    })
  }
})
