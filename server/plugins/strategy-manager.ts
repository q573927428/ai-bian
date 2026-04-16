// 策略管理系统初始化插件
import { initStrategyManager } from '../modules/strategy-manager'
import { logger } from '../utils/logger'

export default defineNitroPlugin(async () => {
  try {
    await initStrategyManager()
    logger.success('Plugin', '策略管理系统初始化完成')
  } catch (error: any) {
    logger.error('Plugin', `策略管理系统初始化失败: ${error.message}`)
  }
})
