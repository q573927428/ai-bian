import { getFuturesBot } from '../../modules/futures-bot'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = parseInt(query.page as string) || 1
    const pageSize = parseInt(query.pageSize as string) || 10
    
    const bot = getFuturesBot()
    const result = await bot.getHistory(page, pageSize)
    
    return {
      success: true,
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取历史失败',
    }
  }
})