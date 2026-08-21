import { marketPriceHub } from '../../../server/utils/market-price-hub'
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

    // 快照与 SSE 必须读取同一个行情中心，避免断线兜底拿到不同的数据源。
    await marketPriceHub.initialize()
    const allPrices = marketPriceHub.getSnapshot()
    const state = marketPriceHub.getStatus()

    let filteredPrices: Record<string, any> = {}
    
    if (symbolList.length > 0) {
      const missingSymbols: string[] = []

      // 返回指定交易对的价格
      symbolList.forEach(symbol => {
        const wsPrice = allPrices[symbol]
        
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
      //     // WebSocket重连或刚启动时缓存可能为空，REST兜底保证前端不会长时间显示0。
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
      Object.entries(allPrices).forEach(([symbol, price]) => {
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
