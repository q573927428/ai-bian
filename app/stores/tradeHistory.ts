import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TradeHistory } from '../../types'

export const useTradeHistoryStore = defineStore('tradeHistory', () => {
  const allHistory = ref<TradeHistory[]>([])
  const loading = ref(false)
  const lastFetchTime = ref(0)
  const CACHE_DURATION = 30000 // 30秒缓存
  let pendingPromise: Promise<TradeHistory[]> | null = null

  // 获取完整历史数据（最多1000条）
  const fetchAllHistory = async (force = false) => {
    const now = Date.now()
    
    // 如果未强制刷新且缓存未过期，则直接返回
    if (!force && allHistory.value.length > 0 && (now - lastFetchTime.value) < CACHE_DURATION) {
      return allHistory.value
    }

    // 如果已经在请求中，返回挂起的 promise
    if (pendingPromise) {
      return pendingPromise
    }

    loading.value = true
    pendingPromise = new Promise(async (resolve) => {
      try {
        const response = await $fetch('/api/bot/history', {
          params: {
            page: 1,
            pageSize: 1000,
          },
        }) as any

        if (response.success) {
          allHistory.value = response.data || []
          lastFetchTime.value = now
        }
      } catch (error) {
        console.error('加载历史数据失败:', error)
      } finally {
        loading.value = false
        pendingPromise = null
      }
      resolve(allHistory.value)
    })

    return pendingPromise
  }

  // 获取分页数据
  const getPaginatedHistory = (page: number, pageSize: number) => {
    const start = (page - 1) * pageSize
    const end = start + pageSize
    return {
      data: allHistory.value.slice(start, end),
      total: allHistory.value.length,
      totalPages: Math.ceil(allHistory.value.length / pageSize)
    }
  }

  // 获取指定交易对的历史数据
  const getHistoryBySymbol = (symbol: string) => {
    const normalizedSymbol = symbol.replace('/', '')
    return allHistory.value.filter(order => {
      const orderSymbol = order.symbol.replace('/', '')
      return orderSymbol === normalizedSymbol
    })
  }

  // 强制刷新数据
  const refresh = () => {
    return fetchAllHistory(true)
  }

  return {
    allHistory,
    loading,
    fetchAllHistory,
    getPaginatedHistory,
    getHistoryBySymbol,
    refresh
  }
})