// ==================== 实时支撑阻力业务边界回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSupportResistance, updateSupportResistancePrice } from '../server/modules/indicators/SupportResistanceCalculator.ts'
import { SupportResistanceCache } from '../server/modules/indicators/SupportResistanceCache.ts'

const period = 900_000
const start = 1_700_000_100_000
/** 持续震荡且支撑阻力各被独立确认多次，末根尚未收盘。 */
function fixture() {
  const closed = Array.from({ length: 40 }, (_, i) => ({
    timestamp: start + i * period, open: 100, close: 100, high: 102, low: 98, volume: 10
  }))
  for (const i of [5, 15, 25]) closed[i].low = 95
  for (const i of [10, 20, 30]) closed[i].high = 105
  return [...closed, { ...closed[0], timestamp: start + 40 * period }]
}
const now = start + 40 * period + period / 2
const calculate = (bars = fixture(), options = {}) => calculateSupportResistance(bars, '15m', period, { now, ...options })

test('独立摆动点合并，距离取区域近端，ATR归一化且不编造价位', () => {
  const r = calculate()
  assert.equal(r.status, 'between_levels')
  assert.deepEqual([r.nearestSupport.lower, r.nearestSupport.upper, r.nearestSupport.touches], [95, 95, 3])
  assert.deepEqual([r.nearestResistance.lower, r.nearestResistance.upper, r.nearestResistance.touches], [105, 105, 3])
  assert.equal(r.supportDistancePercent, 5)
  assert.equal(r.supportDistanceATR, 5 / r.atr)
})

test('实时价格变化即时改变距离，未收盘尖刺不改变已确认区域与ATR', () => {
  const a = calculate()
  const bars = fixture()
  Object.assign(bars.at(-1), { low: 80, high: 120, close: 96 })
  const b = calculate(bars)
  assert.equal(b.referencePrice, 96)
  assert.equal(b.supportDistancePercent, 1 / 96 * 100)
  assert.deepEqual(b.nearestSupport, a.nearestSupport)
  assert.deepEqual(b.nearestResistance, a.nearestResistance)
  assert.equal(b.atr, a.atr)
  assert.equal(calculate(bars, { currentPrice: 97 }).referencePrice, 97)
})

test('附近摆动点形成区域，距离从近端边界计算，孤立触碰不算有效支撑', () => {
  const bars = fixture()
  bars[15].low = 95.2
  bars[25].low = 95.4
  const r = calculate(bars)
  assert.equal(r.nearestSupport.lower, 95)
  assert.equal(r.nearestSupport.upper, 95.4)
  assert.equal(r.nearestSupport.touches, 3)
  assert.equal(r.supportDistancePercent, (100 - 95.4) / 100 * 100)
  bars[15].low = 98
  bars[25].low = 98
  const candidate = calculate(bars).nearestSupport
  assert.equal(candidate.lower, 95)
  assert.equal(candidate.touches, 1)
  // 显式配置仍允许用户坚持两次触碰门槛。
  assert.equal(calculate(bars, { minTouches: 2 }).nearestSupport, null)
})

test('盘中穿越仅标记待确认，不将旧支撑自动转换成有效阻力', () => {
  const r = calculate(undefined, { currentPrice: 94 })
  assert.equal(r.status, 'breakdown_pending')
  assert.equal(r.nearestSupport, null)
  assert.equal(r.brokenSupport, null)
  assert.equal(r.nearestResistance.lower, 105)
  assert.equal(calculate(undefined, { currentPrice: 106 }).status, 'breakout_pending')
})

test('收盘跌破导致区域失效，返回区间也不能自动恢复', () => {
  const bars = fixture()
  Object.assign(bars[39], { low: 93, close: 94 })
  const r = calculate(bars, { currentPrice: 94 })
  assert.equal(r.status, 'breakdown_confirmed')
  assert.equal(r.nearestSupport, null)
  assert.equal(r.brokenSupport.lower, 95)
  bars.push({ ...bars.at(-1), timestamp: start + 41 * period })
  const later = calculate(bars, { now: start + 41 * period + period / 2, currentPrice: 100 })
  assert.equal(later.nearestSupport, null)
  assert.equal(later.brokenSupport, null)
})

