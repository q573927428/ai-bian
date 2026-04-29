import { marketBoardService } from '../../modules/market-board/MarketBoardService'
import type { ApiResponse } from '../../../types/index'
import type { TimeRange } from '../../../types/market-board'

export default defineEventHandler(async (event) => {
  try {
    const symbol = getRouterParam(event, 'symbol')
    const query = getQuery(event)
    const timeRange = (query.timeRange as TimeRange) || '24h'

    if (!symbol) {
      const response: ApiResponse = {
        success: false,
        message: '请提供交易对',
      }
      return response
    }

    let symbolData = await marketBoardService.getSymbolData(symbol)

    if (!symbolData) {
      const response: ApiResponse = {
        success: false,
        message: `交易对 ${symbol} 不存在`,
      }
      return response
    }

    const response: ApiResponse = {
      success: true,
      message: `获取交易对 ${symbol} 数据成功`,
      data: {
        symbol: symbolData,
        timestamp: Date.now(),
      },
    }

    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `获取交易对详情失败: ${error.message}`,
    }

    return response
  }
})