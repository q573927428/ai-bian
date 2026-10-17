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

test('K线估算根据请求limit计权，429仍暂停账户', () => {
  const limiter = new BinanceRateLimiter()
  limiter.recordLocalWeight('marketData', 'klines:BTCUSDT:5m:0:0:1000')
  limiter.recordLocalWeight('marketData', 'klines:BTCUSDT:5m:0:0:3')
  assert.equal(limiter.getSnapshot().localEstimatedWeight1m, 6)
  limiter.reportError({ status: 429 })
  assert.equal(limiter.shouldPauseGroup('account'), true)
})
