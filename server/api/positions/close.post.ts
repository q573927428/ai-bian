// ==================== 手动平仓接口 ====================
import { getStrategyManager } from '../../modules/strategy-manager'
import { positionManager } from '../../modules/position-manager/PositionManager'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { symbol, password } = body
    const config = useRuntimeConfig()
    const configPassword = config.configEditPassword

    if (!symbol) {
      throw createError({
        statusCode: 400,
        message: '交易对不能为空'
      })
    }

    // 平仓属于资金风险操作：配置了操作密码时，服务端必须再次校验，避免绕过前端弹窗直接调用接口。
    if (configPassword && password !== configPassword) {
      throw createError({
        statusCode: 401,
        message: password ? '密码错误' : '请输入操作密码'
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
