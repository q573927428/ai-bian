import { getFuturesBot } from '../../modules/futures-bot'

export default defineEventHandler(async (event) => {
  try {
    const bot = getFuturesBot()
    
    await bot.initialize()
    await bot.start()
    
    return {
      success: true,
      message: '交易机器人已启动',
      state: bot.getState(),
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '启动失败',
    }
  }
})
