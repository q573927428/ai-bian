// ==================== 宏观固定起止与月份比较测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMacroComparison } from '../app/utils/macro-comparison.ts'
import { maxCloseDrawdown, relativeToBtc } from '../app/utils/macro-performance.ts'

const seconds = date => Date.parse(date) / 1000
const bars = values => new Map(values.map(([date, close]) => {
  const time = seconds(date)
  return [time, { time, close }]
}))

test('双点固定结束位置，后续最新行情不改变结果；反向点击按时间排序', () => {
  const data = bars([['2026-09-01', 100], ['2026-09-02', 200], ['2026-09-03', 120], ['2026-11-01', 500]])
  const key = seconds('2026-09-01'), endKey = seconds('2026-09-03')
  for (const request of [{ key, endKey }, { key: endKey, endKey: key }]) {
    const range = resolveMacroComparison(data, { ...request, period: '1d' })
    assert.equal(range.from.close, 100)
    assert.equal(range.to.close, 120)
    assert.equal(maxCloseDrawdown(range.closes), 40)
  }
  assert.equal(resolveMacroComparison(data, { key, period: '1d' }).to.close, 500)
})

test('固定端点缺失或休市不吸附，允许同一根 K 线零区间', () => {
  const data = bars([['2026-09-01', 100], ['2026-09-03', 120]])
  const key = seconds('2026-09-01')
  assert.equal(resolveMacroComparison(data, { key, endKey: seconds('2026-09-02'), period: '1d' }), null)
  assert.equal(resolveMacroComparison(data, { key: seconds('2026-08-31'), period: '1d' }), null)
  assert.equal(resolveMacroComparison(data, { key, endKey: key, period: '1d' }).count, 1)
})

test('月份使用月内现有首尾收盘，不借用上月或下月；空月份与无效月份无结果', () => {
  const data = bars([['2026-08-31', 50], ['2026-09-02', 100], ['2026-09-29', 120], ['2026-10-01', 200]])
  const range = resolveMacroComparison(data, { key: 0, month: '2026-09', period: '1d' })
  assert.equal(range.from.close, 100)
  assert.equal(range.to.close, 120)
  assert.equal(range.count, 2)
  const btc = new Map([[range.fromKey, 100], [range.toKey, 110]])
  assert.ok(Math.abs(relativeToBtc(20, range.fromKey, range.toKey, btc) - (1.2 / 1.1 - 1) * 100) < 1e-9)
  for (const month of ['2025-09', '2026-13', 'bad']) {
    assert.equal(resolveMacroComparison(data, { key: 0, month, period: '1d' }), null)
  }
})

test('分钟线月份按北京时间跨年边界划分，日线仍按交易日期', () => {
  const data = bars([['2026-12-31T15:00:00Z', 100], ['2026-12-31T16:00:00Z', 120], ['2027-01-01T00:00:00Z', 150]])
  const request = { key: 0, month: '2027-01', period: '1h' }
  assert.equal(resolveMacroComparison(data, request).from.close, 120)
  assert.equal(resolveMacroComparison(data, { ...request, period: '1d' }).from.close, 150)
})
