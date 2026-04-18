// 仓位管理器初始化插件
import { positionManager } from '../modules/position-manager/PositionManager'
import { logger } from '../utils/logger'

export default defineNitroPlugin(async () => {
  try {
    await positionManager.init()
    // logger.success('Plugin', '仓位管理器初始化完成')
  } catch (error: any) {
    logger.error('Plugin', `仓位管理器初始化失败: ${error.message}`)
  }
})