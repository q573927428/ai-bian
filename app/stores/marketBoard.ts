import { defineStore } from 'pinia'
import type { MarketSymbolData, MarketBoardData } from '../../types/market-board'

// 筛选条件类型
interface Filters {
  priceChangeMin: number | null
  priceChangeMax: number | null
  volumeMin: number | null
  quoteVolumeMin: number | null
  fundingRateMin: number | null
  fundingRateMax: number | null
  squareHeatMin: number | null
  onlyUp: boolean
  onlyDown: boolean
}

// 持久化存储键名
const STORAGE_KEY = 'marketBoardCache'

// 检查是否在浏览器环境
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

// 从 localStorage 加载缓存
function loadCacheFromStorage(): { symbolsData: MarketSymbolData[], totalSymbols: number, lastUpdated: number } | null {
  try {
    if (!isBrowser()) {
      return null
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.warn('[MarketBoard] 加载本地缓存失败:', error)
  }
  return null
}

// 保存缓存到 localStorage
function saveCacheToStorage(data: { symbolsData: MarketSymbolData[], totalSymbols: number, lastUpdated: number }): void {
  try {
    if (!isBrowser()) {
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('[MarketBoard] 保存本地缓存失败:', error)
  }
}

export const useMarketBoardStore = defineStore('marketBoard', {
  state: () => {
    // 从 localStorage 加载缓存
    const cached = loadCacheFromStorage()
    const defaultSortBy = 'marketCapEstimate' as keyof MarketSymbolData
    const defaultSortOrder = 'desc' as 'asc' | 'desc'

    // 对缓存的数据重新排序，确保按默认排序方式保存
    if (cached && cached.symbolsData.length > 0) {
      cached.symbolsData = [...cached.symbolsData].sort((a, b) => {
        const aVal = a[defaultSortBy] ?? 0
        const bVal = b[defaultSortBy] ?? 0

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return defaultSortOrder === 'desc' ? bVal - aVal : aVal - bVal
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return defaultSortOrder === 'desc'
            ? bVal.localeCompare(aVal)
            : aVal.localeCompare(bVal)
        }

        return 0
      })
    }

    return {
      // 数据
      symbolsData: cached ? cached.symbolsData : [] as MarketSymbolData[],
      totalSymbols: cached ? cached.totalSymbols : 0,
      lastUpdated: cached ? cached.lastUpdated : 0,

      // UI状态
      isLoading: false,
      error: null as string | null,
      searchQuery: '',
      sortBy: defaultSortBy,
      sortOrder: defaultSortOrder,

      // 筛选条件
      filters: {
        priceChangeMin: null as number | null,
        priceChangeMax: null as number | null,
        volumeMin: null as number | null,
        quoteVolumeMin: null as number | null,
        fundingRateMin: null as number | null,
        fundingRateMax: null as number | null,
        squareHeatMin: null as number | null,
        onlyUp: false,
        onlyDown: false,
      },

      // 分页/虚拟滚动
      visibleRange: { start: 0, end: 100 },

      // 轮询
      pollingTimer: null as NodeJS.Timeout | null,
      isPollingActive: false,

      // 价格变化追踪
      previousData: {} as Record<string, Partial<MarketSymbolData>>,
      fieldChanges: {} as Record<string, Record<string, 'up' | 'down' | null>>,
    }
  },

  getters: {
    // 过滤后的交易对（不包含排序，让 Element Plus 表格处理排序）
    filteredSymbols: (state): MarketSymbolData[] => {
      let result = [...state.symbolsData]

      // 搜索过滤
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase()
        result = result.filter(
          (s) =>
            s.symbol.toLowerCase().includes(query) ||
            s.baseAsset.toLowerCase().includes(query)
        )
      }

      // 涨跌幅筛选
      if (state.filters.priceChangeMin !== null) {
        result = result.filter((s) => s.priceChangePercent >= state.filters.priceChangeMin!)
      }
      if (state.filters.priceChangeMax !== null) {
        result = result.filter((s) => s.priceChangePercent <= state.filters.priceChangeMax!)
      }

      // 成交量/成交额筛选
      if (state.filters.volumeMin !== null) {
        result = result.filter((s) => s.volume >= state.filters.volumeMin!)
      }
      if (state.filters.quoteVolumeMin !== null) {
        result = result.filter((s) => s.quoteVolume >= state.filters.quoteVolumeMin!)
      }

      // 资金费率筛选
      if (state.filters.fundingRateMin !== null) {
        result = result.filter((s) => s.fundingRate >= state.filters.fundingRateMin!)
      }
      if (state.filters.fundingRateMax !== null) {
        result = result.filter((s) => s.fundingRate <= state.filters.fundingRateMax!)
      }

      // 广场热度筛选
      if (state.filters.squareHeatMin !== null) {
        result = result.filter((s) => s.squareHeat >= state.filters.squareHeatMin!)
      }

      // 仅显示上涨/下跌
      if (state.filters.onlyUp) {
        result = result.filter((s) => s.priceChangePercent > 0)
      }
      if (state.filters.onlyDown) {
        result = result.filter((s) => s.priceChangePercent < 0)
      }

      return result
    },

    // 涨跌幅颜色样式
    getChangeColor: () => (change: number) => {
      if (change > 0) return 'text-green-500'
      if (change < 0) return 'text-red-500'
      return 'text-gray-500'
    },

    // 格式化数字
    formatNumber: () => (num: number, decimals: number = 2) => {
      if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + 'B'
      if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + 'M'
      if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(2) + 'K'
      return num.toFixed(decimals)
    },
  },

  actions: {
    // 获取看板数据
    async fetchData() {
      try {
        // 检查是否有缓存
        const hasCache = this.symbolsData.length > 0

        // 只有在没有缓存时才显示loading
        if (!hasCache) {
          this.isLoading = true
        }
        this.error = null

        // 获取新数据
        const response = await $fetch<any>('/api/market-board/data', {
          params: {
            search: this.searchQuery || undefined,
          },
        })

        if (response.success) {
          const data = response.data as MarketBoardData

          // 检测所有字段变化
          const newFieldChanges: Record<string, Record<string, 'up' | 'down' | null>> = {}
          
          // 需要追踪的数字字段
          const trackedFields = [
            'currentPrice', 'priceChange', 'priceChangePercent',
            'volume', 'quoteVolume', 'openInterest', 'openInterestValue',
            'marketCapEstimate', 'fundingRate', 'squareHeat'
          ] as const

          for (const symbol of data.symbols) {
            const prevData = this.previousData[symbol.symbol]
            if (prevData) {
              const changes: Record<string, 'up' | 'down' | null> = {}
              
              for (const field of trackedFields) {
                const prevValue = prevData[field] as number | undefined
                const currValue = symbol[field] as number
                
                if (prevValue !== undefined && prevValue !== currValue) {
                  changes[field] = currValue > prevValue ? 'up' : 'down'
                }
              }
              
              if (Object.keys(changes).length > 0) {
                newFieldChanges[symbol.symbol] = changes
              }
            }
            
            // 更新上一次数据
            this.previousData[symbol.symbol] = { ...symbol }
          }
          this.fieldChanges = newFieldChanges

          // 直接保存原始数据，让 filteredSymbols getter 处理排序
          this.symbolsData = data.symbols
          this.totalSymbols = data.totalSymbols
          this.lastUpdated = data.lastUpdated

          // 保存到localStorage
          saveCacheToStorage({
            symbolsData: data.symbols,
            totalSymbols: data.totalSymbols,
            lastUpdated: data.lastUpdated,
          })

          // 5.5秒后清除变化标记，与CSS动画时间一致
          setTimeout(() => {
            this.fieldChanges = {}
          }, 1500)
        } else {
          this.error = response.message || '获取数据失败'
        }
      } catch (error: any) {
        console.error('[MarketBoard] 获取数据失败:', error)
        // 如果有缓存，即使请求失败也不覆盖缓存，只设置错误信息
        this.error = error.message || '获取数据失败'
      } finally {
        this.isLoading = false
      }
    },

    // 获取单个交易对详情
    async fetchSymbolDetail(symbol: string) {
      try {
        const response = await $fetch<any>(`/api/market-board/${symbol}`)

        if (response.success && response.data?.symbol) {
          // 更新本地缓存
          const index = this.symbolsData.findIndex((s) => s.symbol === symbol)
          if (index !== -1) {
            this.symbolsData[index] = response.data.symbol
          }
          return response.data.symbol as MarketSymbolData
        }
        return null
      } catch (error) {
        console.error(`[MarketBoard] 获取${symbol}详情失败:`, error)
        return null
      }
    },

    // 设置排序
    setSortBy(sortBy: keyof MarketSymbolData, order?: 'asc' | 'desc' | null) {
      if (order !== null && order !== undefined) {
        this.sortBy = sortBy
        this.sortOrder = order
      } else {
        if (this.sortBy === sortBy) {
          this.sortOrder = this.sortOrder === 'desc' ? 'asc' : 'desc'
        } else {
          this.sortBy = sortBy
          this.sortOrder = 'desc'
        }
      }
    },

    // 设置搜索
    setSearchQuery(query: string) {
      this.searchQuery = query
    },

    // 设置单个筛选条件
    setFilter(key: string, value: any) {
      (this.filters as any)[key] = value
    },

    // 重置所有筛选条件
    resetFilters() {
      this.filters = {
        priceChangeMin: null,
        priceChangeMax: null,
        volumeMin: null,
        quoteVolumeMin: null,
        fundingRateMin: null,
        fundingRateMax: null,
        squareHeatMin: null,
        onlyUp: false,
        onlyDown: false,
      }
    },

    // 开始轮询
    startPolling(interval: number = 5000) {
      if (this.pollingTimer) return

      console.log('[MarketBoard] 启动轮询...')
      this.isPollingActive = true

      // 立即获取一次数据
      this.fetchData()

      this.pollingTimer = setInterval(() => {
        this.fetchData()
      }, interval)
    },

    // 停止轮询
    stopPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer)
        this.pollingTimer = null
        this.isPollingActive = false
        console.log('[MarketBoard] 停止轮询')
      }
    },
  },
})