// ==================== 市场广度计算、共享缓存与 AI 输入测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { summarizeBreadth, calculateLiveBreadth } from '../app/utils/market-breadth.ts'
import { relativeStrengthRanking } from '../app/utils/environment-confidence.ts'

/** 隔离行情和数据库依赖，验证业务计算而不访问真实数据库或网络。 */
function fixture() {
  const now = 1800000000000
  let time = now
  let reads = 0
  const prices = { BTCUSDT: { price: 110, timestamp: now, change24hPercent: 5 } }
  const bars = new Map()
  const atrReads = []
  const atrValues = new Map()
  const stalePeriods = new Set()
  const hub = {
    getKlines(symbol, timeframe) {
      const seconds = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[timeframe]
      return [{ timestamp: Math.floor(time / 1000 / seconds) * seconds * 1000 - (stalePeriods.has(timeframe) ? seconds * 1000 : 0) }]
    },
    async getIndicators(symbol, timeframe, type, options, snapshotKlines) {
      atrReads.push({ symbol, timeframe, type, options })
      assert.equal(type, 'ATR')
      assert.equal(options.atrPeriod, 14)
      assert.ok(Array.isArray(snapshotKlines) && snapshotKlines.length > 0)
      if (symbol !== 'BTCUSDT') throw new Error('ATR不可用')
      return { values: { atr: atrValues.has(timeframe) ? atrValues.get(timeframe) : 2 } }
    }
  }
  for (const hours of [1, 4, 24]) bars.set(`BTCUSDT:${now / 1000 - hours * 3600}`, 100)
  const context = {
    exports: {}, Date: class extends Date { static now() { return time } },
    require(id) {
      if (id === '../../app/utils/market-breadth') return { summarizeBreadth }
      if (id === '../../app/utils/environment-confidence') return { relativeStrengthRanking }
      if (id === './market-price-hub') return { marketPriceHub: { getSnapshot: () => prices } }
      if (id === './kline-simple-storage') return {
        initKLineDb: async () => {},
        getSimpleKLineData(symbol, timeframe, options) {
          reads++
          // 市场广度只允许读取单根原始价格基准，不能再为ATR额外读取历史序列。
          assert.equal(options.limit, 1)
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
  const rawGetMarketBreadth = context.exports.getMarketBreadth
  const api = { ...context.exports, getMarketBreadth: (config, force = false) => rawGetMarketBreadth(config, force, hub) }
  return { api, rawGetMarketBreadth, hub, prices, bars, atrReads, atrValues, stalePeriods, now, reads: () => reads, advance: ms => { time += ms } }
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

test('仅统计已选去重交易对，五周期复用缓存和并发任务，强制刷新及配置变更可生效', async () => {
  const f = fixture()
  const config = { symbols: ['BTC/USDT', 'BTCUSDT', 'ETHUSDT'] }
  const [first, second] = await Promise.all([f.api.getMarketBreadth(config), f.api.getMarketBreadth(config)])
  assert.equal(first, second)
  assert.equal(first.selectedCount, 2)
  assert.equal(first.periods['1h'].upCount, 1)
  assert.equal(first.periods['4h'].referenceTime, f.now - 14400000)
  assert.ok(Math.abs(first.periods['24h'].medianChangePct - 10) < 1e-10)
  assert.equal(first.periods['24h'].referenceTime, f.now - 86400000)
  assert.equal(first.periods['24h'].bases.BTCUSDT, 100)
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

test('24h缺少本地基准不能退回ticker；基准按5m对齐并随快照滚动', async () => {
  const f = fixture()
  const config = { symbols: ['BTCUSDT'] }
  f.bars.delete(`BTCUSDT:${f.now / 1000 - 86400}`)
  assert.equal((await f.api.getMarketBreadth(config)).periods['24h'].changes.BTCUSDT, null)
  f.advance(300001)
  f.prices.BTCUSDT.timestamp = f.now + 300001
  f.bars.set(`BTCUSDT:${f.now / 1000 + 300 - 86400}`, 125)
  const stats = (await f.api.getMarketBreadth(config)).periods['24h']
  assert.equal(stats.referenceTime, f.now + 300000 - 86400000)
  assert.equal(stats.bases.BTCUSDT, 125)
  assert.ok(Math.abs(stats.changes.BTCUSDT + 12) < 1e-10)
})

test('提示词包含范围、统计时间及五周期聚合值，不传入逐币种数据', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT'] })
  const prompt = f.api.formatMarketBreadth(snapshot)
  assert.ok(prompt.includes('已筛选1个币安') && prompt.includes('更新时间：') && prompt.includes('4h'))
  assert.ok(prompt.includes('1h：涨1，跌0，平0；上涨占比100.00%，涨跌幅中位数+10.00%；有效1，缺失0。'))
  assert.ok(prompt.includes('24h：涨1，跌0，平0；上涨占比100.00%，涨跌幅中位数+10.00%'))
  assert.ok(!prompt.includes('changes') && !prompt.includes('BTCUSDT'))
  assert.ok(!prompt.includes('bases'))
  f.advance(300001)
  assert.ok(f.api.formatMarketBreadth(snapshot).includes('（数据已过期）'))
  const empty = await f.api.getMarketBreadth({ symbols: ['ETHUSDT'] })
  assert.ok(f.api.formatMarketBreadth(empty).includes('上涨占比暂无数据，涨跌幅中位数暂无数据'))
  empty.periods['1h'].medianChangePct = -1.234
  assert.ok(f.api.formatMarketBreadth(empty).includes('涨跌幅中位数-1.23%'))
})

test('提示词仅补充当前交易对五周期涨跌幅，兼容交易对格式及缺失数据', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT', 'ETHUSDT'] })
  snapshot.periods['4h'].changes.BTCUSDT = -1.234
  snapshot.periods['24h'].changes.BTCUSDT = null
  const prompt = f.api.formatMarketBreadth(snapshot, ' btc/usdt ')
  assert.ok(prompt.includes('当前交易对 BTCUSDT：5m涨跌幅暂无数据；15m涨跌幅暂无数据；1h涨跌幅+10.00%；4h涨跌幅-1.23%；24h涨跌幅暂无数据。'))
  assert.ok(!prompt.includes('ETHUSDT'))
  assert.ok(!f.api.formatMarketBreadth(snapshot).includes('当前交易对'))
  assert.ok(f.api.formatMarketBreadth(snapshot, 'UNKNOWN').includes('1h涨跌幅暂无数据'))
})

test('实时价格变化立即更新涨跌数量和中位数，不改变 AI 固定快照且不读取数据库', async () => {
  const f = fixture()
  f.prices.ETHUSDT = { price: 90, timestamp: f.now, change24hPercent: -2 }
  for (const hours of [1, 4, 24]) f.bars.set(`ETHUSDT:${f.now / 1000 - hours * 3600}`, 100)
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
    assert.ok(Math.abs(after.medianChangePct - 15) < 1e-10)
  }
  assert.equal(JSON.stringify(snapshot), saved)
  assert.equal(f.reads(), reads)
})

test('24h实时统计统一使用本地基准；忽略ticker涨跌幅，缺失与过期保留未知', () => {
  const now = 1800000000000
  const prices = { BTCUSDT: { price: 100, change24hPercent: 2, timestamp: now } }
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '24h', {}, null, now).missingCount, 1)
  const stats = calculateLiveBreadth(['BTCUSDT'], prices, '24h', { BTCUSDT: 125 }, now - 86400000, now)
  assert.equal(stats.downCount, 1)
  assert.ok(Math.abs(stats.changes.BTCUSDT + 20) < 1e-10)
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '1h', {}, null, now).missingCount, 1)
  assert.equal(calculateLiveBreadth(['BTCUSDT'], prices, '24h', {}, null, now + 120001).missingCount, 1)
})

