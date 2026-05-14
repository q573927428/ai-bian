import { webSocketManager } from '../../../server/utils/websocket-manager'
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

    // 注意：不要在这里添加订阅！订阅应该由专门的 subscribe 接口处理
    // 这里只获取已订阅的价格数据

    const allPrices = webSocketManager.getAllPrices()
    const state = webSocketManager.getWebSocketState()

    let filteredPrices: Record<string, any> = {}
    
    if (symbolList.length > 0) {
      // 返回指定交易对的价格
      symbolList.forEach(symbol => {
        const wsPrice = allPrices.get(symbol)
        
        if (wsPrice) {
          filteredPrices[symbol] = {
            symbol,
            price: wsPrice.price ?? 0,
            change24hPercent: wsPrice.change24hPercent ?? 0,
            volume24h: wsPrice.volume24h ?? 0,
            timestamp: wsPrice.timestamp || Date.now()
          }
        } else {
          // 没有WebSocket数据，返回默认结构
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
