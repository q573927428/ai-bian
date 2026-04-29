// 市场看板业务服务
import { MarketDataManager } from './MarketDataManager'
import type { MarketSymbolData, MarketBoardData } from '../../../types/market-board'

export class MarketBoardService {
  private static instance: MarketBoardService

  private constructor() {}

  static getInstance(): MarketBoardService {
    if (!MarketBoardService.instance) {
      MarketBoardService.instance = new MarketBoardService()
    }
    return MarketBoardService.instance
  }

  /**
   * 获取看板数据
   */
  async getMarketBoardData(): Promise<MarketBoardData> {
    const manager = MarketDataManager.getInstance()
    const symbols = await manager.getAllSymbolsData()

    return {
      symbols,
      totalSymbols: symbols.length,
      lastUpdated: Date.now(),
      timeRange: '24h',
    }
  }

  /**
   * 获取单个交易对数据
   */
  async getSymbolData(symbol: string): Promise<MarketSymbolData | null> {
    const manager = MarketDataManager.getInstance()
    return manager.getSymbolData(symbol) || null
  }

  /**
   * 搜索交易对
   */
  searchSymbols(symbols: MarketSymbolData[], query: string): MarketSymbolData[] {
    const lowerQuery = query.toLowerCase()

    return symbols.filter(
      (symbol) =>
        symbol.symbol.toLowerCase().includes(lowerQuery) ||
        symbol.baseAsset.toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * 排序交易对
   */
  sortSymbols(
    symbols: MarketSymbolData[],
    sortBy: keyof MarketSymbolData,
    order: 'asc' | 'desc' = 'desc'
  ): MarketSymbolData[] {
    return [...symbols].sort((a, b) => {
      const aVal = a[sortBy] || 0
      const bVal = b[sortBy] || 0

      // 处理数字
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return order === 'desc' ? bVal - aVal : aVal - bVal
      }

      // 处理字符串
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return order === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal)
      }

      return 0
    })
  }
}

export const marketBoardService = MarketBoardService.getInstance()
