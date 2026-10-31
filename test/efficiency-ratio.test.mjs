// ==================== ER 数学、已收盘窗口及数据质量回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateEfficiencyRatio, normalizeERPeriod, normalizeERTimeframes } from '../app/utils/efficiency-ratio.ts'

const duration = 900_000
const start = Date.UTC(2026, 9, 30)

/** 每个价格对应一根 K 线，不以盘中价格代替收盘价。 */
function bars(closes) {
  return closes.map((close, i) => ({ timestamp: start + i * duration, open: close, high: close, low: close, close, volume: 1 }))
}
const calculate = (closes, options = {}) => calculateEfficiencyRatio(bars(closes), '15m', {
  period: closes.length - 1, now: start + (closes.length + 0.5) * duration, ...options
})

test('同向上涨和下跌的 ER 都为 1，方向及涨跌幅独立给出', () => {
  const up = calculate([100, 102, 104, 106, 108, 110])
  const down = calculate([110, 108, 106, 104, 102, 100])
  assert.equal(up.status, 'ready')
  assert.equal(up.er, 1)
  assert.equal(down.er, 1)
  assert.equal(up.direction, 'up')
  assert.equal(down.direction, 'down')
  assert.equal(up.netChangePercent, 10)
  assert.equal(down.netChangePercent, -10 / 110 * 100)
})

test('起终点相同，来回折返的累计变化更大，因此 ER 更低', () => {
  const smooth = calculate([100, 102, 104, 106, 108, 110])
  const choppy = calculate([100, 108, 102, 110, 104, 110])
  assert.equal(smooth.netChange, choppy.netChange)
  assert.equal(choppy.pathLength, 34)
  assert.equal(choppy.er, 10 / 34)
  assert.ok(choppy.er < smooth.er)
  const scaled = calculate([100, 108, 102, 110, 104, 110].map(value => value * 0.000001))
  assert.ok(Math.abs(scaled.er - choppy.er) < 1e-12)
})

test('折返原点和完全不动均为有效 ER=0，区别于数据不足', () => {
  const choppy = calculate([100, 105, 95, 110, 100])
  const flat = calculate([100, 100, 100, 100, 100])
  for (const value of [choppy, flat]) {
    assert.equal(value.status, 'ready')
    assert.equal(value.er, 0)
    assert.equal(value.direction, 'flat')
  }
  assert.equal(flat.pathLength, 0)
  const missing = calculate([100, 101], { period: 20 })
  assert.equal(missing.status, 'insufficient_data')
  assert.equal(missing.er, null)
  assert.equal(missing.direction, null)
})

test('ER20 需要 21 个已收盘价，不能拿第 21 根盘中 K 线凑数', () => {
  const klines = bars(Array.from({ length: 21 }, (_, i) => 100 + i))
  const before = calculateEfficiencyRatio(klines, '15m', { now: start + 20.9 * duration })
  assert.equal(before.status, 'insufficient_data')
  assert.equal(before.availableClosedCandles, 20)
  assert.equal(before.requiredClosedCandles, 21)
  const atClose = calculateEfficiencyRatio(klines, '15m', { now: start + 21 * duration })
  assert.equal(atClose.status, 'ready')
  assert.equal(atClose.er, 1)
  assert.equal(atClose.closedAt, start + 21 * duration)
  assert.equal(atClose.closedAt - (atClose.firstCandleTimestamp + duration), 20 * duration)
})

test('未收盘和未来 K 线不能影响 ER；输入不被排序或修改', () => {
  const klines = bars([100, 104, 102, 106, 105, 110])
  const options = { period: 5, now: start + 6.5 * duration }
  const expected = calculateEfficiencyRatio(klines, '15m', options)
  klines.push({ ...klines.at(-1), timestamp: start + 6 * duration, close: 500 })
  klines.push({ ...klines.at(-1), timestamp: start + 7 * duration, close: 1 })
  klines.reverse()
  const original = structuredClone(klines)
  assert.deepEqual(calculateEfficiencyRatio(klines, '15m', options), expected)
  assert.deepEqual(klines, original)
  klines.find(c => c.timestamp === start + 6 * duration).close = NaN
  assert.deepEqual(calculateEfficiencyRatio(klines, '15m', options), expected)
})

test('跨收盘边界立即更新窗口，同一快照时刻始终返回相同 ER', () => {
  const klines = bars([100, 101, 102, 99])
  const beforeOptions = { period: 2, now: start + 3.9 * duration }
  const before = calculateEfficiencyRatio(klines, '15m', beforeOptions)
  const after = calculateEfficiencyRatio(klines, '15m', { period: 2, now: start + 4 * duration })
  assert.equal(before.er, 1)
  assert.equal(after.er, 0.5)
  assert.equal(after.direction, 'down')
  assert.equal(after.lastCandleTimestamp - before.lastCandleTimestamp, duration)
  assert.deepEqual(calculateEfficiencyRatio(klines, '15m', beforeOptions), before)
})

test('最近应收盘 K 线缺失时标记过期，不能复用旧 ER', () => {
  const stale = calculate([100, 101, 102], { now: start + 4 * duration })
  assert.equal(stale.status, 'stale_data')
  assert.equal(stale.er, null)
  assert.match(stale.reason, /最近应收盘/)
})

test('窗口断档、重复时间及非法价格不产生可用 ER', () => {
  const good = bars([100, 101, 102, 103, 104, 105])
  const options = { period: 4, now: start + 6.5 * duration }
  const gap = good.filter((_, i) => i !== 3)
  const duplicate = [...good, { ...good.at(-2) }]
  for (const klines of [gap, duplicate]) {
    const result = calculateEfficiencyRatio(klines, '15m', options)
    assert.equal(result.status, 'invalid_data')
    assert.equal(result.er, null)
  }
  for (const close of [NaN, Infinity, 0, -1]) {
    const invalid = good.map((c, i) => i === 3 ? { ...c, close } : c)
    assert.equal(calculateEfficiencyRatio(invalid, '15m', options).status, 'invalid_data')
  }
  assert.equal(calculateEfficiencyRatio([{ ...good[0], timestamp: NaN }], '15m', options).status, 'invalid_data')
})

test('窗口参数有统一边界，策略所选周期去重排序，空配置回退主周期', () => {
  for (const invalid of [undefined, null, NaN, Infinity, 'invalid']) assert.equal(normalizeERPeriod(invalid), 20)
  assert.equal(normalizeERPeriod(-10), 2)
  assert.equal(normalizeERPeriod(200), 100)
  assert.equal(normalizeERPeriod(30.9), 30)
  assert.deepEqual(normalizeERTimeframes(['1h', '15m', '1h', 'invalid'], '5m'), ['15m', '1h'])
  assert.deepEqual(normalizeERTimeframes([], '5m'), ['5m'])
})
