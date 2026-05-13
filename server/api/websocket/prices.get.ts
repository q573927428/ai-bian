import { webSocketManager } from '../../../server/utils/websocket-manager'
import { getLocal24hStatsPrecise } from '../../utils/kline-simple-storage'
import type { ApiResponse } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { symbols } = query

    let symbolList: string[] = []
    
    if (symbols) {
      if (typeof symbols === 'string') {
        symbolList = symbols.split(',').map(s => s.trim())
      } else if (Array.isArray(symbols)) {
        symbolList = symbols.map(s => String(s).trim())
      }
    }

    // 确保WebSocket已连接
    await webSocketManager.initialize()

    // K线数据库已在 server/plugins/kline-sync.ts 中初始化，无需再次初始化

    // 注意：不要在这里添加订阅！订阅应该由专门的 subscribe 接口处理
    // 这里只获取已订阅的价格数据

    const allPrices = webSocketManager.getAllPrices()
    const state = webSocketManager.getWebSocketState()

    let filteredPrices: Record<string, any> = {}
    
    if (symbolList.length > 0) {
      // 返回指定交易对的价格
      // 24h涨跌幅和成交量从本地K线数据库计算，不再调用币安API
      symbolList.forEach(symbol => {
        const wsPrice = allPrices.get(symbol)
        
        // 从本地1h K线数据计算24h统计数据
        const localStats = getLocal24hStatsPrecise(symbol)
        
        if (wsPrice && localStats) {
          // 合并WebSocket实时价格和本地计算的24h统计数据
          filteredPrices[symbol] = {
            symbol,
            price: wsPrice.price || 0,
            change24hPercent: localStats.change24hPercent,
            volume24h: localStats.volume24h,
            timestamp: Date.now()
          }
        } else if (wsPrice) {
          // 只有WebSocket价格，没有24h统计数据
          filteredPrices[symbol] = {
            symbol,
            price: wsPrice.price || 0,
            change24hPercent: 0,
            volume24h: 0,
            timestamp: Date.now()
          }
        } else if (localStats) {
          // 只有本地24h统计数据，没有WebSocket价格
          filteredPrices[symbol] = {
            symbol,
            price: 0,
            change24hPercent: localStats.change24hPercent,
            volume24h: localStats.volume24h,
            timestamp: Date.now()
          }
        } else {
          // 都没有，返回默认结构
          filteredPrices[symbol] = {
            symbol,
            price: 0,
            change24hPercent: 0,
            volume24h: 0,
            timestamp: Date.now()
          }
        }
      })
    } else {
      // 返回所有价格
      allPrices.forEach((price, symbol) => {
        filteredPrices[symbol] = price
      })
    }

    const response: ApiResponse = {
      success: true,
      message: `获取到 ${Object.keys(filteredPrices).length} 个交易对的价格`,
      data: {
        prices: filteredPrices,
        timestamp: Date.now(),
        webSocketState: state
      }
    }
    
    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `获取价格失败: ${error.message}`
    }
    
    return response
  }
})
