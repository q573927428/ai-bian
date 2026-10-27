// ==================== 已确认摆动点支撑阻力计算器 ====================
import type { OHLCV } from '../../../types/index'
import type { PriceZone, SupportResistanceSnapshot } from '../../../types/support-resistance'

/** 实时计算参数；now 可固定为历史回放时刻，禁止使用该时刻以后的数据。 */
export interface SupportResistanceOptions {
  lookback?: number
  pivotLeft?: number
  pivotRight?: number
  mergeDistanceATR?: number
  minTouches?: number
  breakoutBufferATR?: number
  currentPrice?: number
  now?: number
}

/** 有限参数按边界归一化，防止配置错误导致无限窗口或无效比较。 */
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback
}

/**
 * 仅从已收盘且具备右侧确认的摆动点构建区域，再用实时价格计算距离。
 * 不把盘中穿越当作突破确认，也不将已失效区域自动当作反向有效区域。
 */
export function calculateSupportResistance(
  input: OHLCV[], timeframe: string, timeframeMs: number, options: SupportResistanceOptions = {}
): SupportResistanceSnapshot {
  const now = options.now ?? Date.now()
  const lookback = Math.floor(bounded(options.lookback, 96, 20, 500))
  const left = Math.floor(bounded(options.pivotLeft, 3, 1, 10))
  const right = Math.floor(bounded(options.pivotRight, 3, 1, 10))
  const merge = bounded(options.mergeDistanceATR, 0.5, 0, 2)
  // 单次已确认摆动点保留为候选，消费端按 touches 标注待验证，不伪装成多次确认。
  const minTouches = Math.floor(bounded(options.minTouches, 1, 1, 10))
  const buffer = bounded(options.breakoutBufferATR, 0.1, 0, 2)
  const bars = input.filter(c => c.timestamp <= now && [c.timestamp, c.open, c.high, c.low, c.close].every(Number.isFinite)
    && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
  const latest = bars.at(-1)
  const closed = bars.filter(c => c.timestamp + timeframeMs <= now).slice(-lookback)
  const price = options.currentPrice ?? latest?.close
  const result: SupportResistanceSnapshot = {
    algorithm: 'confirmed-pivots-v1', timeframe, calculatedAt: now,
    sourceCandleTimestamp: latest?.timestamp ?? null, lastClosedTimestamp: closed.at(-1)?.timestamp ?? null,
    referencePrice: Number.isFinite(price) && price! > 0 ? price! : null, atr: null,
    lookback, closedCandles: closed.length, pivotLeft: left, pivotRight: right,
    mergeDistanceATR: merge, minTouches, breakoutBufferATR: buffer,
    nearestSupport: null, nearestResistance: null,
    supportDistancePercent: null, resistanceDistancePercent: null,
    supportDistanceATR: null, resistanceDistanceATR: null,
    supports: [], resistances: [], brokenSupport: null, brokenResistance: null, status: 'insufficient_data'
  }
  // 缺口或乱序会使“右侧三根确认”的时间含义失真，因此保留数据不足状态。
  if (closed.length < Math.max(20, left + right + 1) || !result.referencePrice
    || closed.some((c, i) => i > 0 && c.timestamp - closed[i - 1]!.timestamp !== timeframeMs)) return result

  // 使用已收盘K线的 Wilder ATR14，盘中尖刺不会同时放大合并阈值。
  const ranges = closed.slice(1).map((c, i) => Math.max(c.high - c.low,
    Math.abs(c.high - closed[i]!.close), Math.abs(c.low - closed[i]!.close)))
  let atr = ranges.slice(0, 14).reduce((sum, n) => sum + n, 0) / 14
  for (const range of ranges.slice(14)) atr = (atr * 13 + range) / 14
  if (!(atr > 0)) return result
  result.atr = atr

  /** 同类摆动点按价格合并，限制区域总宽度，防止链式合并吞并整个区间。 */
  const buildZones = (kind: 'support' | 'resistance'): PriceZone[] => {
    const points: Array<{ price: number; confirmedAt: number }> = []
    for (let i = left; i + right < closed.length; i++) {
      const value = kind === 'support' ? closed[i]!.low : closed[i]!.high
      const neighbors = closed.slice(i - left, i + right + 1)
      // 平台相同极值仅取最后一个，避免把连续平底算作多次独立触碰。
      const isPivot = neighbors.every((c, j) => j === left || (kind === 'support'
        ? j < left ? c.low >= value : c.low > value
        : j < left ? c.high <= value : c.high < value))
      if (isPivot) points.push({ price: value, confirmedAt: closed[i + right]!.timestamp + timeframeMs })
    }
    const zones: PriceZone[] = []
    for (const point of points.sort((a, b) => a.price - b.price)) {
      const zone = zones.at(-1)
      if (zone && point.price - zone.lower <= atr * merge) {
        zone.upper = point.price
        zone.touches++
        zone.firstConfirmedAt = Math.min(zone.firstConfirmedAt, point.confirmedAt)
        zone.lastConfirmedAt = Math.max(zone.lastConfirmedAt, point.confirmedAt)
      } else {
        zones.push({ lower: point.price, upper: point.price, touches: 1,
          firstConfirmedAt: point.confirmedAt, lastConfirmedAt: point.confirmedAt })
      }
    }
    return zones.filter(z => z.touches >= minTouches)
  }
  /** 确认后曾被收盘价穿越的区域失效，不因当前价格返回就自动恢复有效性。 */
  const breached = (z: PriceZone, c: OHLCV, support: boolean) => c.timestamp + timeframeMs >= z.firstConfirmedAt
    && (support ? c.close < z.lower - atr * buffer : c.close > z.upper + atr * buffer)
  const allSupports = buildZones('support')
  const allResistances = buildZones('resistance')
  const previousBars = closed.slice(0, -1)
  const last = closed.at(-1)!
  const validBeforeLast = (z: PriceZone, support: boolean) => !previousBars.some(c => breached(z, c, support))
  const supports = allSupports.filter(z => validBeforeLast(z, true) && !breached(z, last, true))
  const resistances = allResistances.filter(z => validBeforeLast(z, false) && !breached(z, last, false))
  result.supportZones = supports
  result.resistanceZones = resistances
  result.brokenSupport = allSupports.filter(z => validBeforeLast(z, true) && breached(z, last, true))
    .sort((a, b) => a.lower - b.lower)[0] ?? null
  result.brokenResistance = allResistances.filter(z => validBeforeLast(z, false) && breached(z, last, false))
    .sort((a, b) => b.upper - a.upper)[0] ?? null
  // 结构计算已完成，允许价格层选择区域；空区域也属于有效计算结果。
  result.status = 'no_levels'
  return updateSupportResistancePrice(result, result.referencePrice, now)
}

/** 仅在已有区域上更新最近区域、距离和盘中状态，不扫描历史K线，不修改缓存或旧快照。 */
export function updateSupportResistancePrice(
  regions: SupportResistanceSnapshot, price: number | null, now = Date.now()
): SupportResistanceSnapshot {
  const result: SupportResistanceSnapshot = {
    ...regions, priceUpdatedAt: now, referencePrice: price,
    nearestSupport: null, nearestResistance: null, supports: [], resistances: [],
    supportDistancePercent: null, resistanceDistancePercent: null,
    supportDistanceATR: null, resistanceDistanceATR: null
  }
  if (!Number.isFinite(price) || price! <= 0 || !regions.atr || regions.status === 'insufficient_data') {
    result.referencePrice = Number.isFinite(price) && price! > 0 ? price : null
    result.status = 'insufficient_data'
    return result
  }
  const p = price!
  const atr = regions.atr
  const buffer = regions.breakoutBufferATR
  const supports = regions.supportZones ?? regions.supports
  const resistances = regions.resistanceZones ?? regions.resistances
  result.supports = supports.filter(z => z.lower <= p).sort((a, b) => b.upper - a.upper).slice(0, 6)
  result.resistances = resistances.filter(z => z.upper >= p).sort((a, b) => a.lower - b.lower).slice(0, 6)
  result.nearestSupport = result.supports[0] ?? null
  result.nearestResistance = result.resistances[0] ?? null
  const pendingDown = supports.some(z => p < z.lower - atr * buffer)
  const pendingUp = resistances.some(z => p > z.upper + atr * buffer)
  result.status = pendingDown ? 'breakdown_pending' : pendingUp ? 'breakout_pending'
    : result.brokenSupport ? 'breakdown_confirmed' : result.brokenResistance ? 'breakout_confirmed'
      : result.nearestSupport && p <= result.nearestSupport.upper ? 'at_support'
        : result.nearestResistance && p >= result.nearestResistance.lower ? 'at_resistance'
          : result.nearestSupport || result.nearestResistance ? 'between_levels' : 'no_levels'
  if (result.nearestSupport) {
    const distance = Math.max(0, p - result.nearestSupport.upper)
    result.supportDistancePercent = distance / p * 100
    result.supportDistanceATR = distance / atr
  }
  if (result.nearestResistance) {
    const distance = Math.max(0, result.nearestResistance.lower - p)
    result.resistanceDistancePercent = distance / p * 100
    result.resistanceDistanceATR = distance / atr
  }
  return result
}
