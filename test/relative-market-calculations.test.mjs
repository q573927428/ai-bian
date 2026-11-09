// ==================== 同期收盘比值及盘中趋势口径回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { ratioClosingPrices, realizedVolatility, dailyQuoteVolumes } from '../app/utils/relative-market-calculations.ts'

const start = Date.UTC(2026, 8, 1) / 1000
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 10 })

test('比值仅使用同期收盘价，交换币种取倒数，不受各自高低点影响', () => {
  const a = [bar(start, 20, 30, 15, 24)]
  const b = [bar(start, 100, 120, 90, 96)]
  const [ratio] = ratioClosingPrices(a, b)
  assert.deepEqual(ratio, { t: start, value: .25 })
  const [inverse] = ratioClosingPrices(b, a)
  assert.equal(inverse.value, 1 / ratio.value)
  assert.deepEqual(ratioClosingPrices([{ ...a[0], h: 1000, l: 1 }], b), [ratio])
})

test('不同时间不配对，非法收盘价留空，输出去重排序并排除未来点', () => {
  const good = bar(start, 20, 30, 15, 24)
  const left = [
    { ...good, t: start + 600 }, good, good,
    { ...good, t: start + 300 }, { ...good, t: start + 900, c: 0 },
    { ...good, t: start + 1200, c: NaN }, { ...good, t: start + 1500 },
  ]
  const right = [start, start + 600, start + 900, start + 1200, start + 1500].map(t => bar(t, 100, 120, 90, 96))
  assert.deepEqual(ratioClosingPrices(left, right, start + 1400).map(row => row.t), [start, start + 600])
  assert.deepEqual(ratioClosingPrices([good], [{ ...right[0], c: 0 }]), [])
  assert.deepEqual(ratioClosingPrices([good], [{ ...right[0], c: Infinity }]), [])
})

const daily = Array.from({ length: 33 }, (_, i) => bar(start + i * 86400, 100, 200, 1, 100 * Math.exp(i % 2 ? .1 : 0)))
test('波动率需31根连续日线，今天纳入估算而未来排除，历史收盘结果不变', () => {
  assert.deepEqual(realizedVolatility(daily.slice(0, 30), start + 40 * 86400), [])
  const result = realizedVolatility(daily, start + 31 * 86400)
  assert.equal(result.length, 2)
  assert.equal(result[0].date, '2026-10-01')
  assert.ok(Math.abs(result[0].value - Math.sqrt((30 * .1 ** 2 / 29) * 365) * 100) < 1e-9)
  assert.equal(result[0].provisional, false)
  assert.equal(result[1].date, '2026-10-02')
  assert.equal(result[1].provisional, true)
  const updated = realizedVolatility(daily.map((row, i) => i === 31 ? { ...row, c: 150 } : row), start + 31.5 * 86400)
  assert.deepEqual(updated[0], result[0])
  assert.notEqual(updated[1].value, result[1].value)
})

test('成交额保留今天盘中累计，零值有效，缺字段不代算，未来排除', () => {
  const rows = daily.slice(0, 6).map((row, i) => ({ ...row, q: i * 100 }))
  delete rows[1].q
  rows[2].q = NaN
  const result = dailyQuoteVolumes(rows, start + 4.5 * 86400)
  assert.deepEqual(result.map(row => row.value), [0, 300, 400])
  assert.deepEqual(result.map(row => row.provisional), [false, false, true])
  assert.equal(result.at(-1).date, '2026-09-05')
})

test('断档和无效收盘价使波动率留空，横盘的零波动有效', () => {
  const now = start + 40 * 86400
  assert.deepEqual(realizedVolatility(daily.filter((_, i) => i !== 15), now), [])
  assert.deepEqual(realizedVolatility(daily.map((row, i) => i === 15 ? { ...row, c: 0 } : row), now), [])
  assert.ok(realizedVolatility(daily.map(row => ({ ...row, c: 100 })), now).every(row => row.value === 0))
})

test('30、90、365日窗口各用对应数量日收益，历史不足不降级为30日', () => {
  const rows = Array.from({ length: 400 }, (_, i) => bar(start + i * 86400, 100, 200, 1, 100 * Math.exp((i % 2 ? .1 : 0) + (i > 300 ? (i % 3) * .2 : 0))))
  const now = start + 399.5 * 86400
  const values = []
  for (const window of [30, 90, 365]) {
    assert.deepEqual(realizedVolatility(rows.slice(0, window), now, window), [])
    const result = realizedVolatility(rows, now, window)
    assert.equal(result.length, rows.length - window)
    const closes = rows.slice(-(window + 1)).map(row => row.c)
    const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]))
    const mean = returns.reduce((sum, value) => sum + value, 0) / window
    const expected = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (window - 1) * 365) * 100
    assert.ok(Math.abs(result.at(-1).value - expected) < 1e-9)
    assert.equal(result.at(-1).provisional, true)
    values.push(result.at(-1).value)
  }
  assert.notEqual(values[0], values[1])
  assert.notEqual(values[1], values[2])
})
