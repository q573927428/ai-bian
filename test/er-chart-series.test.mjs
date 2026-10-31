// ==================== ER 图表时间对齐及服务端口径回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateErChartSeries } from '../app/utils/er-chart-series.ts'
import { calculateEfficiencyRatio } from '../shared/utils/efficiency-ratio.ts'

const start = Date.UTC(2026, 9, 30) / 1000
const step = 900
const bars = Array.from({ length: 50 }, (_, i) => ({
  t: start + i * step, o: 100 + i, h: 102 + i, l: 99 + i,
  c: 100 + i + Math.sin(i) * 3, v: 10
}))

test('ER 曲线预热留空，仅绘制已收盘数据，最新值与服务端一致', () => {
  const now = (start + 49.5 * step) * 1000
  const series = calculateErChartSeries(bars, '15m', step, now)
  assert.equal(series.length, bars.length)
  assert.ok(series.slice(0, 20).every(value => value === null))
  assert.equal(series[49], null)
  const candles = bars.map(b => ({ timestamp: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
  assert.equal(series[48], calculateEfficiencyRatio(candles, '15m', { now }).er)
  assert.ok(series.slice(20, 49).every(value => value >= 0 && value <= 1))
})

test('未来价格不改变历史 ER，收盘后才补上该根曲线', () => {
  const now = (start + 49.5 * step) * 1000
  const changed = bars.map((b, i) => i === 49 ? { ...b, c: 5000 } : b)
  assert.deepEqual(calculateErChartSeries(changed, '15m', step, now), calculateErChartSeries(bars, '15m', step, now))
  assert.notEqual(calculateErChartSeries(changed, '15m', step, (start + 50 * step) * 1000)[49], null)
})

test('窗口断档或非法价格留空，完全不动为有效零值', () => {
  const now = (start + 50 * step) * 1000
  const invalid = bars.map((b, i) => i === 35 ? { ...b, c: NaN } : b)
  assert.equal(calculateErChartSeries(invalid, '15m', step, now)[49], null)
  const gap = bars.filter((_, i) => i !== 35)
  assert.equal(calculateErChartSeries(gap, '15m', step, now).at(-1), null)
  assert.equal(calculateErChartSeries(bars.map(b => ({ ...b, c: 100 })), '15m', step, now).at(-1), 0)
})
