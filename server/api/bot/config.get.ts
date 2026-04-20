import { getBotConfig } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  try {
    const config = await getBotConfig()

    return {
      success: true,
      data: config
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取配置失败'
    }
  }
})