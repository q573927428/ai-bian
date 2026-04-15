import { defineEventHandler } from 'h3'
import { getStrategyAnalysisMetrics } from '../../utils/analysis-storage'
import { Buffer } from 'buffer'

/**
 * 导出策略分析指标数据为JSON文件
 * 
 * 查询参数：
 * - format: 导出格式 (json/csv) - 目前只支持json
 * - symbol: 按交易对筛选
 * - direction: 按方向筛选 (LONG/SHORT)
 * - startTime: 开始时间戳
 * - endTime: 结束时间戳
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    
    // 解析查询参数
    const format = (query.format as string) || 'json'
    const symbol = query.symbol as string | undefined
    const direction = query.direction as 'LONG' | 'SHORT' | undefined
    const startTime = query.startTime ? parseInt(query.startTime as string) : undefined
    const endTime = query.endTime ? parseInt(query.endTime as string) : undefined
    
    // 获取所有数据
    let metrics = await getStrategyAnalysisMetrics()
    
    // 应用筛选条件
    if (symbol) {
      metrics = metrics.filter(m => m.symbol === symbol)
    }
    
    if (direction) {
      metrics = metrics.filter(m => m.direction === direction)
    }
    
    if (startTime) {
      metrics = metrics.filter(m => m.closeTime >= startTime)
    }
    
    if (endTime) {
      metrics = metrics.filter(m => m.closeTime <= endTime)
    }
    
    // 根据格式处理数据
    let data: string
    let contentType: string
    let filename: string
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    
    if (format === 'csv') {
      // CSV格式导出（简化版，实际项目中可以完善）
      const headers = [
        'tradeId', 'symbol', 'direction', 'openTime', 'closeTime', 'duration',
        'entryPrice', 'exitPrice', 'pnl', 'pnlPercentage',
        'mfe', 'mfePercentage', 'mae', 'maePercentage',
        'riskAmount', 'rewardAmount', 'riskRewardRatio',
        'entryRSI', 'exitRSI', 'entryADX15m', 'exitADX15m',
        'averageATR', 'priceRangePercentage', 'maxDrawdownPercentage',
        'positionSizePercentage', 'actualLeverage', 'marginUsed',
        'exitReason', 'exitReasonCategory',
        'tradeHour', 'tradeDayOfWeek', 'tradeMonth'
      ]
      
      const csvRows = metrics.map(metric => {
        const row = [
          metric.tradeId,
          metric.symbol,
          metric.direction,
          new Date(metric.openTime).toISOString(),
          new Date(metric.closeTime).toISOString(),
          metric.duration,
          metric.entryPrice,
          metric.exitPrice,
          metric.pnl,
          metric.pnlPercentage,
          metric.mfe,
          metric.mfePercentage,
          metric.mae,
          metric.maePercentage,
          metric.riskAmount,
          metric.rewardAmount,
          metric.riskRewardRatio,
          metric.entryRSI,
          metric.exitRSI,
          metric.entryADX15m,
          metric.exitADX15m,
          metric.averageATR,
          metric.priceRangePercentage,
          metric.maxDrawdownPercentage,
          metric.positionSizePercentage,
          metric.actualLeverage,
          metric.marginUsed,
          metric.exitReason,
          metric.exitReasonCategory,
          metric.tradeHour,
          metric.tradeDayOfWeek,
          metric.tradeMonth
        ]
        return row.map(field => `"${field}"`).join(',')
      })
      
      data = [headers.join(','), ...csvRows].join('\n')
      contentType = 'text/csv'
      filename = `strategy-analysis-${timestamp}.csv`
    } else {
      // 默认JSON格式
      data = JSON.stringify({
        metadata: {
          exportTime: new Date().toISOString(),
          totalRecords: metrics.length,
          filters: {
            symbol,
            direction,
            startTime: startTime ? new Date(startTime).toISOString() : null,
            endTime: endTime ? new Date(endTime).toISOString() : null
          }
        },
        data: metrics
      }, null, 2)
      contentType = 'application/json'
      filename = `strategy-analysis-${timestamp}.json`
    }
    
    // 设置响应头，触发文件下载
    setResponseHeader(event, 'Content-Type', contentType)
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
    setResponseHeader(event, 'Content-Length', Buffer.byteLength(data))
    
    return data
  } catch (error: any) {
    console.error('导出策略分析指标失败:', error.message)
    
    // 返回错误响应
    setResponseStatus(event, 500)
    return {
      success: false,
      message: `导出策略分析指标失败: ${error.message}`,
      data: null
    }
  }
})