import { getFuturesBot } from '../../modules/futures-bot'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const bot = getFuturesBot()
    
    await bot.updateConfig(body)
    
    return {
      success: true,
      message: '配置已更新',
      config: bot.getConfig(),
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '更新配置失败',
    }
  }
})
