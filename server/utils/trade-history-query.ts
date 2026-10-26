// ==================== 历史订单服务端筛选排序与汇总 ====================
import type { TradeHistory } from "../../types"
type SortField = keyof TradeHistory | 'holdingMinutes' | 'oiChangePercent' | 'estimatedVolumeEmaRatioPercent'
const SORT_FIELDS: SortField[] = ['openTime', 'closeTime', 'holdingMinutes', 'entryPrice', 'exitPrice', 'pnl', 'pnlPercentage', 'quantity', 'leverage', 'oiChangePercent', 'estimatedVolumeEmaRatioPercent']

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


/** 仅返回当前页完整记录；筛选汇总始终覆盖全部匹配交易。 */
export function queryTradeHistory(allHistory: TradeHistory[], query: Record<string, any>) {
  const filter: any = { ...query }
  for (const key of ['pnlMin','pnlMax','scoreMin','scoreMax','confidenceMin','confidenceMax','oiMin','oiMax','estimatedVolumeMin','estimatedVolumeMax']) {
    filter[key] = query[key] === undefined || query[key] === '' ? undefined : Number(query[key])
    if (filter[key] !== undefined && !Number.isFinite(filter[key])) throw new Error(`无效筛选参数: ${key}`)
  }
  const sort = { field: (query.sortField || 'closeTime') as SortField, direction: query.sortDirection === 'asc' ? 'asc' : 'desc' }
  if (!SORT_FIELDS.includes(sort.field)) throw new Error('无效排序字段')
  let result = [...allHistory]

  // 筛选：交易对
  if (filter.symbol) {
    result = result.filter(order => order.symbol === filter.symbol)
  }

  // 筛选：方向
  if (filter.direction) {
    result = result.filter(order => order.direction === filter.direction)
  }

  // 筛选：策略
  if (filter.strategyId) {
    result = result.filter(order => order.strategyId === filter.strategyId)
  }

  // 筛选：平仓原因
  if (filter.closeCategory) {
    result = result.filter(order => order.closeCategory === filter.closeCategory)
  }

  // 数值区间使用与表格展示一致的数据口径，边界值包含在筛选结果中。
  result = result.filter(order => matchesRange(order.pnl, filter.pnlMin, filter.pnlMax))
  result = result.filter(order => matchesRange(
    order.entryScoreBreakdown?.finalScore ?? order.entryScore,
    filter.scoreMin,
    filter.scoreMax
  ))
  result = result.filter(order => matchesRange(
    order.entryConfidence,
    filter.confidenceMin,
    filter.confidenceMax
  ))
  result = result.filter(order => matchesRange(
    order.entryIndicators?.OIChangePercent,
    filter.oiMin,
    filter.oiMax
  ))
  result = result.filter(order => matchesRange(
    order.entryIndicators?.EstimatedVolumeEmaRatioPercent,
    filter.estimatedVolumeMin,
    filter.estimatedVolumeMax
  ))

  // 排序
  const { field, direction } = sort
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


  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize)) || 16))
  const totalPages = Math.ceil(result.length / pageSize)
  const page = Math.min(Math.max(1, Math.trunc(Number(query.page)) || 1), Math.max(1, totalPages))
  const winCount = result.filter(record => record.pnl > 0).length
  return {
    data: result.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: result.length, totalPages },
    summary: { orderCount: result.length, winCount, totalPnl: result.reduce((sum, record) => sum + (Number.isFinite(record.pnl) ? record.pnl : 0), 0), winRate: result.length ? winCount / result.length * 100 : 0 },
    options: getTradeHistoryOptions(allHistory),
  }
}

/** 筛选选项来自全部历史，避免当前页或当前筛选导致选项消失。 */
export function getTradeHistoryOptions(records: TradeHistory[]) {
  return {
    symbols: [...new Set(records.map(record => record.symbol))].sort(),
    strategies: [...new Set(records.map(record => record.strategyId).filter((id): id is string => !!id))].sort(),
    closeCategories: [...new Set(records.map(record => record.closeCategory).filter((value): value is NonNullable<TradeHistory['closeCategory']> => !!value))].sort(),
  }
}
