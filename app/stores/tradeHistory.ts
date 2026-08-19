import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TradeHistory } from '../../types'

// 排序方向
export type SortDirection = 'asc' | 'desc'

// 历史订单支持的排序字段，包含从入场指标中读取的两个派生字段。
export type SortField = keyof TradeHistory
  | 'holdingMinutes'
  | 'oiChangePercent'
  | 'estimatedVolumeEmaRatioPercent'

/**
 * 历史订单排序配置
 *
 * field 表示业务排序字段，direction 表示升序或降序。
 */
export interface SortConfig {
  field: SortField
  direction: SortDirection
}

/**
 * 历史订单筛选条件
 *
 * 字符串字段用于精确匹配；数值字段分别表示各业务指标的最小值和最大值。
 */
export interface FilterConfig {
  symbol: string
  direction: string
  strategyId: string
  closeCategory: string
  pnlMin?: number
  pnlMax?: number
  scoreMin?: number
  scoreMax?: number
  confidenceMin?: number
  confidenceMax?: number
  oiMin?: number
  oiMax?: number
  estimatedVolumeMin?: number
  estimatedVolumeMax?: number
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
  { key: 'leverage', label: '杠杆' },
  { key: 'oiChangePercent', label: 'OI' },
  { key: 'estimatedVolumeEmaRatioPercent', label: '预计量' },
]

/**
 * 获取历史订单字段对应的可排序值，统一处理持仓时间和嵌套入场指标。
 */
function getSortValue(order: TradeHistory, field: SortField): number | string | undefined {
  if (field === 'holdingMinutes') {
    return order.closeTime && order.openTime
      ? (order.closeTime - order.openTime) / 60000
      : undefined
  }

  // OI 与预计量展示值保存在 entryIndicators 中，需要按页面展示口径读取。
  if (field === 'oiChangePercent') {
    return order.entryIndicators?.OIChangePercent
  }
  if (field === 'estimatedVolumeEmaRatioPercent') {
    return order.entryIndicators?.EstimatedVolumeEmaRatioPercent
  }

  const rawValue = order[field]
  return typeof rawValue === 'number' || typeof rawValue === 'string'
    ? rawValue
    : undefined
}

/**
 * 判断数值是否处于闭区间内；启用区间后，缺少该指标的历史订单不参与结果。
 */
function matchesRange(value: number | undefined, min?: number, max?: number): boolean {
  if (min == null && max == null) return true
  if (value == null || !Number.isFinite(value)) return false
  if (min != null && value < min) return false
  if (max != null && value > max) return false
  return true
}

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
    pnlMin: undefined,
    pnlMax: undefined,
    scoreMin: undefined,
    scoreMax: undefined,
    confidenceMin: undefined,
    confidenceMax: undefined,
    oiMin: undefined,
    oiMax: undefined,
    estimatedVolumeMin: undefined,
    estimatedVolumeMax: undefined,
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

    // 数值区间使用与表格展示一致的数据口径，边界值包含在筛选结果中。
    result = result.filter(order => matchesRange(order.pnl, filter.value.pnlMin, filter.value.pnlMax))
    result = result.filter(order => matchesRange(
      order.entryScoreBreakdown?.finalScore ?? order.entryScore,
      filter.value.scoreMin,
      filter.value.scoreMax
    ))
    result = result.filter(order => matchesRange(
      order.entryConfidence,
      filter.value.confidenceMin,
      filter.value.confidenceMax
    ))
    result = result.filter(order => matchesRange(
      order.entryIndicators?.OIChangePercent,
      filter.value.oiMin,
      filter.value.oiMax
    ))
    result = result.filter(order => matchesRange(
      order.entryIndicators?.EstimatedVolumeEmaRatioPercent,
      filter.value.estimatedVolumeMin,
      filter.value.estimatedVolumeMax
    ))

    // 排序
    const { field, direction } = sort.value
    result.sort((a, b) => {
      const aVal = getSortValue(a, field)
      const bVal = getSortValue(b, field)

      // 缺少历史指标的数据始终置底，避免与真实的 0 值混淆。
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      const aNum = Number(aVal)
      const bNum = Number(bVal)
      return direction === 'asc' ? aNum - bNum : bNum - aNum
    })

    return result
  })

  // 汇总基于完整筛选结果计算，不受当前分页影响。
  const filteredSummary = computed(() => {
    const orderCount = filteredHistory.value.length
    const winCount = filteredHistory.value.filter(order => order.pnl > 0).length
    const totalPnl = filteredHistory.value.reduce((sum, order) => {
      return Number.isFinite(order.pnl) ? sum + order.pnl : sum
    }, 0)

    return {
      orderCount,
      winCount,
      totalPnl,
      winRate: orderCount > 0 ? (winCount / orderCount) * 100 : 0,
    }
  })

  // ========== 设置筛选条件 ==========
  const setFilter = (partial: Partial<FilterConfig>) => {
    Object.assign(filter.value, partial)
  }

  // ========== 重置筛选 ==========
  const resetFilter = () => {
    filter.value = {
      symbol: '',
      direction: '',
      strategyId: '',
      closeCategory: '',
      pnlMin: undefined,
      pnlMax: undefined,
      scoreMin: undefined,
      scoreMax: undefined,
      confidenceMin: undefined,
      confidenceMax: undefined,
      oiMin: undefined,
      oiMax: undefined,
      estimatedVolumeMin: undefined,
      estimatedVolumeMax: undefined,
    }
  }

  // ========== 设置排序 ==========
  const setSort = (field: SortConfig['field'], direction: SortDirection) => {
    // 直接使用表格组件给出的方向，确保排序结果与列头箭头一致。
    sort.value = { field, direction }
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
    filteredSummary,
    setFilter,
    resetFilter,
    setSort,
    fetchAllHistory,
    getPaginatedHistory,
    getHistoryBySymbol,
    refresh
  }
})
