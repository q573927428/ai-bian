// ==================== Binance 权重暂停与恢复回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// 隔离日志副作用，直接测试真实限流器源码，不向交易所发请求。
const source = readFileSync(new URL('../server/utils/binance-rate-limiter.ts', import.meta.url), 'utf8')
  .replace("import { logger } from './logger'", 'const logger = { warn() {}, error() {} }')
  .replace("import { detectBinanceRateLimitHttpStatus } from './binance-http-status'", 'const detectBinanceRateLimitHttpStatus = error => error.status')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { BinanceRateLimiter } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('缺失响应头不会清空已观测权重及订单数', () => {
  const limiter = new BinanceRateLimiter()
  limiter.updateFromHeaders(new Headers({ 'x-mbx-used-weight-1m': '1684', 'x-mbx-order-count-1m': '12' }))
  limiter.updateFromHeaders(new Headers())
  assert.equal(limiter.getSnapshot().usedWeight1m, 1684)
  assert.equal(limiter.getSnapshot().orderCount1m, 12)
})

test('订单计数按各自固定窗口失效，缺失响应头不续期，新统计可恢复', () => {
  const originalNow = Date.now
  let now = 125000
  Date.now = () => now
  try {
    const limiter = new BinanceRateLimiter()
    assert.equal(limiter.getSnapshot().orderCount10s, undefined)
    assert.equal(limiter.getSnapshot().orderCount1m, undefined)
    limiter.updateFromHeaders(new Headers({ 'x-mbx-order-count-10s': '2', 'x-mbx-order-count-1m': '2' }))
    now = 129999
    assert.equal(limiter.getSnapshot().orderCount10s, 2)
    now = 130000
    limiter.updateFromHeaders(new Headers({ 'x-mbx-used-weight-1m': '32' }))
    assert.equal(limiter.getSnapshot().orderCount10s, undefined)
    assert.equal(limiter.getSnapshot().orderCount1m, 2)
    now = 179999
    assert.equal(limiter.getSnapshot().orderCount1m, 2)
    now = 180000
    assert.equal(limiter.getSnapshot().orderCount1m, undefined)
    now += 3600000
    assert.equal(limiter.getSnapshot().orderCount10s, undefined)
    assert.equal(limiter.getSnapshot().orderCount1m, undefined)
    // 两个响应头可独立返回，刷新其中一个不能使另一个旧窗口的计数复活。
    limiter.updateFromHeaders(new Headers({ 'x-mbx-order-count-10s': '0' }))
    assert.equal(limiter.getSnapshot().orderCount10s, 0)
    assert.equal(limiter.getSnapshot().orderCount1m, undefined)
    limiter.updateFromHeaders(new Headers({ 'x-mbx-order-count-1m': '1' }))
    assert.equal(limiter.getSnapshot().orderCount1m, 1)
  } finally {
    Date.now = originalNow
  }
})

test('后台达到阈值暂停时账户仍有预留额度，跨分钟恢复', () => {
  const originalNow = Date.now
  let now = 120001
  Date.now = () => now
  try {
    const limiter = new BinanceRateLimiter()
    limiter.updateConfig({ maxUsedWeight1mRatio: 0.7 })
    limiter.updateFromHeaders(new Headers({ 'x-mbx-used-weight-1m': '1684' }))
    assert.equal(limiter.shouldPauseBackgroundWork(), true)
    assert.equal(limiter.shouldPauseGroup('account'), false)
    now = 180001
    assert.equal(limiter.shouldPauseBackgroundWork(), false)
    assert.equal(limiter.getSnapshot().usedWeight1m, 0)
  } finally {
    Date.now = originalNow
  }
})

test('本地权重在整分钟边界归零并重新累计，旧窗口不会继续暂停后台', () => {
  const originalNow = Date.now
  let now = 179998
  Date.now = () => now
  try {
    const limiter = new BinanceRateLimiter()
    // 上一分钟临近结束时达到默认暂停阈值，跨分钟后应立即恢复额度。
    for (let i = 0; i < 90; i++) limiter.recordLocalWeight('marketData', 'depth:BTCUSDT:1000')
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 1800)
    assert.equal(limiter.shouldPauseBackgroundWork(), true)
    now = 179999
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 1800)
    now = 180000
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 0)
    assert.equal(limiter.shouldPauseBackgroundWork(), false)
    limiter.recordLocalWeight('marketData', 'depth:BTCUSDT:1000')
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 20)
    now = 239999
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 20)
    // 空闲跨过多个窗口后，新请求也只能累计当前窗口的权重。
    now = 360000
    limiter.recordLocalWeight('marketData', 'klines:BTCUSDT:5m:0:0:3')
    assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 1)
  } finally {
    Date.now = originalNow
  }
})

test('K线估算根据请求limit计权，429仍暂停账户', () => {
  const limiter = new BinanceRateLimiter()
  limiter.recordLocalWeight('marketData', 'klines:BTCUSDT:5m:0:0:1000')
  limiter.recordLocalWeight('marketData', 'klines:BTCUSDT:5m:0:0:3')
  assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 6)
  limiter.reportError({ status: 429 })
  assert.equal(limiter.shouldPauseGroup('account'), true)
})

test('盘口快照按档数估算权重，避免重建请求低估用量', () => {
  const limiter = new BinanceRateLimiter()
  for (const limit of [50, 100, 500, 1000]) limiter.recordLocalWeight('marketData', `depth:BTCUSDT:${limit}`)
  assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 37)
})
