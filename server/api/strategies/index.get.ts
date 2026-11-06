// GET /api/strategies - 获取所有策略

import { getStrategyManagerIfAvailable } from '../../modules/strategy-manager'
import { StrategyStore } from '../../modules/strategy-store/StrategyStore'
import { operationSession } from '../../utils/operation-auth'
import { strategyView } from '../../utils/public-view'

export default defineEventHandler(async (event) => {
  try {
    const verified = !!operationSession(event)
    const strategyManager = getStrategyManagerIfAvailable()
    if (!strategyManager) {
      // 首屏只读本地策略，既不等待 K 线同步，也不从读取接口重新触发初始化。
      const strategies = await new StrategyStore().getAllStrategies()
      return {
        success: true,
        initializing: true,
        data: strategies.map(s => strategyView(s, verified)),
        statuses: [],
        dailyTradeStatuses: {},
        dailyLossStatuses: {},
      }
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
      initializing: false,
      data: strategies.map(s => strategyView(s, verified)),
      statuses: verified ? statuses : statuses.map(({ error, ...status }) => status),
      dailyTradeStatuses: verified ? dailyTradeStatuses : {},
      dailyLossStatuses: verified ? dailyLossStatuses : {},
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: '获取策略列表失败'
    })
  }
})
