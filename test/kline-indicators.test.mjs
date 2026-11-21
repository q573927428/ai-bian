// ==================== K 线工作台副图测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_KLINE_INDICATOR, KLINE_INDICATORS, getKlineIndicatorSeries } from '../app/utils/kline-indicators.ts'
import { calculateAdxChartSeries } from '../app/utils/adx-chart-series.ts'
import { calculateErChartSeries } from '../app/utils/er-chart-series.ts'

const step = 900
const start = 1_760_000_400
const bars = Array.from({ length: 70 }, (_, i) => {
  const close = 100 + i + Math.sin(i) * 4
  return { t: start + i * step, o: close - 1, h: close + 2, l: close - 2, c: close, v: 50, q: 100, bq: i % 2 ? 40 : 65 }
})
const now = (start + 69.5 * step) * 1000

test('默认 MACD，八个按钮都生成与同一组 K 线对齐的副图', () => {
  assert.equal(DEFAULT_KLINE_INDICATOR, 'MACD')
  assert.equal(KLINE_INDICATORS.length, 8)
  for (const indicator of KLINE_INDICATORS) {
    for (const series of getKlineIndicatorSeries(indicator, bars, '15m', now)) {
      assert.equal(series.values.length, bars.length, indicator)
      assert.ok(Number.isFinite(series.values.at(-1)), indicator)
    }
  }
  assert.deepEqual(getKlineIndicatorSeries('MACD', bars, '15m').map(({ label, kind }) => [label, kind]),
    [['MACD', 'histogram'], ['DIF', 'line'], ['DEA', 'line']])
})

test('CVD / DELTA 使用主动成交额，缺失时留空并重置累计', () => {
  const sample = [bars[0], bars[1], { ...bars[2], bq: undefined }, bars[3]]
  assert.deepEqual(getKlineIndicatorSeries('DELTA', sample, '15m')[0].values, [30, -20, null, -20])
  assert.deepEqual(getKlineIndicatorSeries('CVD', sample, '15m')[0].values, [30, 10, null, -20])
})

test('ADX、+DI、-DI 可独立选择，ER20 保留预热空值并按百分比显示', () => {
  const latest = calculateAdxChartSeries(bars, step).at(-1)
  for (const [indicator, key] of [['ADX', 'adx'], ['+DI', 'pdi'], ['-DI', 'mdi']]) {
    const [{ values }] = getKlineIndicatorSeries(indicator, bars, '15m')
    assert.equal(values[0], null)
    assert.equal(values.at(-1), latest[key])
  }
  const [{ values }] = getKlineIndicatorSeries('ER20', bars, '15m', now)
  assert.equal(values[19], null)
  assert.equal(values.at(-1), calculateErChartSeries(bars, '15m', step, now, 20).at(-1) * 100)
})
