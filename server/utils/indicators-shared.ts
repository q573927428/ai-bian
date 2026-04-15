import type { BotConfig } from '../../types'

/**
 * 通用工具：计算百分比差值
 */
export function calculatePercentage(value: number, base: number): string {
  if (base === 0) return 'N/A'
  return ((value - base) / base * 100).toFixed(2)
}

/**
 * 通用工具：获取EMA周期配置
 * 直接传入BotConfig自动获取参数
 */
export function getEMAPeriodConfig(config?: BotConfig) {
  const strategyMode = config?.strategyMode || 'short_term'
  const periods = config?.indicatorsConfig?.emaPeriods

  const fast = periods?.[strategyMode]?.fast || (strategyMode === 'medium_term' ? 50 : 20)
  const medium = periods?.[strategyMode]?.medium || (strategyMode === 'medium_term' ? 100 : 30)
  const slow = periods?.[strategyMode]?.slow || (strategyMode === 'medium_term' ? 200 : 60)
  return {
    strategyMode,
    fast,
    medium,
    slow,
    fastName: `EMA${fast}`,
    mediumName: `EMA${medium}`,
    slowName: `EMA${slow}`
  }
}
