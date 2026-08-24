// ==================== OI 内存时间序列测试 ====================

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findOIInSeriesAtOrBefore,
  normalizeOISeries,
  upsertOISeriesPoint
} from '../server/utils/oi-series.ts'

test('历史 OI 按 5m 时间桶去重并升序整理', () => {
  const points = normalizeOISeries([
    { timestamp: 600_000, openInterest: 102 },
    { timestamp: 300_000, openInterest: 100 },
    { timestamp: 300_000, openInterest: 101 }
  ])

  assert.deepEqual(points, [
    { timestamp: 300_000, openInterest: 101 },
    { timestamp: 600_000, openInterest: 102 }
  ])
})

test('当前 OI 会覆盖同一 5m 桶并追加新桶', () => {
  const points = [{ timestamp: 300_000, openInterest: 100 }]
  upsertOISeriesPoint(points, { timestamp: 300_000, openInterest: 105 })
  upsertOISeriesPoint(points, { timestamp: 600_000, openInterest: 110 })

  assert.deepEqual(points, [
    { timestamp: 300_000, openInterest: 105 },
    { timestamp: 600_000, openInterest: 110 }
  ])
})

test('多周期计算可以二分复用不晚于目标时间的最近 5m 基准', () => {
  const points = [0, 1, 2].map(index => ({
    timestamp: 300_000 + index * 300_000,
    openInterest: 100 + index
  }))

  assert.equal(findOIInSeriesAtOrBefore(points, 899_999)?.openInterest, 101)
  assert.equal(findOIInSeriesAtOrBefore(points, 299_999), undefined)
})
