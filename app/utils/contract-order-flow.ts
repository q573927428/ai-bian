// ==================== 合约主动成交差额与累计序列 ====================
import type { SimpleKLineData } from '../../types/kline-simple'

/** 同一连续区间从零累计；缺失成交额或时间断档后重新计数，禁止跨缺口连线。 */
export function calculateContractFlow(bars: SimpleKLineData[], intervalSeconds: number) {
  const delta: (number | null)[] = []
  const cvd: (number | null)[] = []
  const segmentStarts: number[] = []
  let sum = 0
  let start = -1
  bars.forEach((bar, index) => {
    const valid = typeof bar.q === 'number' && Number.isFinite(bar.q) && bar.q >= 0
      && typeof bar.bq === 'number' && Number.isFinite(bar.bq) && bar.bq >= 0 && bar.bq <= bar.q
    if (!valid) {
      delta.push(null); cvd.push(null); segmentStarts.push(-1)
      start = -1
      return
    }
    if (start < 0 || (index > 0 && bar.t - bars[index - 1]!.t !== intervalSeconds)) {
      sum = 0
      start = index
    }
    const value = 2 * bar.bq! - bar.q!
    sum += value
    delta.push(value); cvd.push(sum); segmentStarts.push(start)
  })
  return { delta, cvd, segmentStarts }
}

/** 比较最近最多六根连续完整 K 线；未收盘根不参与总结，避免瞬时变化被当成确认。 */
export function summarizeContractFlow(bars: SimpleKLineData[], intervalSeconds: number, nowSeconds: number) {
  const closed = bars.filter(bar => bar.t + intervalSeconds <= nowSeconds)
  const flow = calculateContractFlow(closed, intervalSeconds)
  const end = closed.length - 1
  const segment = flow.segmentStarts[end]
  if (end < 0 || segment == null || segment < 0 || end - segment < 2) return '连续已收盘成交数据不足，暂无法判断价格与主动成交是否配合。'
  const start = Math.max(segment, end - 5)
  const net = flow.delta.slice(start, end + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const change = closed[end]!.c - closed[start]!.o
  const prefix = `近${end - start + 1}根已收盘K线：`
  if (change > 0 && net > 0) return `${prefix}价格上涨，主动买入占优，成交方向与价格配合。`
  if (change < 0 && net < 0) return `${prefix}价格下跌，主动卖出占优，成交方向与价格配合。`
  if (change > 0 && net < 0) return `${prefix}价格上涨但主动卖出占优，价格与主动成交方向分歧。`
  if (change < 0 && net > 0) return `${prefix}价格下跌但主动买入占优，价格与主动成交方向分歧。`
  return `${prefix}价格或主动成交差额接近平衡，暂无一致方向。`
}
