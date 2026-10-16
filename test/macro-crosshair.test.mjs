// ==================== 宏观光标跨市场时间匹配测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { crosshairTimeKey } from '../app/components/macro-data/crosshair-sync.ts'

const seconds = value => Date.parse(value) / 1000

test('分钟周期保留精确时间，不将附近或休市前的K线视为同一时刻', () => {
  const time = seconds('2026-10-15T13:30:00Z')
  for (const period of ['15m', '1h', '4h']) {
    assert.equal(crosshairTimeKey(time, period, 'btc'), time)
    assert.notEqual(crosshairTimeKey(time, period, 'btc'), crosshairTimeKey(time + 1800, period, 'cqqq'))
  }
})

test('日线跨市场按交易日期匹配，不要求开盘时间戳相同', () => {
  const btc = crosshairTimeKey(seconds('2026-10-15T00:00:00Z'), '1d', 'btc')
  const cqqq = crosshairTimeKey(seconds('2026-10-15T13:30:00Z'), '1d', 'cqqq')
  const nikkei = crosshairTimeKey(seconds('2026-10-15T00:00:00Z'), '1d', 'nikkei')
  assert.equal(btc, cqqq)
  assert.equal(btc, nikkei)
  assert.notEqual(btc, crosshairTimeKey(seconds('2026-10-16T00:00:00Z'), '1d', 'btc'))
})

test('周线将东京周一零点及美股周一起点匹配到同一周', () => {
  const btc = crosshairTimeKey(seconds('2026-10-12T00:00:00Z'), '1w', 'btc')
  assert.equal(btc, crosshairTimeKey(seconds('2026-10-11T15:00:00Z'), '1w', 'nikkei'))
  assert.equal(btc, crosshairTimeKey(seconds('2026-10-12T04:00:00Z'), '1w', 'cqqq'))
  assert.notEqual(btc, crosshairTimeKey(seconds('2026-10-05T00:00:00Z'), '1w', 'btc'))
})

test('美股夏令时切换不会改变交易日匹配', () => {
  for (const [date, hour] of [['2026-10-30', '13:30'], ['2026-11-02', '14:30']]) {
    assert.equal(crosshairTimeKey(seconds(`${date}T${hour}:00Z`), '1d', 'cqqq'), seconds(`${date}T00:00:00Z`))
  }
})
