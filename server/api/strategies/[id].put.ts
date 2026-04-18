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

    const body = await readBody<{
      updates: UpdateStrategyInput
      saveAsNewVersion?: boolean
      changes?: string
    }>(event)

    let strategy
    if (body.saveAsNewVersion) {
      // 保存为新版本
      if (!body.changes) {
        throw createError({
          statusCode: 400,
          message: '版本变更说明不能为空'
        })
      }
      strategy = await strategyManager.updateStrategy(id, body.updates, body.changes)
    } else {
      // 普通更新，不创建版本
      strategy = await strategyManager.updateStrategyWithoutVersion(id, body.updates)
    }

    if (!strategy) {
      throw createError({
        statusCode: 404,
        message: '策略不存在'
      })
    }

    return {
      success: true,
      message: body.saveAsNewVersion
        ? `策略已更新到 v${strategy.version}`
        : '策略已更新',
      data: strategy
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `更新策略失败: ${error.message}`
    })
  }
})
