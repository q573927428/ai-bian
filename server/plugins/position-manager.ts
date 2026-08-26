// 仓位管理器初始化插件
import { positionManager } from '../modules/position-manager/PositionManager'
import { logger } from '../utils/logger'
import { BinanceService } from '../utils/binance'

export default defineNitroPlugin(async () => {
  try {
    await positionManager.init()
    // 启动时以交易所实际仓位为准，恢复本地缺失的仓位并清理已不存在的旧记录。
    const binance = new BinanceService()
    const exchangePositions = await binance.fetchPositions()
    await positionManager.syncExchangePositions(exchangePositions)
    // logger.success('Plugin', '仓位管理器初始化完成')
  } catch (error: any) {
    logger.error('Plugin', `仓位管理器初始化失败: ${error.message}`)
  }
})