test('复用指标中心ATR并保存归一化依据，24h映射日线，缺失ATR不影响广度', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT', 'ETHUSDT'] })
  for (const [period, timeframe] of [['1h', '1h'], ['4h', '4h'], ['24h', '1d']]) {
    const stats = snapshot.periods[period]
    assert.ok(f.atrReads.some(read => read.symbol === 'BTCUSDT' && read.timeframe === timeframe && read.type === 'ATR'))
    if (stats.changes.BTCUSDT !== null) {
      assert.equal(stats.atrs.BTCUSDT, 2)
      assert.equal(stats.atrPercents.BTCUSDT, 2 / 110 * 100)
      assert.equal(stats.normalizedChanges.BTCUSDT, stats.changes.BTCUSDT / stats.atrPercents.BTCUSDT)
    }
    assert.equal(stats.normalizedChanges.ETHUSDT, null)
  }
  f.prices.ETHUSDT = { price: 120, timestamp: f.now }
  f.bars.set(`ETHUSDT:${f.now / 1000 - 3600}`, 100)
  const stats = (await f.api.getMarketBreadth({ symbols: ['ETHUSDT'] }, true)).periods['1h']
  assert.equal(stats.upCount, 1)
  assert.equal(stats.normalizedChanges.ETHUSDT, null)
})

