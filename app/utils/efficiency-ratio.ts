// ==================== 趋势效率 ER 计算及配置归一化 ====================
import type { OHLCV } from '../../types'
import type { Timeframe } from '../../types/strategy'
import type { EfficiencyRatioSnapshot, ERTimeframe } from '../../types/efficiency-ratio'

export const DEFAULT_ER_PERIOD = 20
export const MIN_ER_PERIOD = 2
// 限制观察窗口，避免不合理参数超出常规行情缓存的覆盖范围。
export const MAX_ER_PERIOD = 100
// 图表另有 1m、1w 周期，计算时支持它们，策略配置仍沿用原有周期范围。
const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000
}

// 计算表覆盖图表的全部周期；策略配置仍使用上表校验，避免放宽可选周期。
const ER_TIMEFRAME_MS: Record<ERTimeframe, number> = {
  ...TIMEFRAME_MS, '1m': 60_000, '1w': 604_800_000
}

/** 前后端使用相同边界，拒绝无效周期并保留可用的整数窗口。 */
export function normalizeERPeriod(value: unknown): number {
  const period = Number(value ?? DEFAULT_ER_PERIOD)
  return Number.isFinite(period)
    ? Math.max(MIN_ER_PERIOD, Math.min(MAX_ER_PERIOD, Math.floor(period)))
    : DEFAULT_ER_PERIOD
}

/** ER 统一使用策略勾选的 K 线周期；去重排序，旧策略缺失周期时回退主周期。 */
export function normalizeERTimeframes(strategyTimeframes: unknown, fallback: Timeframe): Timeframe[] {
  const timeframes = Array.isArray(strategyTimeframes)
    ? strategyTimeframes.filter((tf): tf is Timeframe => Object.hasOwn(TIMEFRAME_MS, tf))
    : []
  return timeframes.length
    ? [...new Set(timeframes)].sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b])
    : [fallback]
}

/**
 * 计算 ER = |末收盘价 - 首收盘价| / Σ|相邻收盘价之差|。
 * now 必须使用本轮行情快照时刻；只使用该时刻已收盘且连续的 N+1 根 K 线。
 */
export function calculateEfficiencyRatio<T extends ERTimeframe>(
  klines: readonly OHLCV[], timeframe: T,
  options: { period?: number; now?: number } = {}
): EfficiencyRatioSnapshot<T> {
  const period = normalizeERPeriod(options.period)
  const now = options.now ?? Date.now()
  const timeframeMs = ER_TIMEFRAME_MS[timeframe]
  const result: EfficiencyRatioSnapshot<T> = {
    timeframe, period, status: 'insufficient_data', er: null, direction: null,
    netChange: null, netChangePercent: null, pathLength: null, startClose: null, endClose: null,
    firstCandleTimestamp: null, lastCandleTimestamp: null, closedAt: null,
    calculatedAt: now, availableClosedCandles: 0, requiredClosedCandles: period + 1
  }
  if (!Number.isFinite(now) || !timeframeMs || klines.some(c => !Number.isFinite(c.timestamp))) {
    return { ...result, status: 'invalid_data', reason: '快照时刻、周期或K线时间戳无效' }
  }

  // 排除盘中和未来 K 线，不能让未收盘的剧烈波动改变当前 ER。
  const closed = klines.filter(c => c.timestamp + timeframeMs <= now)
    .sort((a, b) => a.timestamp - b.timestamp)
  result.availableClosedCandles = closed.length
  const latest = closed.at(-1)
  if (latest) {
    result.lastCandleTimestamp = latest.timestamp
    result.closedAt = latest.timestamp + timeframeMs
  }
  if (closed.length < period + 1) {
    return { ...result, reason: `需要${period + 1}个已收盘价，当前仅${closed.length}个` }
  }
  // 最新应收盘 K 线缺失时不把旧趋势当成当前行情。
  if (now - result.closedAt! >= timeframeMs) {
    return { ...result, status: 'stale_data', reason: '缺少最近应收盘K线，ER已过期' }
  }

  const window = closed.slice(-(period + 1))
  result.firstCandleTimestamp = window[0]!.timestamp
  if (window.some((c, i) => !Number.isFinite(c.close) || c.close <= 0
    || (i > 0 && c.timestamp - window[i - 1]!.timestamp !== timeframeMs))) {
    // 不跨缺口拼接，也不将重复时间戳当成额外一次价格变化。
    return { ...result, status: 'invalid_data', reason: 'ER窗口内收盘价无效或K线不连续（含重复时间）' }
  }
  const startClose = window[0]!.close
  const endClose = window.at(-1)!.close
  const netChange = endClose - startClose
  const pathLength = window.slice(1).reduce((sum, c, i) => sum + Math.abs(c.close - window[i]!.close), 0)
  const netChangePercent = netChange / startClose * 100
  if (!Number.isFinite(pathLength) || !Number.isFinite(netChangePercent)) {
    return { ...result, status: 'invalid_data', reason: '价格变化计算溢出' }
  }
  return {
    ...result, status: 'ready',
    // 完全不动时定义为 0；浮点误差不应把比值推到 0～1 之外。
    er: pathLength === 0 ? 0 : Math.min(1, Math.max(0, Math.abs(netChange) / pathLength)),
    direction: netChange > 0 ? 'up' : netChange < 0 ? 'down' : 'flat',
    netChange, netChangePercent, pathLength, startClose, endClose
  }
}
