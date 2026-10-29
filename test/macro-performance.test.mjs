// ==================== 宏观相对 BTC 强弱与区间回撤测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { maxCloseDrawdown, relativeToBtc } from '../app/utils/macro-performance.ts'

test('最大回撤按峰值到后续谷值计算，包含上涨后回落而非只看首尾', () => {
  assert.equal(maxCloseDrawdown([100, 200, 120, 180]), 40)
  assert.equal(maxCloseDrawdown([100, 90, 80]), 20)
  assert.equal(maxCloseDrawdown([100, 110, 120]), 0)
  assert.equal(maxCloseDrawdown([100]), 0)
})

test('无数据或非正、无效价格不生成回撤结果', () => {
  for (const closes of [[], [100, 0], [100, -1], [100, NaN], [Infinity]]) {
    assert.equal(maxCloseDrawdown(closes), null)
  }
})

test('相对 BTC 使用同起止日期的价格比值涨跌百分比', () => {
  const btc = new Map([[1, 100], [2, 110], [3, 120]])
  assert.ok(Math.abs(relativeToBtc(30, 1, 3, btc) - (1.3 / 1.2 - 1) * 100) < 1e-9)
  assert.ok(Math.abs(relativeToBtc(5, 1, 2, btc) - (1.05 / 1.1 - 1) * 100) < 1e-9)
  assert.ok(Math.abs(relativeToBtc(20, 1, 3, btc)) < 1e-9)
  assert.equal(relativeToBtc(0, 2, 2, btc), 0)
})

test('BTC 缺少精确日期、无效基价或市场无收益数据时不近似比较', () => {
  assert.equal(relativeToBtc(30, 1, 4, new Map([[1, 100], [3, 120]])), null)
  assert.equal(relativeToBtc(30, 1, 2, new Map([[1, 0], [2, 120]])), null)
  assert.equal(relativeToBtc(undefined, 1, 2, new Map([[1, 100], [2, 120]])), null)
})
