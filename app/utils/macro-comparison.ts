// ==================== 宏观固定区间与月份端点解析 ====================

/** 比较请求使用交易日期键；分钟周期月份按北京时间划分。 */
interface ComparisonRequest {
  key: number
  endKey?: number
  month?: string
  period: string
}

/** 缓存 K 线保留实际时间戳和收盘价，键负责跨市场日期对齐。 */
interface ComparisonBar {
  time: number
  close: number
}

/** 固定双点必须精确匹配；月份选择月内首尾已有 K 线，不借用其他月份数据。 */
export function resolveMacroComparison<T extends ComparisonBar>(bars: Map<number, T>, request: ComparisonRequest) {
  let entries = [...bars.entries()].sort((a, b) => a[0] - b[0])
  if (request.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month)) return null
    entries = entries.filter(([key]) => {
      // 日周线键已经是交易日期；分钟线按图表展示的北京时间归属月份。
      const offset = request.period === '1d' || request.period === '1w' ? 0 : 8 * 3600
      return new Date((key + offset) * 1000).toISOString().slice(0, 7) === request.month
    })
  } else {
    const end = request.endKey ?? entries.at(-1)?.[0]
    if (end == null || !bars.has(request.key) || !bars.has(end)) return null
    const from = Math.min(request.key, end), to = Math.max(request.key, end)
    entries = entries.filter(([key]) => key >= from && key <= to)
  }
  const first = entries[0], last = entries.at(-1)
  if (!first || !last) return null
  return { from: first[1], to: last[1], fromKey: first[0], toKey: last[0],
    closes: entries.map(([, bar]) => bar.close), count: entries.length }
}
