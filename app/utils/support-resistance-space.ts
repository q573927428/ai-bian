// ==================== 支撑阻力开仓空间参考与横截面统计 ====================
import type { SupportResistanceSnapshot } from '../../types/support-resistance'

// 基于 66 个配置交易对的五周期横截面选取初始门槛，不随单次行情分布自动放宽。
// ATR 已按周期归一化；短周期统一 1.5，波段周期取 2，留出更大的结构空间。
export const ENTRY_SPACE_ATR = { '5m': 1.5, '15m': 1.5, '1h': 1.5, '4h': 2, '1d': 2 } as const

export type EntryProximityFilter = 'all' | 'long' | 'short'

/** 仅筛选靠近支撑/阻力的位置，不隐含趋势或前方空间条件；缺失区域不得按零距离命中。 */
export function matchesEntryProximity(
  snapshot: SupportResistanceSnapshot | undefined, timeframe: string,
  direction: EntryProximityFilter, threshold: number | null | undefined
): boolean {
  if (direction === 'all') return true
  if (!snapshot || snapshot.timeframe !== timeframe || snapshot.status === 'insufficient_data'
    || typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) return false
  const zone = direction === 'long' ? snapshot.nearestSupport : snapshot.nearestResistance
  const distance = direction === 'long' ? snapshot.supportDistanceATR : snapshot.resistanceDistanceATR
  return !!zone && typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 && distance <= threshold
}

/** 单方向的有效区域样本数、缺失数、达标数和距离中位数；缺失区域不表示无限空间。 */
export interface EntrySpaceSideStats {
  valid: number
  missing: number
  passed: number
  median: number | null
}

/**
 * 按完整配置交易对统计当前周期，避免搜索、排序、方向筛选改变参考口径。
 * 做多用最近阻力，做空用最近支撑；区域内的零距离有效但不满足正数门槛。
 */
export function summarizeEntrySpace(
  snapshots: Array<SupportResistanceSnapshot | undefined>, timeframe: keyof typeof ENTRY_SPACE_ATR, total: number
): { long: EntrySpaceSideStats; short: EntrySpaceSideStats } {
  const threshold = ENTRY_SPACE_ATR[timeframe]
  const summarize = (side: 'support' | 'resistance'): EntrySpaceSideStats => {
    const values: number[] = []
    for (const snapshot of snapshots) {
      // 周期切换时旧表格可能仍可见，不能将上一周期的数据计入新周期。
      if (!snapshot || snapshot.timeframe !== timeframe || snapshot.status === 'insufficient_data') continue
      const zone = side === 'support' ? snapshot.nearestSupport : snapshot.nearestResistance
      const value = side === 'support' ? snapshot.supportDistanceATR : snapshot.resistanceDistanceATR
      if (zone && typeof value === 'number' && Number.isFinite(value) && value >= 0) values.push(value)
    }
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return {
      valid: values.length,
      missing: Math.max(0, total - values.length),
      passed: values.filter(value => value >= threshold).length,
      median: values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[middle]!) / 2 : null
    }
  }
  return { long: summarize('resistance'), short: summarize('support') }
}