test('收盘突破阻力与盘中突破区分，价位接触时距离为零', () => {
  const bars = fixture()
  Object.assign(bars[39], { high: 107, close: 106 })
  const r = calculate(bars, { currentPrice: 106 })
  assert.equal(r.status, 'breakout_confirmed')
  assert.equal(r.brokenResistance.lower, 105)
  assert.equal(r.nearestResistance, null)
  const touch = calculate(undefined, { currentPrice: 95 })
  assert.equal(touch.supportDistanceATR, 0)
  assert.equal(touch.status, 'at_support')
})

test('右侧确认未完成的摆动点与未来K线不得影响历史结构', () => {
  const bars = fixture()
  bars[39].low = 94.9
  // 末端摆动点虽接近既有支撑，右侧确认不足，不能增加触碰次数。
  assert.equal(calculate(bars).nearestSupport.touches, 3)
  const baseline = calculate(bars)
  bars.push({ ...bars[0], timestamp: start + 41 * period, low: 1, high: 200 })
  assert.deepEqual(calculate(bars), baseline)
})

test('数据不足、断档、零波动及非法价格保留缺失状态', () => {
  assert.equal(calculate([]).status, 'insufficient_data')
  const bars = fixture()
  bars.splice(10, 1)
  assert.equal(calculate(bars).status, 'insufficient_data')
  assert.equal(calculate(undefined, { currentPrice: NaN }).status, 'insufficient_data')
  assert.equal(calculate(fixture().map(c => ({ ...c, open: 100, high: 100, low: 100, close: 100 }))).status, 'insufficient_data')
  assert.equal(calculate().resistanceDistancePercent, 5)
})

test('冻结快照可JSON往返且之后的行情计算不会改写旧记录', () => {
  const snapshot = calculate()
  const saved = JSON.parse(JSON.stringify({ entrySupportResistance: snapshot }))
  calculate(undefined, { currentPrice: 94 })
  assert.deepEqual(saved.entrySupportResistance, snapshot)
  assert.equal(saved.entrySupportResistance.referencePrice, 100)
})

test('区域五分钟内跨价格复用，恰好过期重算，预计算强制刷新可提前更新', () => {
  const cache = new SupportResistanceCache()
  let builds = 0
  let clock = now
  const build = () => { builds++; return calculate(undefined, { now: clock }) }
  const first = cache.get('SUI:15m', 100, clock, build)
  const frozen = JSON.stringify(first)
  clock += 15_000
  const next = cache.get('SUI:15m', 94, clock, build)
  assert.equal(builds, 1)
  assert.equal(next.calculatedAt, first.calculatedAt)
  assert.equal(next.priceUpdatedAt, clock)
  assert.equal(next.status, 'breakdown_pending')
  assert.equal(JSON.stringify(first), frozen)
  clock = now + 299_999
  cache.get('SUI:15m', 101, clock, build)
  assert.equal(builds, 1)
  clock = now + 300_000
  cache.get('SUI:15m', 101, clock, build)
  assert.equal(builds, 2)
  cache.get('SUI:15m', 102, clock, build, true)
  assert.equal(builds, 3)
  cache.get('SUI:1h', 102, clock, build)
  assert.equal(builds, 4)
})

test('缓存保留全部有效区域，跨区再回到原位仍能选择最近支撑', () => {
  const regions = calculate(undefined, { currentPrice: 94 })
  assert.equal(regions.nearestSupport, null)
  const restored = updateSupportResistancePrice(regions, 100, now + 1)
  assert.equal(restored.nearestSupport.lower, 95)
  assert.equal(restored.supportDistancePercent, 5)
  assert.equal(restored.status, 'between_levels')
  assert.equal(regions.nearestSupport, null)
})
