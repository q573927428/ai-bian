// ==================== ER 图表时间对齐及服务端口径回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateErChartSeries } from '../app/utils/er-chart-series.ts'
import { calculateEfficiencyRatio } from '../app/utils/efficiency-ratio.ts'

const start = Date.UTC(2026, 9, 30) / 1000
const step = 900
const bars = Array.from({ length: 50 }, (_, i) => ({
  t: start + i * step, o: 100 + i, h: 102 + i, l: 99 + i,
  c: 100 + i + Math.sin(i) * 3, v: 10
}))

test('首页分钟线和周线支持 ER，预热与未收盘仍留空', () => {
  for (const [timeframe, interval] of [['1m', 60], ['1w', 604800]]) {
    const candles = bars.map((bar, i) => ({ ...bar, t: start + i * interval }))
    const series = calculateErChartSeries(candles, timeframe, interval, (start + 49.5 * interval) * 1000)
    assert.equal(series[19], null)
    assert.equal(series[49], null)
    assert.ok(Number.isFinite(series[48]))
    assert.equal(series[48], calculateErChartSeries(bars, '15m', step, (start + 49.5 * step) * 1000)[48])
  }
})

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

test('盘中预览随当前价更新，不影响历史 ER 或默认已收盘口径', () => {
  const now = (start + 49.5 * step) * 1000
  const preview = data => calculateErChartSeries(data, '15m', step, now, 20, { includeOpen: true })
  const initial = preview(bars)
  const changed = bars.map((bar, i) => i === 49 ? { ...bar, c: 5000 } : bar)
  const updated = preview(changed)
  assert.ok(Number.isFinite(initial[49]))
  assert.notEqual(updated[49], initial[49])
  assert.deepEqual(updated.slice(0, 49), initial.slice(0, 49))
  assert.equal(calculateErChartSeries(changed, '15m', step, now)[49], null)
  assert.equal(initial[49], calculateErChartSeries(bars, '15m', step, (start + 50 * step) * 1000)[49])
  assert.equal(preview([...bars, { ...bars[49], t: start + 50 * step }])[50], null)
  assert.ok(initial.slice(0, 20).every(value => value === null))
  assert.equal(preview(bars.map(bar => ({ ...bar, c: 100 })))[49], 0)
  assert.equal(preview(bars.filter((_, i) => i !== 35)).at(-1), null)
})
