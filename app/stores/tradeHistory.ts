import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TradeHistory } from '../../types'

// 排序方向
export type SortDirection = 'asc' | 'desc'

// 排序字段配置
export interface SortConfig {
  field: keyof TradeHistory | 'holdingMinutes'
  direction: SortDirection
}

// 筛选条件
export interface FilterConfig {
  symbol: string
  direction: string
  strategyId: string
  closeCategory: string
}

// 排序字段标签映射
export const SORT_FIELDS: { key: SortConfig['field']; label: string }[] = [
  { key: 'openTime', label: '开仓时间' },
  { key: 'closeTime', label: '平仓时间' },
  { key: 'holdingMinutes', label: '持仓时间' },
  { key: 'entryPrice', label: '入场价' },
  { key: 'exitPrice', label: '出场价' },
  { key: 'pnl', label: '盈亏' },
  { key: 'pnlPercentage', label: '盈亏%' },
  { key: 'quantity', label: '数量' },
]

export const useTradeHistoryStore = defineStore('tradeHistory', () => {
  const allHistory = ref<TradeHistory[]>([])
  const loading = ref(false)
  const lastFetchTime = ref(0)
  const CACHE_DURATION = 30000 // 30秒缓存
  let pendingPromise: Promise<TradeHistory[]> | null = null

  // ========== 筛选状态 ==========
  const filter = ref<FilterConfig>({
    symbol: '',
    direction: '',
    strategyId: '',
    closeCategory: '',
  })

  // ========== 排序状态 ==========
  const sort = ref<SortConfig>({
    field: 'closeTime',
    direction: 'desc',
  })

  // ========== 计算属性：获取所有可用的筛选选项 ==========
  const availableSymbols = computed(() => {
    const symbols = new Set<string>()
    allHistory.value.forEach(order => symbols.add(order.symbol))
    return Array.from(symbols).sort()
  })

  const availableStrategies = computed(() => {
    const strategies = new Set<string>()
    allHistory.value.forEach(order => {
      if (order.strategyId) strategies.add(order.strategyId)
    })
    return Array.from(strategies).sort()
  })

  const availableCloseCategories = computed(() => {
    const categories = new Set<string>()
    allHistory.value.forEach(order => {
      if (order.closeCategory) categories.add(order.closeCategory)
    })
    return Array.from(categories).sort()
  })

  // ========== 计算属性：筛选后的数据 ==========
  const filteredHistory = computed(() => {
    let result = [...allHistory.value]

    // 筛选：交易对
    if (filter.value.symbol) {
      result = result.filter(order => order.symbol === filter.value.symbol)
    }

    // 筛选：方向
    if (filter.value.direction) {
      result = result.filter(order => order.direction === filter.value.direction)
    }

    // 筛选：策略
    if (filter.value.strategyId) {
      result = result.filter(order => order.strategyId === filter.value.strategyId)
    }

    // 筛选：平仓原因
    if (filter.value.closeCategory) {
      result = result.filter(order => order.closeCategory === filter.value.closeCategory)
    }

    // 排序
    const { field, direction } = sort.value
    result.sort((a, b) => {
      let aVal: number | string | undefined
      let bVal: number | string | undefined

      if (field === 'holdingMinutes') {
        // 持仓时间需要计算
        aVal = a.closeTime && a.openTime ? (a.closeTime - a.openTime) / 60000 : 0
        bVal = b.closeTime && b.openTime ? (b.closeTime - b.openTime) / 60000 : 0
      } else {
        // 只对 number 和 string 类型的字段进行排序
        const aRaw = a[field]
        const bRaw = b[field]
        aVal = typeof aRaw === 'number' || typeof aRaw === 'string' ? aRaw : undefined
        bVal = typeof bRaw === 'number' || typeof bRaw === 'string' ? bRaw : undefined
      }

      // 处理 undefined
      if (aVal == null) aVal = 0
      if (bVal == null) bVal = 0

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      const aNum = Number(aVal)
      const bNum = Number(bVal)
      return direction === 'asc' ? aNum - bNum : bNum - aNum
    })

    return result
  })

  // ========== 设置筛选条件 ==========
  const setFilter = (partial: Partial<FilterConfig>) => {
    Object.assign(filter.value, partial)
  }

  // ========== 重置筛选 ==========
  const resetFilter = () => {
    filter.value = { symbol: '', direction: '', strategyId: '', closeCategory: '' }
  }

  // ========== 设置排序 ==========
  const setSort = (field: SortConfig['field']) => {
    if (sort.value.field === field) {
      // 切换排序方向
      sort.value.direction = sort.value.direction === 'asc' ? 'desc' : 'asc'
    } else {
      sort.value.field = field
      sort.value.direction = 'desc'
    }
  }

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

  // 获取分页数据（基于筛选和排序后的结果）
  const getPaginatedHistory = (page: number, pageSize: number) => {
    const filtered = filteredHistory.value
    const start = (page - 1) * pageSize
    const end = start + pageSize
    return {
      data: filtered.slice(start, end),
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / pageSize)
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
    filter,
    sort,
    availableSymbols,
    availableStrategies,
    availableCloseCategories,
    filteredHistory,
    setFilter,
    resetFilter,
    setSort,
    fetchAllHistory,
    getPaginatedHistory,
    getHistoryBySymbol,
    refresh
  }
})
