// ==================== 市场广度计算、共享缓存与 AI 输入测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { summarizeBreadth, calculateLiveBreadth } from '../app/utils/market-breadth.ts'

/** 隔离行情和数据库依赖，验证业务计算而不访问真实数据库或网络。 */
function fixture() {
  const now = 1800000000000
  let time = now
  let reads = 0
  const prices = { BTCUSDT: { price: 110, timestamp: now, change24hPercent: 5 } }
  const bars = new Map()
  for (const hours of [1, 4, 24]) bars.set(`BTCUSDT:${now / 1000 - hours * 3600}`, 100)
  const context = {
    exports: {}, Date: class extends Date { static now() { return time } },
    require(id) {
      if (id === '../../app/utils/market-breadth') return { summarizeBreadth }
      if (id === './market-price-hub') return { marketPriceHub: { getSnapshot: () => prices } }
      if (id === './kline-simple-storage') return {
        initKLineDb: async () => {},
        getSimpleKLineData(symbol, timeframe, options) {
          reads++
          assert.equal(timeframe, '5m')
          if (options.from === undefined) return symbol === 'BTCUSDT' ? [{ t: now / 1000, c: 110 }] : []
          assert.equal(options.from, options.to)
          const open = bars.get(`${symbol}:${options.from}`)
          return open === undefined ? [] : [{ t: options.from, o: open }]
        }
      }
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  vm.createContext(context)
  const source = fs.readFileSync(new URL('../server/utils/market-breadth.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { api: context.exports, prices, bars, now, reads: () => reads, advance: ms => { time += ms } }
}

test('占比分母含持平、排除缺失，中位数覆盖奇数、偶数及空样本', () => {
  const { api } = fixture()
  const result = api.summarizeBreadth({ a: 2, b: 1, c: -1, d: 0, e: null }, null)
  assert.equal(result.validCount, 4)
  assert.equal(result.upRatioPct, 50)
  assert.equal(result.medianChangePct, 0.5)
  assert.equal(result.flatCount, 1)
  assert.equal(result.missingCount, 1)
  assert.equal(api.summarizeBreadth({ a: -4, b: -2, c: 8 }, null).medianChangePct, -2)
  assert.equal(api.summarizeBreadth({ a: null }, null).upRatioPct, null)
  assert.equal(api.summarizeBreadth({}, null).medianChangePct, null)
})

test('仅统计已选去重交易对，三周期复用缓存和并发任务，强制刷新及配置变更可生效', async () => {
  const f = fixture()
  const config = { symbols: ['BTC/USDT', 'BTCUSDT', 'ETHUSDT'] }
  const [first, second] = await Promise.all([f.api.getMarketBreadth(config), f.api.getMarketBreadth(config)])
  assert.equal(first, second)
  assert.equal(first.selectedCount, 2)
  assert.equal(first.periods['1h'].upCount, 1)
  assert.equal(first.periods['4h'].referenceTime, f.now - 14400000)
  assert.equal(first.periods['24h'].medianChangePct, 5)
  assert.equal(first.periods['1h'].missingCount, 1)
  const reads = f.reads()
  assert.equal(await f.api.getMarketBreadth(config), first)
  assert.equal(f.reads(), reads)
  assert.notEqual(await f.api.getMarketBreadth(config, true), first)
  const changed = await f.api.getMarketBreadth({ symbols: ['ETHUSDT'] })
  assert.equal(changed.selectedCount, 1)
  assert.equal(changed.periods['1h'].validCount, 0)
})

test('没有 ticker 时仍能从本地 K 线计算；过期本地行情或缺失参考线不计入统计', async () => {
  const f = fixture()
  delete f.prices.BTCUSDT
  const config = { symbols: ['BTCUSDT'] }
  const snapshot = await f.api.getMarketBreadth(config)
  assert.ok(Math.abs(snapshot.periods['24h'].medianChangePct - 10) < 1e-10)
  f.bars.delete(`BTCUSDT:${f.now / 1000 - 3600}`)
  assert.equal((await f.api.getMarketBreadth(config, true)).periods['1h'].validCount, 0)
  f.advance(601000)
  const expired = await f.api.getMarketBreadth(config)
  assert.equal(expired.periods['24h'].validCount, 0)
})

test('提示词包含范围、统计时间及三周期聚合值，不传入逐币种数据', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT'] })
  const prompt = f.api.formatMarketBreadth(snapshot)
  assert.ok(prompt.includes('已筛选1个币安') && prompt.includes('更新时间：') && prompt.includes('4h'))
  assert.ok(prompt.includes('1h：涨1，跌0，平0；上涨占比100.00%，涨跌幅中位数+10.00%；有效1，缺失0。'))
  assert.ok(prompt.includes('24h：涨1，跌0，平0；上涨占比100.00%，涨跌幅中位数+5.00%'))
  assert.ok(!prompt.includes('changes') && !prompt.includes('BTCUSDT'))
  assert.ok(!prompt.includes('bases'))
  f.advance(300001)
  assert.ok(f.api.formatMarketBreadth(snapshot).includes('（数据已过期）'))
  const empty = await f.api.getMarketBreadth({ symbols: ['ETHUSDT'] })
  assert.ok(f.api.formatMarketBreadth(empty).includes('上涨占比暂无数据，涨跌幅中位数暂无数据'))
  empty.periods['1h'].medianChangePct = -1.234
  assert.ok(f.api.formatMarketBreadth(empty).includes('涨跌幅中位数-1.23%'))
})

test('提示词仅补充当前交易对三周期涨跌幅，兼容交易对格式及缺失数据', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT', 'ETHUSDT'] })
  snapshot.periods['4h'].changes.BTCUSDT = -1.234
  snapshot.periods['24h'].changes.BTCUSDT = null
  const prompt = f.api.formatMarketBreadth(snapshot, ' btc/usdt ')
  assert.ok(prompt.includes('当前交易对 BTCUSDT：1h涨跌幅+10.00%；4h涨跌幅-1.23%；24h涨跌幅暂无数据。'))
  assert.ok(!prompt.includes('ETHUSDT'))
  assert.ok(!f.api.formatMarketBreadth(snapshot).includes('当前交易对'))
  assert.ok(f.api.formatMarketBreadth(snapshot, 'UNKNOWN').includes('1h涨跌幅暂无数据'))
})

test('实时价格变化立即更新涨跌数量和中位数，不改变 AI 固定快照且不读取数据库', async () => {
  const f = fixture()
  f.prices.ETHUSDT = { price: 90, timestamp: f.now, change24hPercent: -2 }
  for (const hours of [1, 4]) f.bars.set(`ETHUSDT:${f.now / 1000 - hours * 3600}`, 100)
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT', 'ETHUSDT'] })
  const saved = JSON.stringify(snapshot)
  const reads = f.reads()
  for (const period of ['1h', '4h', '24h']) {
    const stats = snapshot.periods[period]
    const before = calculateLiveBreadth(snapshot.symbols, f.prices, period, stats.bases, stats.referenceTime, f.now)
    assert.equal(before.upCount, 1)
    assert.equal(before.downCount, 1)
  }
  f.prices.ETHUSDT.price = 120
  f.prices.ETHUSDT.change24hPercent = 8
  for (const period of ['1h', '4h', '24h']) {
    const stats = snapshot.periods[period]
    const after = calculateLiveBreadth(snapshot.symbols, f.prices, period, stats.bases, stats.referenceTime, f.now)
    assert.equal(after.upCount, 2)
    assert.equal(after.downCount, 0)
    assert.equal(after.upRatioPct, 100)
    assert.ok(Math.abs(after.medianChangePct - (period === '24h' ? 6.5 : 15)) < 1e-10)
  }
  assert.equal(JSON.stringify(snapshot), saved)
  assert.equal(f.reads(), reads)
})

test('24h 实时统计不依赖参考价；缺失基准和过期行情显示待更新', () => {
  const now = 1800000000000
  const prices = { BTCUSDT: { price: 100, change24hPercent: 2, timestamp: now } }
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '24h', {}, null, now).upCount, 1)
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '1h', {}, null, now).missingCount, 1)
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '24h', {}, null, now + 120001).missingCount, 1)
})
