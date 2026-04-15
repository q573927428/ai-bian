import { defineEventHandler } from 'h3'
import { 
  getStrategyAnalysisMetrics, 
  calculateStrategyAnalysisStats,
  getExitReasonStats,
  getSymbolStats,
  getTodayStrategyAnalysisMetrics 
} from '../../utils/analysis-storage'

/**
 * 获取策略分析指标API
 * 
 * 查询参数：
 * - limit: 限制返回数量
 * - page: 页码
 * - pageSize: 每页大小
 * - symbol: 按交易对筛选
 * - direction: 按方向筛选 (LONG/SHORT)
 * - exitReason: 按退出原因筛选
 * - startTime: 开始时间戳
 * - endTime: 结束时间戳
 * - today: 是否只获取今日数据 (true/false)
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    
    // 解析查询参数
    const limit = query.limit ? parseInt(query.limit as string) : undefined
    const page = query.page ? parseInt(query.page as string) : 1
    const pageSize = query.pageSize ? parseInt(query.pageSize as string) : 20
    const symbol = query.symbol as string | undefined
    const direction = query.direction as 'LONG' | 'SHORT' | undefined
    const exitReason = query.exitReason as string | undefined
    const startTime = query.startTime ? parseInt(query.startTime as string) : undefined
    const endTime = query.endTime ? parseInt(query.endTime as string) : undefined
    const todayOnly = query.today === 'true'
    
    // 获取数据
    let metrics
    if (todayOnly) {
      metrics = await getTodayStrategyAnalysisMetrics()
    } else {
      metrics = await getStrategyAnalysisMetrics()
    }
    
    // 应用筛选条件
    let filteredMetrics = metrics
    
    if (symbol) {
      filteredMetrics = filteredMetrics.filter(m => m.symbol === symbol)
    }
    
    if (direction) {
      filteredMetrics = filteredMetrics.filter(m => m.direction === direction)
    }
    
    if (exitReason) {
      filteredMetrics = filteredMetrics.filter(m => 
        m.exitReason.toLowerCase().includes(exitReason.toLowerCase()) ||
        m.exitReasonCategory === exitReason
      )
    }
    
    if (startTime) {
      filteredMetrics = filteredMetrics.filter(m => m.closeTime >= startTime)
    }
    
    if (endTime) {
      filteredMetrics = filteredMetrics.filter(m => m.closeTime <= endTime)
    }
    
    // 应用分页
    const total = filteredMetrics.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginatedMetrics = filteredMetrics.slice(startIndex, endIndex)
    
    // 计算统计数据
    const stats = await calculateStrategyAnalysisStats()
    const exitReasonStats = await getExitReasonStats()
    const symbolStats = await getSymbolStats()
    
    return {
      success: true,
      data: {
        metrics: paginatedMetrics,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        stats,
        exitReasonStats,
        symbolStats,
        filters: {
          symbol,
          direction,
          exitReason,
          startTime,
          endTime,
          todayOnly
        }
      }
    }
  } catch (error: any) {
    console.error('获取策略分析指标失败:', error.message)
    return {
      success: false,
      message: `获取策略分析指标失败: ${error.message}`,
      data: null
    }
  }
})