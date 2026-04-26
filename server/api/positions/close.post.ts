import { getStrategyManager } from '../../modules/strategy-manager'
import { positionManager } from '../../modules/position-manager/PositionManager'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { symbol } = body

    if (!symbol) {
      throw createError({
        statusCode: 400,
        message: '交易对不能为空'
      })
    }

    // 检查仓位是否存在
    const position = positionManager.getPosition(symbol)
    if (!position) {
      throw createError({
        statusCode: 404,
        message: `未找到仓位: ${symbol}`
      })
    }

    // 获取策略管理器和引擎
    const strategyManager = getStrategyManager()
    const engine = strategyManager.getEngine()
    const positionCloser = engine.getPositionCloser()

    // 执行平仓
    await positionCloser.closePosition(symbol, '手动平仓')

    return {
      success: true,
      message: `平仓成功: ${symbol}`
    }
  } catch (error: any) {
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '平仓失败'
    })
  }
})