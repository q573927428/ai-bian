import { getFuturesBot } from '../../modules/futures-bot'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const config = useRuntimeConfig()
    
    const { password, reason = '手动平仓' } = body
    const configPassword = config.configEditPassword
    
    // 如果设置了密码，需要验证
    if (configPassword && configPassword.length > 0) {
      if (password !== configPassword) {
        return {
          success: false,
          message: '密码错误',
        }
      }
    }
    
    // 获取机器人实例
    const bot = getFuturesBot()
    
    // 使用机器人内部的手动平仓方法，避免创建重复的PositionCloser实例
    // 这样可以确保只记录一次交易历史
    await bot.manualClosePosition(reason)
    
    // 重新获取最新状态
    const newState = bot.getState()
    
    return {
      success: true,
      message: '平仓成功',
      state: newState,
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '平仓失败',
    }
  }
})
