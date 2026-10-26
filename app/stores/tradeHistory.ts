// ==================== 历史订单服务端分页状态 ====================
import { defineStore } from 'pinia'
import { ref } from 'vue'
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

export const useTradeHistoryStore = defineStore('tradeHistory', () => {
  const availableSymbols = ref<string[]>([])
  const availableStrategies = ref<string[]>([])
  const availableCloseCategories = ref<string[]>([])
  const filteredSummary = ref({ orderCount: 0, winCount: 0, totalPnl: 0, winRate: 0 })
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

  let generation = 0
  /** 每次仅请求当前页；请求序号避免快速筛选时旧响应覆盖新结果。 */
  const fetchPage = async (page: number, pageSize: number) => {
    const request = ++generation
    const response = await $fetch('/api/bot/history', { params: { ...filter.value, page, pageSize, sortField: sort.value.field, sortDirection: sort.value.direction } }) as any
    if (request !== generation) return null
    if (!response.success) throw new Error(response.message || '加载历史订单失败')
    availableSymbols.value = response.options.symbols
    availableStrategies.value = response.options.strategies
    availableCloseCategories.value = response.options.closeCategories
    filteredSummary.value = response.summary
    return response
  }
  return { filter, sort, availableSymbols, availableStrategies, availableCloseCategories, filteredSummary, setFilter, resetFilter, setSort, fetchPage }
})
