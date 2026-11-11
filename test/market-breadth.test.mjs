// ==================== 市场广度计算、共享缓存与 AI 输入测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { summarizeBreadth, calculateLiveBreadth, classifyBreadthAsset, selectBreadthForSymbol, filterBreadthSymbols, BREADTH_CATEGORY_LABELS } from '../app/utils/market-breadth.ts'
import { assessEnvironment, buildEnvironmentContext, relativeStrengthRanking, formatEnvironmentConfidence } from '../app/utils/environment-confidence.ts'

test('分类遵循官方底层资产和传统永续类型，黄金代币无特例，未知不能默认算作加密', () => {
  assert.equal(classifyBreadthAsset({ contractType: 'PERPETUAL', underlyingType: 'COIN' }), 'crypto')
  for (const underlyingType of ['EQUITY', 'COMMODITY', 'FX', 'HK_EQUITY', 'PREMARKET']) {
    assert.equal(classifyBreadthAsset({ contractType: 'PERPETUAL', underlyingType }), 'tradfi')
  }
  assert.equal(classifyBreadthAsset({ contractType: 'TRADIFI_PERPETUAL' }), 'tradfi')
  assert.equal(classifyBreadthAsset({ contractType: 'PERPETUAL', underlyingType: 'INDEX', underlyingSubType: ['Crypto'] }), 'crypto')
  assert.equal(classifyBreadthAsset({ symbol: 'DEFIUSDT', contractType: 'PERPETUAL', underlyingType: 'INDEX' }), 'crypto')
  for (const symbol of ['PAXGUSDT', 'XAUTUSDT']) {
    assert.equal(classifyBreadthAsset({ symbol, contractType: 'PERPETUAL', underlyingType: 'COIN' }), 'crypto')
    assert.equal(classifyBreadthAsset({ symbol, contractType: 'PERPETUAL', underlyingType: 'COMMODITY' }), 'tradfi')
    assert.equal(classifyBreadthAsset({ symbol, contractType: 'PERPETUAL' }), 'unknown')
  }
  assert.equal(classifyBreadthAsset({ contractType: 'PERPETUAL', underlyingType: 'INDEX' }), 'unknown')
  assert.equal(classifyBreadthAsset(undefined), 'unknown')
})

/** 两组走势相反，检验市场支持、排名与24h修正均不受其他资产组影响。 */
function mixedSnapshot() {
  const changes = { BTCUSDT: 2, ETHUSDT: 1, STOCKUSDT: -1, OTHERUSDT: -2, UNKNOWN: 100 }
  return {
    scope: 'selected_symbols', symbols: Object.keys(changes), selectedCount: 5,
    assetCategories: { BTCUSDT: 'crypto', ETHUSDT: 'crypto', STOCKUSDT: 'tradfi', OTHERUSDT: 'tradfi', UNKNOWN: 'unknown' },
    computedAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
    periods: Object.fromEntries(['5m', '15m', '1h', '4h', '24h'].map(period => [period, {
      ...summarizeBreadth({ ...changes }, 100), normalizedChanges: { ...changes }, atrs: { BTCUSDT: 1, STOCKUSDT: 2 }
    }]))
  }
}

test('看板分类范围包含同类缺失行情，未知仅在全部展示，空组不回退全市场', () => {
  const snapshot = mixedSnapshot()
  snapshot.symbols.push('NEWUSDT')
  assert.deepEqual(filterBreadthSymbols(snapshot.symbols, snapshot.assetCategories, 'all'), snapshot.symbols)
  assert.deepEqual(filterBreadthSymbols(snapshot.symbols, snapshot.assetCategories, 'crypto'), ['BTCUSDT', 'ETHUSDT'])
  const tradfi = filterBreadthSymbols(snapshot.symbols, snapshot.assetCategories, 'tradfi')
  assert.deepEqual(tradfi, ['STOCKUSDT', 'OTHERUSDT'])
  const stats = calculateLiveBreadth(tradfi, {
    STOCKUSDT: { price: 110, timestamp: 1000 }
  }, '1h', { STOCKUSDT: 100, OTHERUSDT: 100 }, 0, 1000)
  assert.equal(stats.validCount, 1)
  assert.equal(stats.missingCount, 1)
  assert.equal(stats.upRatioPct, 100)
  assert.deepEqual(filterBreadthSymbols(snapshot.symbols, undefined, 'tradfi'), [])
  assert.deepEqual(filterBreadthSymbols(['BTCUSDT'], snapshot.assetCategories, 'tradfi'), [])
})

