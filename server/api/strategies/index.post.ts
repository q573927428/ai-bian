// POST /api/strategies - 创建策略

import { getStrategyManager } from '../../modules/strategy-manager'
import type { CreateStrategyInput } from '../../../types/strategy'

export default defineEventHandler(async (event) => {
  try {
    // 等待策略管理器初始化完成
    let strategyManager
    let retries = 0
    while (retries < 10) {
      try {
        strategyManager = getStrategyManager()
        break
      } catch (e) {
        retries++
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    if (!strategyManager) {
      throw new Error('策略管理系统正在初始化，请稍后重试')
    }
    const body = await readBody<CreateStrategyInput>(event)

    if (!body.name) {
      throw createError({
        statusCode: 400,
        message: '策略名称不能为空'
      })
    }

    const strategy = await strategyManager.createStrategy(body)

    return {
      success: true,
      message: '策略创建成功',
      data: strategy
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `创建策略失败: ${error.message}`
    })
  }
})
