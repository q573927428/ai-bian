import { getSimpleKLineData, getSimpleStoredSymbols, getSimpleLastKLineTimestamp, readSimpleKLineFile } from '../../utils/kline-simple-storage'
import type { KLineQueryParams, KLineApiResponse } from '../../../types/kline-simple'

export default defineEventHandler(async (event) => {
  const method = event.method
  
  try {
    if (method === 'GET') {
      return handleGetRequest(event)
    } else {
      return createErrorResponse('不支持的请求方法', 405)
    }
  } catch (error: any) {
    console.error('K线API处理错误:', error)
    return createErrorResponse(`服务器错误: ${error.message}`, 500)
  }
})

// 处理GET请求
async function handleGetRequest(event: any) {
  const query = getQuery(event)
  const { symbol, timeframe, limit, from, to, action } = query
  
  // 处理特殊action
  if (action === 'stored-symbols') {
    return handleStoredSymbolsAction()
  }
  
  if (action === 'last-timestamp') {
    if (!symbol || !timeframe) {
      return createErrorResponse('缺少必需参数: symbol 和 timeframe', 400)
    }
    return handleLastTimestampAction(symbol as string, timeframe as string)
  }
  
  // 验证必需参数
  if (!symbol || !timeframe) {
    return createErrorResponse('缺少必需参数: symbol 和 timeframe', 400)
  }
  
  // 验证timeframe
  const validTimeframes = ['15m', '1h', '4h', '1d', '1w']
  if (!validTimeframes.includes(timeframe as string)) {
    return createErrorResponse(`无效的timeframe: ${timeframe}，有效值: ${validTimeframes.join(', ')}`, 400)
  }
  
  // 解析可选参数
  const params: KLineQueryParams = {
    symbol: symbol as string,
    timeframe: timeframe as any,
    limit: limit ? parseInt(limit as string) : undefined,
    from: from ? parseInt(from as string) : undefined,
    to: to ? parseInt(to as string) : undefined
  }
  
  try {
    // 获取K线数据
    const klineData = getSimpleKLineData(params.symbol, params.timeframe, {
      limit: params.limit,
      from: params.from,
      to: params.to
    })
    
    if (klineData.length === 0) {
      return createSuccessResponse({
        symbol: params.symbol,
        timeframe: params.timeframe,
        data: [],
        meta: {
          first: 0,
          last: 0,
          count: 0,
          max: 11000,
          updated: 0
        }
      }, '没有找到K线数据')
    }
    
    // 读取文件获取完整元数据
    const fileData = readSimpleKLineFile(params.symbol, params.timeframe)
    
    // 准备响应数据
    const responseData = {
      symbol: params.symbol,
      timeframe: params.timeframe,
      data: klineData,
      meta: fileData?.meta || {
        first: klineData[0]?.t || 0,
        last: klineData[klineData.length - 1]?.t || 0,
        count: klineData.length,
        max: 11000,
        updated: Math.floor(Date.now() / 1000)
      }
    }
    
    return createSuccessResponse(responseData, '获取K线数据成功')
    
  } catch (error: any) {
    console.error(`获取K线数据失败: ${params.symbol}/${params.timeframe}`, error)
    return createErrorResponse(`获取K线数据失败: ${error.message}`, 500)
  }
}

// 处理已存储交易对查询操作
async function handleStoredSymbolsAction() {
  try {
    const storedSymbols = getSimpleStoredSymbols()
    
    // 按交易对分组
    const groupedSymbols: Record<string, Array<{
      timeframe: string
      count: number
      lastUpdated: number
    }>> = {}
    
    for (const item of storedSymbols) {
      const symbol = item.symbol
      if (!groupedSymbols[symbol]) {
        groupedSymbols[symbol] = []
      }
      groupedSymbols[symbol].push({
        timeframe: item.timeframe,
        count: item.count,
        lastUpdated: item.lastUpdated
      })
    }
    
    // 转换为数组格式
    const result = Object.entries(groupedSymbols).map(([symbol, timeframes]) => ({
      symbol,
      timeframes
    }))
    
    return createSuccessResponse({
      symbols: result,
      totalSymbols: result.length,
      totalFiles: storedSymbols.length
    }, '获取已存储交易对成功')
  } catch (error: any) {
    console.error('获取已存储交易对失败', error)
    return createErrorResponse(`获取已存储交易对失败: ${error.message}`, 500)
  }
}

// 处理最后时间戳查询操作
async function handleLastTimestampAction(symbol: string, timeframe: string) {
  try {
    const lastTimestamp = getSimpleLastKLineTimestamp(symbol, timeframe as any)
    
    return createSuccessResponse({
      symbol,
      timeframe,
      lastTimestamp,
      exists: lastTimestamp !== null
    }, '获取最后时间戳成功')
  } catch (error: any) {
    console.error(`获取最后时间戳失败: ${symbol}/${timeframe}`, error)
    return createErrorResponse(`获取最后时间戳失败: ${error.message}`, 500)
  }
}

// 创建成功响应
function createSuccessResponse(data: any, message: string = '操作成功'): KLineApiResponse {
  return {
    success: true,
    message,
    data
  }
}

// 创建错误响应
function createErrorResponse(message: string, statusCode: number = 400): KLineApiResponse {
  return {
    success: false,
    message
  }
}