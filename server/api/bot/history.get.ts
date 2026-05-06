import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = parseInt(query.page as string) || 1
    const pageSize = parseInt(query.pageSize as string) || 10
    
    // 从全局交易历史文件读取数据
    const historyFilePath = join(process.cwd(), 'data', 'trade-history.json')
    
    if (!existsSync(historyFilePath)) {
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
    
    const rawData = readFileSync(historyFilePath, 'utf-8')
    const allRecords = JSON.parse(rawData)
    
    // 按 closeTime 降序排序（最新的在前）
    allRecords.sort((a: any, b: any) => b.closeTime - a.closeTime)
    
    // 计算分页
    const total = allRecords.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, total)
    const pageData = allRecords.slice(startIndex, endIndex)
    
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