test('双向置信度仅使用同类市场、主周期排名和24h广度，改变其他组不改变结果', () => {
  const snapshot = mixedSnapshot()
  const signals = Object.fromEntries(['5m', '15m', '1h', '4h', '1d'].map(period => [period, '中性']))
  const crypto = buildEnvironmentContext(signals, snapshot, ' btc/usdt ')
  const stock = buildEnvironmentContext(signals, snapshot, 'STOCKUSDT')
  assert.equal(crypto.long.market, 100)
  assert.equal(stock.long.market, 0)
  assert.equal(stock.long.relativeStrength, 85)
  assert.equal(stock.short.relativeStrength, 15)
  assert.equal(stock.long.marketBreadthAdjustment.adjustment, -8)
  assert.equal(stock.short.marketBreadthAdjustment.adjustment, 0)
  assert.equal(stock.long.coverage, 100)
  assert.deepEqual(stock.marketScope, { category: 'tradfi', selectedCount: 2 })
  assert.match(formatEnvironmentConfidence(stock), /传统金融资产，已选同类2个/)
  for (const stats of Object.values(snapshot.periods)) {
    stats.changes.BTCUSDT = -100
    stats.normalizedChanges.BTCUSDT = -100
    stats.changes.UNKNOWN = -999
  }
  assert.deepEqual(buildEnvironmentContext(signals, snapshot, 'STOCKUSDT'), stock)
  assert.equal(snapshot.selectedCount, 5)
  assert.equal(Object.keys(snapshot.periods['5m'].changes).length, 5)
})

test('同组单样本、未知分类、旧快照缺分类及同组主周期ATR缺失均不借其他组补分', () => {
  const snapshot = mixedSnapshot()
  const signals = Object.fromEntries(['5m', '15m', '1h', '4h', '1d'].map(period => [period, '中性']))
  snapshot.assetCategories.OTHERUSDT = 'unknown'
  assert.equal(buildEnvironmentContext(signals, snapshot, 'STOCKUSDT').long.available, false)
  assert.equal(buildEnvironmentContext(signals, snapshot, 'UNKNOWN').long.market, null)
  snapshot.assetCategories.OTHERUSDT = 'tradfi'
  snapshot.periods['15m'].normalizedChanges.OTHERUSDT = null
  assert.equal(buildEnvironmentContext(signals, snapshot, 'STOCKUSDT').long.relativeStrength, null)
  assert.equal(buildEnvironmentContext(signals, snapshot, 'STOCKUSDT', '5m').long.available, true)
  delete snapshot.assetCategories
  assert.equal(buildEnvironmentContext(signals, snapshot, 'BTCUSDT').long.available, false)
})

test('分组覆盖率只使用本组已选数量，缺失同类价格仍保留为缺失', () => {
  const snapshot = mixedSnapshot()
  snapshot.periods['5m'].changes.OTHERUSDT = null
  const scoped = selectBreadthForSymbol(snapshot, 'STOCKUSDT')
  assert.equal(scoped.selectedCount, 2)
  assert.equal(scoped.periods['5m'].validCount, 1)
  assert.equal(scoped.periods['5m'].missingCount, 1)
  assert.deepEqual(scoped.periods['5m'].atrs, { STOCKUSDT: 2 })
  const signals = Object.fromEntries(['5m', '15m', '1h', '4h', '1d'].map(period => [period, '中性']))
  assert.equal(buildEnvironmentContext(signals, snapshot, 'STOCKUSDT').long.coverage, 95)
})

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
  const metadata = ['BTCUSDT', 'ETHUSDT'].map(symbol => ({ symbol, contractType: 'PERPETUAL', underlyingType: 'COIN' }))
  const metadataState = { unavailable: false }
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
      if (id === '../../app/utils/market-breadth') return { summarizeBreadth, classifyBreadthAsset, selectBreadthForSymbol, BREADTH_CATEGORY_LABELS }
      if (id === './binance-exchange-info') return { getBinanceExchangeInfo: async () => {
        if (metadataState.unavailable) throw new Error('元数据不可用')
        return { symbols: metadata }
      } }
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
  return { api, rawGetMarketBreadth, hub, prices, bars, atrReads, atrValues, stalePeriods, metadata, metadataState, now, reads: () => reads, advance: ms => { time += ms } }
}

/** 为恢复测试提供两个完整排名样本，避免将单样本配置误当成可恢复缺失。 */
function completeRankingFixture() {
  const f = fixture()
  f.prices.ETHUSDT = { price: 90, timestamp: f.now }
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    for (const minutes of [5, 15, 60, 240, 1440]) {
      f.bars.set(`${symbol}:${f.now / 1000 - minutes * 60}`, 100)
    }
  }
  const original = f.hub.getIndicators
  f.hub.getIndicators = (symbol, ...args) => original('BTCUSDT', ...args)
  return f
}

test('元数据变化立即隔离快照缓存，元数据失败保留未知且恢复后可重新评分', async () => {
  const f = completeRankingFixture()
  const config = { symbols: ['BTCUSDT', 'ETHUSDT'] }
  const initial = await f.api.getMarketBreadth(config)
  f.metadata[1].contractType = 'TRADIFI_PERPETUAL'
  const changed = await f.api.getMarketBreadth(config)
  assert.notEqual(changed, initial)
  assert.equal(changed.assetCategories.ETHUSDT, 'tradfi')
  assert.equal(selectBreadthForSymbol(changed, 'BTCUSDT').selectedCount, 1)
  f.metadataState.unavailable = true
  const unavailable = await f.api.getMarketBreadth(config)
  assert.equal(unavailable.assetCategories.BTCUSDT, 'unknown')
  assert.equal(selectBreadthForSymbol(unavailable, 'BTCUSDT'), undefined)
  f.metadataState.unavailable = false
  f.metadata[1].contractType = 'PERPETUAL'
  const recovered = await f.api.getMarketBreadth(config)
  const signals = Object.fromEntries(['5m', '15m', '1h', '4h', '1d'].map(period => [period, '中性']))
  assert.equal(assessEnvironment(signals, recovered, 'BTCUSDT', 1, f.now).available, true)
})

