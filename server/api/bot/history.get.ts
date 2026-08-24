import { getCachedTradeHistory } from '../../utils/trade-history-cache'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = parseInt(query.page as string) || 1
    const pageSize = parseInt(query.pageSize as string) || 10
    
    // 从全局交易历史文件读取数据
    const cachedRecords = getCachedTradeHistory()
    if (cachedRecords.length === 0) {
      return {
        success: true,
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
        },
      }
    }
    
    // 计算分页
    const total = cachedRecords.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, total)
    const pageData = cachedRecords.slice(startIndex, endIndex)
    
    return {
      success: true,
      data: pageData,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取历史失败',
    }
  }
})
