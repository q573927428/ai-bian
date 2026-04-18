import { getStrategyManager } from '../../modules/strategy-manager'
import { logger } from '../../utils/logger'
import type { CryptoBalance } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const manager = getStrategyManager()
    const engine = manager.getEngine()
    const positionManager = engine.getPositionManager()
    const binance = engine.getBinanceService()

    const allStrategies = await manager.getAllStrategies()
    const logs = logger.getRecentLogs(300)

    let cryptoBalances: CryptoBalance[] = []
    try {
      const balance = await binance.fetchCryptoBalances()

      if (balance && typeof balance === 'object') {
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
    }

    const positions = positionManager.getAllPositions()

    return {
      success: true,
      data: {
        state: {
          isRunning: engine.getRunningStrategies().length > 0,
          runningStrategies: engine.getRunningStrategies(),
          totalStrategies: allStrategies.length,
          activeStrategies: allStrategies.filter(s => s.isActive).length,
          currentPositions: positions.length,
        },
        config: {
          strategies: allStrategies,
        },
        logs,
        cryptoBalances,
        positions,
      },
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取状态失败',
    }
  }
})