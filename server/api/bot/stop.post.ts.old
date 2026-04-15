import { getFuturesBot } from '../../modules/futures-bot'

export default defineEventHandler(async (event) => {
  try {
    const bot = getFuturesBot()
    await bot.stop()
    
    return {
      success: true,
      message: '交易机器人已停止',
      state: bot.getState(),
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '停止失败',
    }
  }
})
