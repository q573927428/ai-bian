// ==================== 列表最新 CVD 背离确认与时效回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { latestCvdDivergence, isRecentCvdDivergence } from '../app/utils/cvd-divergence.ts'

/** 两个相隔六根的价格高点，第二高点价格更高、累计主动成交更低。 */
function bearishBars() {
  return Array.from({ length: 14 }, (_, i) => ({
    t: i * 60, o: 100, c: 100, h: i === 3 ? 110 : i === 9 ? 115 : 101,
    l: 99, v: 1, q: 100, bq: i > 3 && i <= 9 ? 10 : 50
  }))
}

test('确认必须等待右侧三根收盘，时间取确认柱收盘而非高点', () => {
  const bars = bearishBars()
  assert.equal(latestCvdDivergence(bars, 60, 779), undefined)
  assert.deepEqual(latestCvdDivergence(bars, 60, 780), { kind: 'bearish', pivotAt: 540, confirmedAt: 780 })
  const bullish = bars.map(bar => ({ ...bar, h: 101, l: 200 - bar.h, bq: 100 - bar.bq }))
  assert.deepEqual(latestCvdDivergence(bullish, 60, 780), { kind: 'bullish', pivotAt: 540, confirmedAt: 780 })
})

test('缺失主动成交或时间断档时不生成跨区间背离', () => {
  const missing = bearishBars()
  delete missing[6].bq
  assert.equal(latestCvdDivergence(missing, 60, 840), undefined)
  const gap = bearishBars().map((bar, i) => ({ ...bar, t: bar.t + (i >= 6 ? 60 : 0) }))
  assert.equal(latestCvdDivergence(gap, 60, 900), undefined)
  assert.equal(latestCvdDivergence([], 60, 840), undefined)
})

test('最近 N 根包含最新确认，排除过期与未来确认；不依赖缓存末根时间', () => {
  const signal = latestCvdDivergence(bearishBars(), 60, 780)
  assert.equal(isRecentCvdDivergence(signal, 60, 839, 1), true)
  assert.equal(isRecentCvdDivergence(signal, 60, 840, 1), false)
  assert.equal(isRecentCvdDivergence(signal, 60, 900, 3), true)
  assert.equal(isRecentCvdDivergence(signal, 60, 960, 3), false)
  assert.equal(isRecentCvdDivergence(signal, 60, 779, 3), false)
  assert.equal(isRecentCvdDivergence(undefined, 60, 840, 3), false)
})
