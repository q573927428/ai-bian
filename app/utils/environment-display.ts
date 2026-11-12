// ==================== 环境详情展示转换 ====================
import type { EnvironmentContext, PeriodTrend, TrendStrength } from './environment-confidence'
import type { MarketBreadthSummary } from '../../types/market-breadth'

/** 选中交易对的环境面板数据，全部来自指标列表当前响应及共享时钟。 */
export interface EnvironmentDetailsData {
  symbol: string
  timeframe: string
  now: number
  context?: EnvironmentContext
  summary?: MarketBreadthSummary
  breadthDescription?: string
}

/** 单周期的展示字段；历史单标签不推断不存在的 DI/MACD 明细。 */
export interface PeriodTrendDisplay {
  direction: string
  di?: TrendStrength
  macd?: TrendStrength
  fallback?: string
}

/** 按所选方向展示名次；做空按归一化表现从低到高排，并保留同值并列。 */
export function directionalRankPosition(ranking: NonNullable<MarketBreadthSummary['ranking']>, direction: 'long' | 'short'): number {
  // 反向名次等于比当前标的更弱的样本数加1，必须扣除整个同值组而非仅扣自身。
  return direction === 'long' ? ranking.position : ranking.sampleCount - ranking.position - ranking.tiedCount + 2
}

/** 拆分服务端组合标签，仅调整展示，不重新计算趋势或环境分数。 */
export function periodTrendDisplay(trend?: PeriodTrend): PeriodTrendDisplay {
  if (!trend || trend === '--') return { direction: '暂无数据' }
  if (trend === '中性' || trend === '方向分歧') return { direction: trend }
  const direction = trend.startsWith('多头') ? '多头' : '空头'
  const double = /^(多头|空头)双(增强|持平|减弱)$/.exec(trend)
  if (double) return { direction, di: double[2] as TrendStrength, macd: double[2] as TrendStrength }
  const mixed = /^(多头|空头)DI(增强|持平|减弱)、MACD(增强|持平|减弱)$/.exec(trend)
  if (mixed) return { direction, di: mixed[2] as TrendStrength, macd: mixed[3] as TrendStrength }
  // 旧版档案只保留合并后的强弱，不能从一个词反推出两个指标。
  return { direction, fallback: trend.slice(2) }
}
