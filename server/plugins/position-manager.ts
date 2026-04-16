// 仓位管理器初始化插件
import { positionManager } from '../modules/position-manager/PositionManager'
import { logger } from '../utils/logger'

export default defineNitroPlugin(async () => {
  try {
    console.log('Plugin', '开始初始化仓位管理器...')
    logger.info('Plugin', '开始初始化仓位管理器...')
    await positionManager.init()
    logger.success('Plugin', '仓位管理器初始化完成')
    console.log('Plugin', '仓位管理器初始化完成')
  } catch (error: any) {
    console.error('Plugin', `仓位管理器初始化失败: ${error.message}`, error)
    logger.error('Plugin', `仓位管理器初始化失败: ${error.message}`)
    // 不抛出错误，避免服务启动失败
  }
})