// PUT /api/strategies/[id] - 更新策略

import { getStrategyManager } from '../../modules/strategy-manager'
import type { UpdateStrategyInput } from '../../../types/strategy'
import { maskStrategyData } from '../../utils/mask-strategy'

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

    // 处理脱敏后的 apiKey：如果前端传回的是脱敏格式（包含 ****），则不更新 apiKey
    if (body.updates?.aiPrompt?.apiKey?.includes('****')) {
      // 获取当前策略的原始 apiKey，保留不变
      const currentStrategy = await strategyManager.getStrategy(id)
      if (currentStrategy) {
        body.updates.aiPrompt.apiKey = currentStrategy.aiPrompt.apiKey
      }
    }

    let strategy
    if (body.saveAsNewVersion) {
      if (!body.changes) {
        throw createError({
          statusCode: 400,
          message: '版本变更说明不能为空'
        })
      }
      strategy = await strategyManager.updateStrategy(id, body.updates, body.changes)
    } else {
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
      data: maskStrategyData(strategy)
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `更新策略失败: ${error.message}`
    })
  }
})