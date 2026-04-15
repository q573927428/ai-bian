import { webSocketManager } from '../../../server/utils/websocket-manager'
import { BinanceService } from '../../../server/utils/binance'
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

    // 如果没有订阅，先订阅这些交易对
    if (symbolList.length > 0) {
      // 创建一个临时的回调函数来订阅价格
      const tempCallback = (priceData: any) => {
        // 临时回调，不做任何事情
      }
      
      // 订阅所有请求的交易对
      symbolList.forEach(symbol => {
        if (!webSocketManager.getPrice(symbol)) {
          // 如果还没有这个交易对的价格，订阅它
          webSocketManager.subscribePrice(symbol, tempCallback)
        }
      })
    }

    const allPrices = webSocketManager.getAllPrices()
    const state = webSocketManager.getWebSocketState()

    let filteredPrices: Record<string, any> = {}
    
    if (symbolList.length > 0) {
      // 获取24小时行情数据
      let tickerData: Record<string, any> = {}
      try {
        const binanceService = new BinanceService()
        await binanceService.initialize()
        
        // 为每个交易对获取ticker数据
        for (const symbol of symbolList) {
          try {
            const ticker = await binanceService.publicExchange.fetchTicker(symbol)
            tickerData[symbol] = ticker
          } catch (error) {
            console.error(`获取 ${symbol} 的ticker数据失败:`, error)
          }
        }
      } catch (error) {
        console.error('获取24小时行情数据失败:', error)
      }
      
      // 返回指定交易对的价格
      symbolList.forEach(symbol => {
        const wsPrice = allPrices.get(symbol)
        const ticker = tickerData[symbol]
        
        if (wsPrice && ticker) {
          // 合并WebSocket实时价格和24小时统计数据
          filteredPrices[symbol] = {
            symbol,
            price: wsPrice.price || parseFloat(ticker.last) || 0,
            change24h: parseFloat(ticker.change) || 0,
            change24hPercent: parseFloat(ticker.percentage) || 0,
            high24h: parseFloat(ticker.high) || 0,
            low24h: parseFloat(ticker.low) || 0,
            volume24h: parseFloat(ticker.quoteVolume) || parseFloat(ticker.volume) || 0,
            timestamp: Date.now()
          }
        } else if (wsPrice) {
          // 只有WebSocket价格，没有24小时统计数据
          filteredPrices[symbol] = {
            symbol,
            price: wsPrice.price || 0,
            change24h: 0,
            change24hPercent: 0,
            high24h: 0,
            low24h: 0,
            volume24h: 0,
            timestamp: Date.now()
          }
        } else if (ticker) {
          // 只有24小时统计数据，没有WebSocket价格
          filteredPrices[symbol] = {
            symbol,
            price: parseFloat(ticker.last) || 0,
            change24h: parseFloat(ticker.change) || 0,
            change24hPercent: parseFloat(ticker.percentage) || 0,
            high24h: parseFloat(ticker.high) || 0,
            low24h: parseFloat(ticker.low) || 0,
            volume24h: parseFloat(ticker.quoteVolume) || parseFloat(ticker.volume) || 0,
            timestamp: Date.now()
          }
        } else {
          // 都没有，返回默认结构
          filteredPrices[symbol] = {
            symbol,
            price: 0,
            change24h: 0,
            change24hPercent: 0,
            high24h: 0,
            low24h: 0,
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
