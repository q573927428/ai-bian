// 策略管理系统初始化插件
import { initStrategyManager } from '../modules/strategy-manager'
import { logger } from '../utils/logger'

export default defineNitroPlugin(async () => {
  try {
    console.log('Plugin', '开始初始化策略管理系统...')
    logger.info('Plugin', '开始初始化策略管理系统...')
    await initStrategyManager()
    logger.success('Plugin', '策略管理系统初始化完成')
    console.log('Plugin', '策略管理系统初始化完成')
  } catch (error: any) {
    console.error('Plugin', `策略管理系统初始化失败: ${error.message}`, error)
    logger.error('Plugin', `策略管理系统初始化失败: ${error.message}`)
    // 不抛出错误，避免服务启动失败
  }
})
