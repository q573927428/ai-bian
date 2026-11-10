// ==================== 图表历史 K 线合并 ====================
import type { SimpleKLineData } from '../../types/kline-simple'

/** 按时间去重并排序；后传入的数据覆盖同一时间的旧值，用于同步校正行情。 */
export function mergeKlineHistory(existing: SimpleKLineData[], incoming: SimpleKLineData[]): SimpleKLineData[] {
  const bars = new Map(existing.map(bar => [bar.t, bar]))
  for (const bar of incoming) bars.set(bar.t, bar)
  return [...bars.values()].sort((a, b) => a.t - b.t)
}
