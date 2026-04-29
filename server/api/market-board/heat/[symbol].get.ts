import { MarketDataManager } from '../../../modules/market-board/MarketDataManager'
import type { ApiResponse } from '../../../../types/index'

export default defineEventHandler(async (event) => {
  try {
    const symbol = getRouterParam(event, 'symbol')

    if (!symbol) {
      const response: ApiResponse = {
        success: false,
        message: '请提供交易对',
      }
      return response
    }

    const manager = MarketDataManager.getInstance()
    const heat = await manager.getSquareHeat(symbol)

    const response: ApiResponse = {
      success: true,
      message: `获取交易对 ${symbol} 广场热度成功`,
      data: {
        heat,
        timestamp: Date.now(),
      },
    }

    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `获取广场热度失败: ${error.message}`,
    }

    return response
  }
})