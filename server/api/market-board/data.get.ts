import { marketBoardService } from '../../modules/market-board/MarketBoardService'
import type { ApiResponse } from '../../../types/index'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const search = (query.search as string) || ''

    // 获取原始数据
    const data = await marketBoardService.getMarketBoardData()

    // 只处理搜索，让前端处理排序和筛选
    if (search) {
      const searched = marketBoardService.searchSymbols(data.symbols, search)
      data.symbols = searched
      data.totalSymbols = searched.length
    }

    const response: ApiResponse = {
      success: true,
      message: '获取看板数据成功',
      data: data,
    }

    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `获取看板数据失败: ${error.message}`,
    }

    return response
  }
})
