import { webSocketManager } from '../../../server/utils/websocket-manager'
import { binanceApiGateway } from '../../../server/utils/binance-api-gateway'
import type { ApiResponse } from '../../../types'

async function fetchTickerFallback(symbols: string[]): Promise<Map<string, any>> {
  if (symbols.length === 0) {
    return new Map()
  }

  const tickers = await binanceApiGateway.fetchJson<any[]>(
    'marketData',
    `ticker24hr:fallback:${symbols.join(',')}`,
    `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
  )

  return new Map((tickers || []).map(ticker => [
    ticker.symbol,
    {
      symbol: ticker.symbol,
      price: parseFloat(ticker.lastPrice || '0'),
      change24hPercent: parseFloat(ticker.priceChangePercent || '0'),
      volume24h: parseFloat(ticker.quoteVolume || '0'),
      timestamp: ticker.closeTime || Date.now()
    }
  ]))
}

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
      const missingSymbols: string[] = []

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
          missingSymbols.push(symbol)
          filteredPrices[symbol] = {
            symbol,
            price: 0,
            change24hPercent: 0,
            volume24h: 0,
            timestamp: Date.now()
          }
        }
      })

      // if (missingSymbols.length > 0) {
      //   try {
      //     const fallbackPrices = await fetchTickerFallback(missingSymbols)
      //     missingSymbols.forEach(symbol => {
      //       const fallbackPrice = fallbackPrices.get(symbol)
      //       if (fallbackPrice) {
      //         filteredPrices[symbol] = fallbackPrice
      //       }
      //     })
      //   } catch (fallbackError: any) {
      //     console.warn('[Price] REST 兜底获取价格失败:', fallbackError.message)
      //   }
      // }
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
