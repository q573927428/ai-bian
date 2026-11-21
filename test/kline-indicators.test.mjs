// ==================== K 线工作台副图测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_KLINE_INDICATOR, KLINE_INDICATORS, KLINE_WORKSPACE_PERIODS, getKlineIndicatorSeries } from '../app/utils/kline-indicators.ts'
import { calculateAdxChartSeries } from '../app/utils/adx-chart-series.ts'
import { calculateErChartSeries } from '../app/utils/er-chart-series.ts'
import { createIndicatorPane } from '../app/components/kline-chart/utils/indicator-pane.ts'
import { alignToKlineTime } from '../app/components/kline-chart/utils/kline-formatters.ts'

const step = 900
const start = 1_760_000_400
const bars = Array.from({ length: 70 }, (_, i) => {
  const close = 100 + i + Math.sin(i) * 4
  return { t: start + i * step, o: close - 1, h: close + 2, l: close - 2, c: close, v: 50, q: 100, bq: i % 2 ? 40 : 65 }
})
const now = (start + 69.5 * step) * 1000

test('默认 MACD，DMI 取代三个独立按钮，所有副图仍与 K 线对齐', () => {
  assert.equal(DEFAULT_KLINE_INDICATOR, 'MACD')
  assert.deepEqual(KLINE_INDICATORS, ['CVD', 'DELTA', 'DMI', 'RSI', 'ER20', 'MACD'])
  for (const indicator of KLINE_INDICATORS) {
    for (const series of getKlineIndicatorSeries(indicator, bars, '15m', now)) {
      assert.equal(series.values.length, bars.length, indicator)
      assert.ok(Number.isFinite(series.values.at(-1)), indicator)
    }
  }
  assert.deepEqual(getKlineIndicatorSeries('MACD', bars, '15m').map(({ label, kind }) => [label, kind]),
    [['MACD', 'histogram'], ['DIF', 'line'], ['DEA', 'line']])
})

test('工作台开放周线，所有副图指标均按实际周线间隔计算', () => {
  assert.deepEqual(KLINE_WORKSPACE_PERIODS, ['5m', '15m', '1h', '4h', '1d', '1w'])
  const week = 604_800
  const monday = Date.parse('2025-01-06T00:00:00Z') / 1000
  const weeklyBars = bars.map((bar, index) => ({ ...bar, t: monday + index * week }))
  const weeklyNow = (monday + 69.5 * week) * 1000
  for (const indicator of KLINE_INDICATORS) {
    const series = getKlineIndicatorSeries(indicator, weeklyBars, '1w', weeklyNow)
    assert.deepEqual(series, getKlineIndicatorSeries(indicator, bars, '15m', now), indicator)
  }
})

test('周线在 UTC 周一切换，不会因 Unix 纪元起于周四而追加错误的周线', () => {
  const monday = Date.parse('2025-11-17T00:00:00Z')
  assert.equal(alignToKlineTime(monday - 1, '1w'), monday / 1000 - 604_800)
  assert.equal(alignToKlineTime(monday, '1w'), monday / 1000)
  assert.equal(alignToKlineTime(Date.parse('2025-11-20T00:00:00Z'), '1w'), monday / 1000)
  assert.equal(alignToKlineTime(monday + 299_999, '5m'), monday / 1000)
  assert.equal(alignToKlineTime(monday + 300_000, '5m'), monday / 1000 + 300)
})

test('CVD / DELTA 使用主动成交额，缺失时留空并重置累计', () => {
  const sample = [bars[0], bars[1], { ...bars[2], bq: undefined }, bars[3]]
  assert.deepEqual(getKlineIndicatorSeries('DELTA', sample, '15m')[0].values, [30, -20, null, -20])
  assert.deepEqual(getKlineIndicatorSeries('CVD', sample, '15m')[0].values, [30, 10, null, -20])
})

test('DMI 同时输出 ADX、+DI、-DI，保留相同的预热和缺口', () => {
  const sample = bars.filter((_, index) => index !== 35)
  const expected = calculateAdxChartSeries(sample, step)
  const lines = getKlineIndicatorSeries('DMI', sample, '15m')
  assert.deepEqual(lines.map(({ label, kind, lineWidth }) => [label, kind, lineWidth]),
    [['ADX', 'line', 2], ['+DI', 'line', 1], ['-DI', 'line', 1]])
  for (const [index, key] of ['adx', 'pdi', 'mdi'].entries()) {
    const { values } = lines[index]
    assert.deepEqual(values, expected.map(point => point?.[key] ?? null))
    assert.equal(values[0], null)
    assert.equal(values[35], null)
    assert.ok(Number.isFinite(values.at(-1)))
  }
})

test('DMI 三线共用右轴，图例可单独隐藏曲线并在切回时保留设置', () => {
  const active = new Set()
  const pane = {
    setStretchFactor() {},
    priceScale: () => ({ applyOptions() {} }),
    addSeries(_type, options) {
      const series = {
        options,
        writes: 0,
        setData() { this.writes++ },
        applyOptions(patch) { Object.assign(this.options, patch) }
      }
      active.add(series)
      return series
    }
  }
  const chart = { addPane: () => pane, panes: () => [], removeSeries: series => active.delete(series) }
  const indicatorPane = createIndicatorPane(chart, new Set())
  const visibility = () => [...active].map(series => series.options.visible)
  indicatorPane.update('DMI', bars, '15m')
  assert.deepEqual([...active].map(series => series.options.priceScaleId), ['right', 'right', 'right'])
  assert.deepEqual(visibility(), [true, true, true])

  const original = [...active]
  indicatorPane.setHiddenDmiLines(new Set(['+DI', '-DI']))
  assert.deepEqual(visibility(), [true, false, false])
  assert.deepEqual([...active], original)
  assert.deepEqual(original.map(series => series.writes), [1, 1, 1])

  indicatorPane.update('MACD', bars, '15m')
  indicatorPane.update('DMI', bars, '15m')
  assert.deepEqual(visibility(), [true, false, false])
  indicatorPane.setHiddenDmiLines(new Set())
  assert.deepEqual(visibility(), [true, true, true])
})

test('ER20 保留预热空值并按百分比显示', () => {
  const [{ values }] = getKlineIndicatorSeries('ER20', bars, '15m', now)
  assert.equal(values[19], null)
  assert.equal(values.at(-1), calculateErChartSeries(bars, '15m', step, now, 20).at(-1) * 100)
})
