// ==================== 估算成交分布金额守恒与缺失语义回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateVolumeProfile } from '../app/utils/volume-profile.ts'

/** 简化K线样本，默认主动买入占优。 */
const bar = (l, h, q = 100, bq = 70) => ({ t: 1, o: l, h, l, c: h, v: 1, q, bq })
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`)

test('跨桶按价格重叠分配，成交额和主动差额均守恒', () => {
  const result = calculateVolumeProfile([bar(10, 20), bar(12, 16, 60, 10)], 7)
  close(result.bins.reduce((sum, bin) => sum + bin.amount, 0), 160)
  close(result.bins.reduce((sum, bin) => sum + bin.delta, 0), 0)
  assert.equal(result.validBars, 2)
})

test('买卖都很大但净额为零，仍识别为最大成交密集区', () => {
  const result = calculateVolumeProfile([bar(10, 11, 1000, 500), bar(19, 20, 10, 10)], 10)
  assert.equal(result.peakIndex, 0)
  assert.equal(result.bins[0].amount, 1000)
  assert.equal(result.bins[0].delta, 0)
  assert.deepEqual(result.zone, { lower: 10, upper: 11 })
})

test('缺少主动额只丢失方向，缺少总额不伪造分布，覆盖率如实报告', () => {
  for (const missing of [undefined, NaN, -1, 101]) {
    const sample = bar(10, 20)
    sample.bq = missing
    const result = calculateVolumeProfile([sample, bar(10, 20), { ...bar(10, 20), q: undefined }], 2)
    assert.equal(result.validBars, 2)
    assert.equal(result.totalBars, 3)
    assert.ok(result.bins.every(bin => bin.delta === null))
    close(result.bins.reduce((sum, bin) => sum + bin.amount, 0), 200)
  }
})

test('同价K线与最高价边界的成交额不能丢失或重复分配', () => {
  const flat = calculateVolumeProfile([bar(10, 10)])
  assert.equal(flat.bins.length, 1)
  assert.equal(flat.bins[0].amount, 100)
  assert.deepEqual(flat.zone, { lower: 10, upper: 10 })
  const edge = calculateVolumeProfile([bar(10, 20), bar(20, 20, 50, 0)], 2)
  close(edge.bins[0].amount, 50)
  close(edge.bins[1].amount, 100)
  close(edge.bins[1].delta, -30)
})

test('空数据、非法价量和无成交不制造密集区', () => {
  for (const samples of [[], [bar(20, 10)], [bar(0, 10)], [bar(10, Infinity)], [bar(10, 20, -1)], [bar(10, 20, 0, 0)]]) {
    assert.equal(calculateVolumeProfile(samples).zone, null)
    assert.equal(calculateVolumeProfile(samples).peakIndex, -1)
  }
})

test('主密集带只连同一峰周围高密度价位，不跨越低成交间隙', () => {
  const result = calculateVolumeProfile([bar(10, 11, 100), bar(11, 12, 70), bar(12, 13, 5), bar(13, 14, 80)], 4)
  assert.deepEqual(result.zone, { lower: 10, upper: 12 })
})
