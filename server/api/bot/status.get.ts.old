import { getFuturesBot } from '../../modules/futures-bot'
import { logger } from '../../utils/logger'
import type { CryptoBalance } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const bot = getFuturesBot()
    
    // 如果bot还没有初始化，先初始化（不启动）
    // 这样可以获取账户余额信息
    try {
      await bot.initialize()
    } catch (error: any) {
      // 如果已经初始化过，会继续执行
    }
    
    const state = bot.getState()
    const botConfig = bot.getConfig()
    const logs = logger.getRecentLogs(300)
    
    // 获取加密货币余额
    let cryptoBalances: CryptoBalance[] = []
    try {
      const binance = bot.getBinanceService()
      // 获取balance实例
      const balance = await binance.fetchCryptoBalances()
      
      // 从balance实例中提取代币余额信息
      if (balance && typeof balance === 'object') {
        // 定义我们感兴趣的加密货币
        const targetAssets = ['USDT']
        
        for (const asset of targetAssets) {
          const assetBalance = balance[asset]
          if (assetBalance) {
            const free = Number(Number(assetBalance.free || 0).toFixed(5))
            const locked = Number(Number(assetBalance.used || 0).toFixed(5))
            const total = Number((free + locked).toFixed(5))

            if (total > 1) {
              cryptoBalances.push({
                asset,
                free,
                locked,
                total,
              })
            }
          }
        }
      }
    } catch (error: any) {
      // 静默处理错误，返回空数组
    }
    
    return {
      success: true,
      data: {
        state,
        config: botConfig,
        logs,
        cryptoBalances,
      },
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取状态失败',
    }
  }
})