test('AI市场文本与评分使用相同资产组和名次，整体展示仍可查看全部资产', () => {
  const f = fixture()
  const snapshot = mixedSnapshot()
  snapshot.computedAt = f.now
  snapshot.expiresAt = f.now + 60000
  const prompt = f.api.formatMarketBreadth(snapshot, 'STOCKUSDT')
  assert.match(prompt, /传统金融资产，已选2个交易对/)
  assert.match(prompt, /5m：涨0，跌2，平0/)
  assert.match(prompt, /当前主周期 15m 相对强弱排名：第1名 \/ 2个/)
  assert.doesNotMatch(prompt, /BTCUSDT|ETHUSDT|UNKNOWN/)
  assert.match(f.api.formatMarketBreadth(snapshot), /全部资产，已选5个交易对/)
  assert.match(f.api.formatMarketBreadth(snapshot, 'UNKNOWN'), /分类未知/)
})

for (const timeframe of ['5m', '15m', '1h', '4h', '1d']) {
  test(`${timeframe}整批排名缺失后，K线补齐经30秒重试恢复双向分数且并发共享快照`, async () => {
    const f = completeRankingFixture()
    const config = { symbols: ['BTCUSDT', 'ETHUSDT'] }
    const period = timeframe === '1d' ? '24h' : timeframe
    const signals = Object.fromEntries(['5m', '15m', '1h', '4h', '1d'].map(key => [key, '空头双减弱']))
    f.stalePeriods.add(timeframe)
    const missing = await f.api.getMarketBreadth(config)
    assert.equal(missing.periods[period].rankingUnavailableReasons.BTCUSDT, '等待当前周期K线')
    assert.equal(assessEnvironment(signals, missing, 'BTCUSDT', 1, f.now, timeframe).confidence, null)
    f.stalePeriods.delete(timeframe)
    f.advance(29999)
    const reads = f.reads()
    assert.equal(await f.api.getMarketBreadth(config), missing)
    assert.equal(f.reads(), reads)
    f.advance(1)
    const [restored, concurrent] = await Promise.all([f.api.getMarketBreadth(config), f.api.getMarketBreadth(config)])
    assert.equal(restored, concurrent)
    assert.notEqual(restored, missing)
    assert.deepEqual(Object.keys(restored.periods[period].rankingUnavailableReasons), [])
    for (const side of [1, -1]) {
      const assessment = assessEnvironment(signals, restored, 'BTCUSDT', side, f.now + 30000, timeframe)
      assert.equal(assessment.available, true)
      assert.ok(Number.isFinite(assessment.confidence))
    }
    assert.equal(missing.expiresAt, f.now + 300000)
    assert.equal(missing.periods[period].normalizedChanges.BTCUSDT, null)
    // 恢复完整后不再以30秒刷新，也不改写已经交给分析使用的旧快照。
    f.advance(30000)
    assert.equal(await f.api.getMarketBreadth(config), restored)
  })
}

test('持续缺失每30秒最多惰性重试一次，仍不补造分数并记录ATR与样本不足原因', async () => {
  const f = completeRankingFixture()
  const config = { symbols: ['BTCUSDT', 'ETHUSDT'] }
  f.atrValues.set('15m', 0)
  const first = await f.api.getMarketBreadth(config)
  assert.equal(first.periods['15m'].rankingUnavailableReasons.BTCUSDT, 'ATR不可用')
  f.advance(30000)
  const retried = await f.api.getMarketBreadth(config)
  assert.notEqual(retried, first)
  assert.equal(retried.periods['15m'].normalizedChanges.BTCUSDT, null)
  const reads = f.reads()
  assert.equal(await f.api.getMarketBreadth(config), retried)
  assert.equal(f.reads(), reads)
  const single = await f.api.getMarketBreadth({ symbols: ['BTCUSDT'] })
  assert.equal(single.periods['1h'].rankingUnavailableReasons.BTCUSDT, '有效排名样本不足2个')
  f.advance(30000)
  assert.equal(await f.api.getMarketBreadth({ symbols: ['BTCUSDT'] }), single)
})

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
  assert.ok(prompt.includes('全部资产，已选1个交易对') && prompt.includes('更新时间：') && prompt.includes('4h'))
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
  assert.ok(f.api.formatMarketBreadth(snapshot, 'UNKNOWN').includes('分类未知或不在已选范围'))
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
  snapshot.symbols = ['BTCUSDT', 'A', 'B', 'C', 'D']
  snapshot.assetCategories = Object.fromEntries(snapshot.symbols.map(symbol => [symbol, 'crypto']))
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
