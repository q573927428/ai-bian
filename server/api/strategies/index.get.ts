// GET /api/strategies - 获取所有策略

import { getStrategyManager, initStrategyManager } from '../../modules/strategy-manager'
import { maskStrategyData } from '../../utils/mask-strategy'

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
        // 如果未初始化，尝试主动初始化
        if (retries === 0) {
          try {
            await initStrategyManager()
            strategyManager = getStrategyManager()
            break
          } catch (initError) {
            // 初始化失败，继续重试
          }
        }
        retries++
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    if (!strategyManager) {
      throw new Error('策略管理系统正在初始化，请稍后重试')
    }
    const strategies = await strategyManager.getAllStrategies()
    const statuses = await strategyManager.getAllStrategiesStatus()
    const engine = strategyManager.getEngine()
    const now = Date.now()
    // 运行计数只附加到响应，不写入策略配置或版本快照。
    const dailyTradeStatuses = Object.fromEntries(await Promise.all(strategies.map(async strategy => [
      strategy.id,
      await engine.getDailyTradeStatus(strategy.id, strategy.riskManagement.maxDailyTrades, now)
    ] as const)))
    // 亏损金额与开仓门禁共用引擎状态，避免列表展示账户比例或其他策略的盈亏。
    const dailyLossStatuses = Object.fromEntries(strategies.map(strategy => [
      strategy.id,
      engine.getDailyLossStatus(strategy.id, strategy.riskManagement.maxDailyLoss, now)
    ] as const))

    return {
      success: true,
      data: strategies.map(s => maskStrategyData(s)),
      statuses,
      dailyTradeStatuses,
      dailyLossStatuses
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `获取策略列表失败: ${error.message}`
    })
  }
})