test('广度缓存命中不再请求ATR，刷新使用中心更新值且异常ATR不能兜底', async () => {
  const f = fixture()
  const config = { symbols: ['BTCUSDT'] }
  const first = await f.api.getMarketBreadth(config)
  const calls = f.atrReads.length
  assert.equal(await f.api.getMarketBreadth(config), first)
  assert.equal(f.atrReads.length, calls)
  f.atrValues.set('1h', 4)
  const updated = await f.api.getMarketBreadth(config, true)
  assert.equal(updated.periods['1h'].atrs.BTCUSDT, 4)
  assert.equal(updated.periods['1h'].normalizedChanges.BTCUSDT, first.periods['1h'].normalizedChanges.BTCUSDT / 2)
  for (const invalid of [0, -1, NaN, Infinity, undefined]) {
    f.atrValues.set('1h', invalid)
    const stats = (await f.api.getMarketBreadth(config, true)).periods['1h']
    assert.equal(stats.normalizedChanges.BTCUSDT, null)
    assert.equal(stats.upCount, 1)
  }
})

test('要求中心包含当前未收盘K线，无中心的快照不能阻止初始化后重新读取ATR', async () => {
  const f = fixture()
  const config = { symbols: ['BTCUSDT'] }
  const unavailable = await f.rawGetMarketBreadth(config)
  assert.equal(unavailable.periods['1h'].normalizedChanges.BTCUSDT, null)
  const ready = await f.api.getMarketBreadth(config)
  assert.notEqual(ready, unavailable)
  assert.equal(ready.periods['1h'].atrs.BTCUSDT, 2)
  f.stalePeriods.add('1h')
  const stale = await f.api.getMarketBreadth(config, true)
  assert.equal(stale.periods['1h'].normalizedChanges.BTCUSDT, null)
  assert.equal(stale.periods['1h'].upCount, 1)
  assert.equal(stale.periods['4h'].atrs.BTCUSDT, 2)
})

test('提示词仅简要展示主周期名次和样本数，同值并列且缺失不兜底', async () => {
  const f = fixture()
  const snapshot = await f.api.getMarketBreadth({ symbols: ['BTCUSDT'] })
  for (const period of ['5m', '15m', '24h']) {
    Object.assign(snapshot.periods[period], {
      changes: { BTCUSDT: 1, A: 2, B: 3, C: 4, D: null },
      normalizedChanges: { BTCUSDT: 3, A: 4, B: 3, C: null, D: 5 }
    })
  }
  const prompt = f.api.formatMarketBreadth(snapshot, 'btc/usdt', '5m')
  assert.ok(prompt.includes('当前主周期 5m 相对强弱排名：并列第2名 / 3个。'))
  assert.ok(!prompt.includes('做多排名分') && !prompt.includes('做空排名分') && !prompt.includes('按ATR归一化表现从高到低'))
  assert.ok(!prompt.includes('normalizedChanges') && !prompt.includes('ATR百分比'))
  snapshot.periods['15m'].normalizedChanges.BTCUSDT = 5
  assert.ok(f.api.formatMarketBreadth(snapshot, 'BTCUSDT', '15m').includes('第1名 / 3个。'))
  assert.ok(f.api.formatMarketBreadth(snapshot, 'BTCUSDT', '1d').includes('当前主周期 1d 相对强弱排名：并列第2名 / 3个。'))
  delete snapshot.periods['5m'].normalizedChanges
  assert.ok(f.api.formatMarketBreadth(snapshot, 'BTCUSDT', '5m').includes('暂无可用排名'))
  assert.ok(!f.api.formatMarketBreadth(snapshot).includes('相对强弱排名'))
  f.advance(300001)
  assert.ok(f.api.formatMarketBreadth(snapshot, 'BTCUSDT', '15m').includes('暂无可用排名'))
})
