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
  /** 多选交易对，空数组表示全部；字符串兼容原单选调用。 */
  symbol: string[] | string
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
  /** 页面按倍数输入；请求时转为历史快照及接口沿用的百分数。 */
  estimatedVolumeMin?: number
  estimatedVolumeMax?: number
  rsiMin?: number
  rsiMax?: number
  adxMin?: number
  adxMax?: number
  adxSlopeMin?: number
  adxSlopeMax?: number
  atrPercentMin?: number
  atrPercentMax?: number
  resistanceDistanceATRMin?: number
  resistanceDistanceATRMax?: number
  supportDistanceATRMin?: number
  supportDistanceATRMax?: number
  /** ER 固定读取订单主周期的入场快照，范围使用 0～1 原值。 */
  erMin?: number
  erMax?: number
  /** 开仓时间的起止毫秒时间戳，包含两端边界。 */
  openTimeMin?: number
  openTimeMax?: number
  /** 持仓时长闭区间，单位为分钟，按平仓时间减开仓时间计算。 */
  holdingMinutesMin?: number
  holdingMinutesMax?: number
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
  { key: 'entryScore', label: '评分' },
  { key: 'entryConfidence', label: '置信度' },
  { key: 'oiChangePercent', label: 'OI' },
  { key: 'estimatedVolumeEmaRatioPercent', label: '预量比' },
]

export const useTradeHistoryStore = defineStore('tradeHistory', () => {
  const availableSymbols = ref<string[]>([])
  const availableStrategies = ref<string[]>([])
  const availableCloseCategories = ref<string[]>([])
  const filteredSummary = ref({ orderCount: 0, winCount: 0, totalPnl: 0, winRate: 0, averagePnl: 0, payoffRatio: null as number | null })
  // ========== 筛选状态 ==========
  const filter = ref<FilterConfig>({
    symbol: [],
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
    openTimeMin: undefined,
    openTimeMax: undefined,
    holdingMinutesMin: undefined,
    holdingMinutesMax: undefined,
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
      symbol: [],
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
      openTimeMin: undefined,
      openTimeMax: undefined,
      holdingMinutesMin: undefined,
      holdingMinutesMax: undefined,
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
    // 保持历史数据与接口的百分数口径，页面筛选统一使用倍数（1.5x 对应 150）。
    const response = await $fetch('/api/bot/history', { params: {
      ...filter.value,
      // 用逗号传递多选，避免不同查询字符串序列化方式丢失重复参数。
      symbol: Array.isArray(filter.value.symbol) ? filter.value.symbol.join(',') : filter.value.symbol,
      estimatedVolumeMin: filter.value.estimatedVolumeMin == null ? undefined : filter.value.estimatedVolumeMin * 100,
      estimatedVolumeMax: filter.value.estimatedVolumeMax == null ? undefined : filter.value.estimatedVolumeMax * 100,
      page, pageSize, sortField: sort.value.field, sortDirection: sort.value.direction
    } }) as any
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
