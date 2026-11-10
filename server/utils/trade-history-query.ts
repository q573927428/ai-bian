// ==================== 历史订单服务端筛选排序与汇总 ====================
import type { TradeHistory } from "../../types"
type SortField = keyof TradeHistory | 'holdingMinutes' | 'oiChangePercent' | 'estimatedVolumeEmaRatioPercent'
const SORT_FIELDS: SortField[] = ['openTime', 'closeTime', 'holdingMinutes', 'entryPrice', 'exitPrice', 'pnl', 'pnlPercentage', 'quantity', 'leverage', 'oiChangePercent', 'estimatedVolumeEmaRatioPercent']

/** 按真实时间差计算分钟数；缺失或异常时间不能作为零时长参与筛选和排序。 */
function getHoldingMinutes(order: TradeHistory): number | undefined {
  if (!Number.isFinite(order.openTime) || !Number.isFinite(order.closeTime)) return undefined
  const duration = (order.closeTime - order.openTime) / 60000
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined
}

/**
 * 获取历史订单字段对应的可排序值，统一处理持仓时间和嵌套入场指标。
 */
function getSortValue(order: TradeHistory, field: SortField): number | string | undefined {
  if (field === 'holdingMinutes') {
    return getHoldingMinutes(order)
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
function matchesRange(value: number | null | undefined, min?: number, max?: number): boolean {
  if (min == null && max == null) return true
  if (value == null || !Number.isFinite(value)) return false
  if (min != null && value < min) return false
  if (max != null && value > max) return false
  return true
}


/** 仅返回当前页完整记录；筛选汇总始终覆盖全部匹配交易。 */
export function queryTradeHistory(allHistory: TradeHistory[], query: Record<string, any>) {
  const filter: any = { ...query }
  for (const key of ['pnlMin','pnlMax','scoreMin','scoreMax','confidenceMin','confidenceMax','oiMin','oiMax','estimatedVolumeMin','estimatedVolumeMax','openTimeMin','openTimeMax','holdingMinutesMin','holdingMinutesMax']) {
    filter[key] = query[key] === undefined || query[key] === '' ? undefined : Number(query[key])
    if (filter[key] !== undefined && !Number.isFinite(filter[key])) throw new Error(`无效筛选参数: ${key}`)
  }
  // 指标按入场快照筛选，不用当前行情补算旧记录，避免复盘数据随行情变化。
  const indicatorRanges = [
    ['rsi', (order: TradeHistory) => order.entryIndicators?.RSI],
    ['adx', (order: TradeHistory) => order.entryIndicators?.ADX],
    ['adxSlope', (order: TradeHistory) => order.entryIndicators?.ADXSlope],
    ['atrPercent', (order: TradeHistory) => order.entryIndicators?.ATRVolatilityPercent],
    ['resistanceDistanceATR', (order: TradeHistory) => order.entrySupportResistance?.resistanceDistanceATR],
    ['supportDistanceATR', (order: TradeHistory) => order.entrySupportResistance?.supportDistanceATR],
    // 固定匹配订单主周期，不能取任意一个满足范围的周期冒充主周期 ER。
    ['er', (order: TradeHistory) => {
      const timeframe = order.mainTimeframe || order.entrySupportResistance?.timeframe
      const snapshot = order.entryER?.find(item => item.timeframe === timeframe)
      return snapshot?.status === 'ready' ? snapshot.er : undefined
    }],
  ] as const
  for (const [name] of indicatorRanges) {
    for (const key of [`${name}Min`, `${name}Max`]) {
      filter[key] = query[key] === undefined || query[key] === '' ? undefined : Number(query[key])
      if (filter[key] !== undefined && !Number.isFinite(filter[key])) throw new Error(`无效筛选参数: ${key}`)
    }
    if (filter[`${name}Min`] != null && filter[`${name}Max`] != null && filter[`${name}Min`] > filter[`${name}Max`]) {
      throw new Error(`筛选最小值不能大于最大值: ${name}`)
    }
  }
  if ((filter.erMin != null && (filter.erMin < 0 || filter.erMin > 1))
    || (filter.erMax != null && (filter.erMax < 0 || filter.erMax > 1))) {
    throw new Error('ER 筛选范围必须在 0～1 之间')
  }
  if (filter.openTimeMin != null && filter.openTimeMax != null && filter.openTimeMin > filter.openTimeMax) {
    throw new Error('开始时间不能晚于结束时间')
  }
  if ((filter.holdingMinutesMin != null && filter.holdingMinutesMin < 0)
    || (filter.holdingMinutesMax != null && filter.holdingMinutesMax < 0)) {
    throw new Error('持仓时间不能小于 0 分钟')
  }
  if (filter.holdingMinutesMin != null && filter.holdingMinutesMax != null && filter.holdingMinutesMin > filter.holdingMinutesMax) {
    throw new Error('持仓时间最小值不能大于最大值')
  }
  const sort = { field: (query.sortField || 'closeTime') as SortField, direction: query.sortDirection === 'asc' ? 'asc' : 'desc' }
  if (!SORT_FIELDS.includes(sort.field)) throw new Error('无效排序字段')
  let result = [...allHistory]

  // 按开仓时间筛选全部记录，确保分页与盈亏、胜率汇总采用相同时间范围。
  result = result.filter(order => matchesRange(order.openTime, filter.openTimeMin, filter.openTimeMax))
  // 使用未取整的实际分钟数，并在分页及统计前过滤，保证列表和汇总一致。
  result = result.filter(order => matchesRange(getHoldingMinutes(order), filter.holdingMinutesMin, filter.holdingMinutesMax))

  // 多选按任意一个交易对命中，兼容原单值及重复查询参数；在分页和汇总前限定范围。
  const selectedSymbols = new Set((Array.isArray(filter.symbol) ? filter.symbol : [filter.symbol])
    .flatMap((value: unknown) => typeof value === 'string' ? value.split(',') : [])
    .map((value: string) => value.trim()).filter(Boolean))
  if (selectedSymbols.size) {
    result = result.filter(order => selectedSymbols.has(order.symbol))
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

  // 在分页和汇总之前组合全部指标条件，缺少指标的旧记录沿用区间筛选规则。
  result = result.filter(order => indicatorRanges.every(([name, getValue]) =>
    matchesRange(getValue(order), filter[`${name}Min`], filter[`${name}Max`])
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
  const totalPnl = result.reduce((sum, record) => sum + (Number.isFinite(record.pnl) ? record.pnl : 0), 0)
  // 盈亏比按每笔平均收益计算；保本不计入胜负，没有亏损时用 null 表示无法计算。
  const wins = result.filter(record => Number.isFinite(record.pnl) && record.pnl > 0)
  const losses = result.filter(record => Number.isFinite(record.pnl) && record.pnl < 0)
  const averageWin = wins.length ? wins.reduce((sum, record) => sum + record.pnl, 0) / wins.length : 0
  const averageLoss = losses.length ? Math.abs(losses.reduce((sum, record) => sum + record.pnl, 0) / losses.length) : 0
  return {
    data: result.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: result.length, totalPages },
    summary: {
      orderCount: result.length,
      winCount,
      totalPnl,
      winRate: result.length ? winCount / result.length * 100 : 0,
      averagePnl: result.length ? totalPnl / result.length : 0,
      payoffRatio: averageLoss ? averageWin / averageLoss : null,
    },
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
