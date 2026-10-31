// ==================== 指标快照、成交量EMA与缓存时效回归 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as technicalIndicators from 'technicalindicators'

const require = createRequire(import.meta.url)
const logger = { info() {}, warn() {}, error() {}, success() {} }

/** 执行实际业务源码，只隔离网络、数据库和持久化，测试不连接交易所。 */
function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = {
    exports: {}, Buffer, Map, Set, setTimeout, clearTimeout, setInterval, clearInterval,
    require: id => dependencies[id] ?? (id.startsWith('node:') ? require(id) : {}),
    ...globals
  }
  vm.runInNewContext(compiled.outputText, context, { filename: path })
  return context.exports
}

const hashes = loadModule('../server/utils/stable-hash.ts')
const candleVolume = loadModule('../server/utils/candle-volume.ts')
const snapshots = loadModule('../server/utils/ai-analysis-snapshot.ts', { './candle-volume.ts': candleVolume })
const { AIPreScreener } = loadModule('../server/utils/ai-pre-screen.ts')
const { IndicatorCombinationRegistry } = loadModule('../server/modules/indicators/IndicatorCombinationRegistry.ts', {
  '../../utils/stable-hash': hashes
})
const volumeOnly = { enableAdx: false, enableAdxSlope: false, enableAtr: false, enableOi: false, enableVolume: true }

/** 构造含盘中K线的固定窗口，主周期和成交量周期具有明显不同的累计量。 */
function makeKlines(now, timeframeMs, currentVolume) {
  const currentTimestamp = Math.floor(now / timeframeMs) * timeframeMs
  return Array.from({ length: 150 }, (_, i) => ({
    timestamp: currentTimestamp - (149 - i) * timeframeMs,
    open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i,
    volume: i === 149 ? currentVolume : 100
  }))
}

/** 使用真实指标中心、调度器和策略装配流程；仅拦截最终AI请求。 */
function createFixture() {
  const clock = { now: Date.UTC(2026, 9, 30, 10, 10) }
  /** 提供可推进的时钟，验证排队后仍使用快照时点计算进度。 */
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  const globals = { Date: FixtureDate }
  const config = { volumeEmaPeriod: 3, indicatorsConfig: { requiredCandles: 150 }, indicatorPrecompute: { staleTtlMs: 900000 } }
  const source = new Map([
    ['15m', makeKlines(clock.now, 900000, 9000)],
    ['1h', makeKlines(clock.now, 3600000, 30)]
  ])
  const versions = new Map([['15m', 'main-1'], ['1h', 'volume-1']])
  const { IndicatorsHub } = loadModule('../server/modules/indicators/IndicatorsHub.ts', {
    technicalindicators: technicalIndicators,
    '../../utils/stable-hash': hashes,
    '../../utils/logger': { logger },
    '../../utils/kline-simple-storage': {
      getKLineFileMTime: (_, timeframe) => versions.get(timeframe),
      getSimpleKLineAsOHLCV: (_, timeframe, limit) => source.get(timeframe)?.slice(-limit) ?? []
    },
    './SupportResistanceCache': { SupportResistanceCache: class {} },
    './OISnapshotService': { OISnapshotService: class {} }
  }, globals)
  const hub = new IndicatorsHub({}, config)
  const strategy = {
    id: 'snapshot-strategy', name: '快照测试', isActive: true,
    marketData: { symbols: ['BTCUSDT'], timeframes: ['15m'] },
    indicators: [
      { type: 'EMA', enabled: true, params: { periods: [14] } },
      { type: 'ADX', enabled: true, params: { period: 14 } },
      { type: 'ATR', enabled: true, params: { period: 14 } },
      { type: 'SupportResistance', enabled: false }
    ],
    statistics: [{ type: 'Volume', enabled: true, timeframes: ['1h'] }],
    preScreenConfig: { ...volumeOnly, minEstimatedVolumeRatio: 2 },
    riskManagement: {}, aiPrompt: { userPrompt: '测试规则', provider: 'openai', model: 'test' }
  }
  const registry = new IndicatorCombinationRegistry()
  registry.rebuildFromStrategies([strategy])
  const { IndicatorPrecomputeService } = loadModule('../server/modules/indicators/IndicatorPrecomputeService.ts', {
    '../../utils/logger': { logger },
    '../../utils/market-breadth': { getMarketBreadth: async () => ({}) },
    '../../utils/binance-api-gateway': { binanceApiGateway: { shouldPauseBackgroundWork: () => false } },
    '../../utils/concurrency-pool': { concurrencyPoolManager: { getIndicatorPool: () => ({ submit: task => task() }) } }
  }, globals)
  const precompute = new IndicatorPrecomputeService(registry, hub, config)
  const { SymbolBasedScheduler } = loadModule('../server/modules/scheduler/SymbolBasedScheduler.ts', {
    '../../utils/logger': { logger }
  }, globals)
  const scheduler = new SymbolBasedScheduler(hub, { fetchPrice: async () => 250 })
  scheduler.subscribeStrategy(strategy)
  const screener = new AIPreScreener()
  const calls = []
  const { StrategyEngine } = loadModule('../server/modules/strategy-engine/StrategyEngine.ts', {
    '../../utils/logger': { logger },
    '../../utils/stable-hash': hashes,
    '../../utils/ai-pre-screen': { aiPreScreener: screener },
    '../../utils/market-breadth': { getMarketBreadth: async () => ({}) },
    '../../utils/money-flow': { calculateMoneyFlow: () => ({}), formatMoneyFlowPrompt: () => '' }
  }, globals)
  const engine = Object.assign(Object.create(StrategyEngine.prototype), {
    config, indicatorsHub: hub, indicatorRegistry: registry, indicatorPrecompute: precompute,
    aiCache: new Map(), currentLoopAIRequests: 0,
    getOpeningBlockReason: () => null,
    positionManager: { hasConflict: async () => false },
    aiAnalyzer: { async analyze(...args) { calls.push(args); return null } }
  })
  const instance = { strategy }
  return { clock, globals, config, source, versions, hub, strategy, registry, precompute, scheduler, engine, instance, calls, screener }
}

test('缓存摘要覆盖完整行情与参数，字段顺序保持稳定', () => {
  const common = { indicators: { longCommonPrefix: 'x'.repeat(200), volumeEmaAverage: 100 }, candleProgress: 0.5 }
  assert.notEqual(hashes.shortHash(common), hashes.shortHash({ ...common, candleProgress: 0.6 }))
  assert.notEqual(hashes.shortHash(common), hashes.shortHash({ ...common, indicators: { ...common.indicators, volumeEmaAverage: 101 } }))
  assert.notEqual(hashes.shortHash({ fastPeriod: 12, signalPeriod: 9, slowPeriod: 26 }, 16), hashes.shortHash({ fastPeriod: 12, signalPeriod: 9, slowPeriod: 30 }, 16))
  assert.equal(hashes.shortHash({ a: 1, b: 2 }), hashes.shortHash({ b: 2, a: 1 }))
  assert.notEqual(hashes.shortHash({ close: 0.000000011 }), hashes.shortHash({ close: 0.000000012 }))
  assert.notEqual(hashes.shortHash(new Map([['volume', 100]])), hashes.shortHash(new Map([['volume', 101]])))
})

test('预筛按EMA比较预估量，无需上一根成交量；保留低进度跳过规则', () => {
  const screener = new AIPreScreener()
  const input = { symbol: 'BTCUSDT', strategyId: 's', currentVolume: 10, volumeEmaAverage: 100, candleProgress: 0.5 }
  const rejected = screener.screen(input, volumeOnly)
  assert.equal(rejected.passed, false)
  assert.equal(rejected.checks.volume.value, 0.2)
  assert.match(rejected.reason, /成交量EMA/)
  assert.equal(screener.screen({ ...input, currentVolume: 15 }, volumeOnly).passed, true)
  assert.equal(screener.screen({ ...input, candleProgress: 0.01 }, volumeOnly).passed, true)
  assert.equal(screener.screen({ ...input, candleProgress: 0 }, { ...volumeOnly, minCandleProgressForVolume: 0 }).passed, true)
  for (const change of [{ volumeEmaAverage: undefined }, { volumeEmaAverage: NaN }, { volumeEmaAverage: 0 }, { candleProgress: undefined }, { candleProgress: NaN }, { candleProgress: 2 }, { currentVolume: -1 }]) {
    assert.equal(screener.screen({ ...input, ...change }, volumeOnly).passed, false)
  }
})

test('成交量缓存感知TTL内的盘中更新，并与technicalindicators的EMA一致', async () => {
  const f = createFixture()
  const first = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  const bars = f.source.get('1h')
  assert.equal(first.values.emaAverage, technicalIndicators.EMA.calculate({ period: 3, values: bars.map(c => c.volume) }).at(-1))
  assert.equal(first.values.emaAverage, 65)
  assert.equal(await f.hub.getIndicators('BTCUSDT', '1h', 'Volume'), first)
  f.source.set('1h', bars.map((c, i) => i === bars.length - 1 ? { ...c, volume: 70 } : c))
  f.versions.set('1h', 'volume-2')
  const updated = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  assert.equal(updated.values.current, 70)
  assert.equal(updated.values.emaAverage, 85)
  assert.notEqual(updated.sourceKlineHash, first.sourceKlineHash)
  f.source.set('1h', f.source.get('1h').map((c, i) => i === 149 ? { ...c, volume: 90 } : c))
  f.versions.set('1h', 'volume-3')
  await f.hub.refreshSymbolTimeframe('BTCUSDT', '1h')
  const eventUpdated = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  assert.equal(eventUpdated.values.current, 90)
  assert.equal(eventUpdated.values.emaAverage, 95)
  f.hub.updateConfig({ ...f.config, volumeEmaPeriod: 5 })
  assert.equal((await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')).values.emaPeriod, 5)
  await assert.rejects(f.hub.getIndicators('BTCUSDT', '1h', 'Volume', undefined, bars.slice(-2)), /数据不足/)
})

test('技术指标和EMA缓存随盘中价格变化刷新，未变K线在TTL到期后也重新计算', async () => {
  const f = createFixture()
  const first = await f.hub.getIndicators('BTCUSDT', '15m', 'ATR', { atrPeriod: 14 })
  const ema = await f.hub.getEMAByPeriods('BTCUSDT', '15m', [14])
  f.source.set('15m', f.source.get('15m').map((c, i) => i === 149 ? { ...c, close: 300, high: 301 } : c))
  f.versions.set('15m', 'main-2')
  const updated = await f.hub.getIndicators('BTCUSDT', '15m', 'ATR', { atrPeriod: 14 })
  assert.notEqual(updated.values.atr, first.values.atr)
  assert.notEqual((await f.hub.getEMAByPeriods('BTCUSDT', '15m', [14])).values.emaList[0].value, ema.values.emaList[0].value)
  f.clock.now += f.config.indicatorPrecompute.staleTtlMs
  const refreshed = await f.hub.getIndicators('BTCUSDT', '15m', 'ATR', { atrPeriod: 14 })
  assert.notEqual(refreshed, updated)
  assert.equal(refreshed.timestamp, f.clock.now)
})

test('预计算缓存无论stale标记都拒绝超时数据，并校验底层时间和脏标记', async () => {
  const f = createFixture()
  const key = f.registry.getBinding(f.strategy.id, 'BTCUSDT').keys.volume
  const data = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  const ttl = f.config.indicatorPrecompute.staleTtlMs
  for (const stale of [false, true]) {
    f.precompute.cache.set(key, { data, computedAt: f.clock.now, stale })
    assert.equal(f.precompute.get(key), data)
    f.clock.now += ttl
    assert.equal(f.precompute.get(key), undefined)
    assert.equal(f.precompute.cache.has(key), false)
    f.clock.now -= ttl
  }
  f.precompute.cache.set(key, { data: { ...data, timestamp: f.clock.now - ttl }, computedAt: f.clock.now, stale: false })
  assert.equal(f.precompute.get(key), undefined)
  for (const timestamp of [NaN, f.clock.now + 1]) {
    f.precompute.cache.set(key, { data: { ...data, timestamp }, computedAt: f.clock.now, stale: false })
    assert.equal(f.precompute.get(key), undefined)
  }
  f.precompute.cache.set(key, { data, computedAt: f.clock.now, stale: false })
  f.precompute.markDirtyBySymbolTimeframe('BTCUSDT', '1h')
  assert.equal(f.precompute.get(key), undefined)
  f.precompute.updateConfig(f.config)
  assert.equal(f.precompute.getStatus().cacheSize, 0)
})

test('后台预计算不以新的写入时间延长旧指标寿命', async () => {
  const f = createFixture()
  const combo = { key: 'volume', symbol: 'BTCUSDT', timeframe: '1h', type: 'Volume', params: {} }
  f.registry.getCombinations = () => [combo]
  const oldData = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  f.clock.now += f.config.indicatorPrecompute.staleTtlMs
  f.hub.getIndicators = async () => oldData
  await f.precompute.precomputeAll()
  assert.equal(f.precompute.get('volume'), undefined)
})

test('配置更新期间未完成的旧预计算不能回填缓存', async () => {
  const f = createFixture()
  f.registry.getCombinations = () => [{ key: 'volume', symbol: 'BTCUSDT', timeframe: '1h', type: 'Volume', params: {} }]
  const data = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  let finish, signalStarted
  const pending = new Promise(resolve => { finish = resolve })
  const started = new Promise(resolve => { signalStarted = resolve })
  f.hub.getIndicators = async () => { signalStarted(); return pending }
  const running = f.precompute.precomputeAll()
  await started
  f.precompute.updateConfig({ ...f.config, volumeEmaPeriod: 5 })
  finish(data)
  await running
  assert.equal(f.precompute.get('volume'), undefined)
  assert.equal(f.precompute.getStatus().cacheSize, 0)
})

test('快照固定后拒用其他窗口的预计算指标，回退计算和跨周期量能进度均保持原时点', async () => {
  const f = createFixture()
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  const originalVolumeCandle = snapshot.klinesByTimeframe.get('1h').at(-1)
  // 模拟等待期间后台更新同一根盘中K线，不能将新EMA拼接到已固定的旧成交量上。
  f.source.get('1h').at(-1).volume = 70
  f.source.get('15m').at(-1).close = 300
  assert.equal(originalVolumeCandle.volume, 30)
  f.versions.set('1h', 'volume-2')
  f.versions.set('15m', 'main-2')
  const binding = f.registry.getBinding(f.strategy.id, 'BTCUSDT')
  const newer = await f.hub.getIndicators('BTCUSDT', '1h', 'Volume')
  f.precompute.cache.set(binding.keys.volume, { data: newer, computedAt: f.clock.now, stale: false })
  f.clock.now += 120000
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  assert.equal(f.calls.length, 1)
  const [, , , indicators, , volume, mainProgress] = f.calls[0]
  assert.equal(volume, 30)
  assert.equal(indicators.volumeEmaAverage, 65)
  assert.equal(indicators.volumeTimeframe, '1h')
  assert.equal(indicators.volumeCandleProgress, 1 / 6)
  assert.equal(mainProgress, 2 / 3)
  assert.equal(indicators.snapshotTimestamp, snapshot.timestamp)
  assert.equal(indicators.lastCandle.close, 250)
  const result = f.screener.screen({ symbol: 'BTCUSDT', strategyId: 's', currentVolume: volume, volumeEmaAverage: indicators.volumeEmaAverage, candleProgress: indicators.volumeCandleProgress }, f.strategy.preScreenConfig)
  assert.equal(result.passed, true)
  assert.equal(result.checks.volume.value, 180 / 65)
  const quantitative = snapshots.createQuantitativeSnapshot(indicators, volume, mainProgress)
  assert.equal(quantitative.currentCandleVolume, 30)
  assert.equal(quantitative.estimatedVolume, 180)
  assert.equal(quantitative.estimatedVolumeEmaRatio, result.checks.volume.value)
  assert.equal(quantitative.candleProgress, mainProgress)
  assert.equal(quantitative.volumeCandleProgress, 1 / 6)
  assert.equal(quantitative.volumeCandleTimestamp, originalVolumeCandle.timestamp)
})

test('AI提示词、信号与复算快照使用同一成交量周期和EMA比值', async () => {
  const f = createFixture()
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  const [, , promptConfig, indicators, price, volume, progress] = f.calls[0]
  const { MultiStrategyAIAnalyzer } = loadModule('../server/modules/ai-analyzer/MultiStrategyAIAnalyzer.ts', {
    '../../utils/logger': { logger },
    '../../utils/stable-hash': hashes,
    '../../utils/candle-volume': candleVolume,
    '../../utils/ai-analysis-snapshot': { ...snapshots, createStrategySnapshot: () => ({}) },
    '../../utils/environment-context': { loadEnvironmentContext: async () => undefined },
    '../../utils/market-breadth': { formatMarketBreadth: () => '' },
    '../../../app/utils/environment-confidence': { formatEnvironmentConfidence: () => '' },
    '../strategy-store/StrategyStore': { strategyStore: { getStrategy: async () => f.strategy } }
  }, f.globals)
  const analyzer = new MultiStrategyAIAnalyzer({}, f.config)
  const data = analyzer.preparePromptData('BTCUSDT', price, indicators, volume, progress)
  assert.match(data.volumeSection, /成交量周期：1h；该周期K线进度：16\.7%/)
  assert.match(data.volumeSection, /当前累计成交量：30\.00/)
  assert.match(data.volumeSection, /预计K线结束成交量：180\.00/)
  assert.match(data.volumeSection, /2\.77倍/)
  assert.equal(data.currentTime, new Date(snapshot.timestamp).toISOString())
  const requests = []
  analyzer.callAI = async (...args) => {
    requests.push(args)
    return { direction: 'IDLE', confidence: 80, reasoning: '回归验证', technicalData: {}, riskLevel: 'LOW' }
  }
  const signal = await analyzer.analyze(f.strategy.id, 'BTCUSDT', promptConfig, indicators, price, volume, progress)
  assert.ok(signal)
  assert.equal(requests.length, 1)
  assert.equal(signal.indicators.volume.current, 30)
  assert.equal(signal.indicators.volume.estimatedVolume, 180)
  assert.equal(signal.indicators.volume.ratio, 180 / 65)
  assert.equal(signal.indicators.volume.candleProgress, 1 / 6)
  assert.equal(requests[0].at(-1).estimatedVolumeEmaRatio, signal.indicators.volume.ratio)
  analyzer.clearCache()
})

test('成交量不指定周期时跟随主周期，必要数据缺失时不调用AI', async () => {
  const f = createFixture()
  f.strategy.statistics[0].timeframes = []
  f.strategy.preScreenConfig.minEstimatedVolumeRatio = 0
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  assert.equal(f.calls[0][3].volumeTimeframe, '15m')
  assert.equal(f.calls[0][3].volumeCurrent, 9000)
  assert.equal(f.calls[0][3].volumeCandleProgress, f.calls[0][6])
  f.calls.length = 0
  snapshot.klinesByTimeframe.delete('15m')
  await assert.rejects(f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot), /市场快照缺少K线/)
  assert.equal(f.calls.length, 0)
})

test('AI缓存命中仍执行当前策略预筛，量能不达标时拒用旧信号', async () => {
  const f = createFixture()
  f.strategy.preScreenConfig.minEstimatedVolumeRatio = 3
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  // 主周期与成交量K线均有效，确保拒绝由量能门槛触发。
  const data = new Map()
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '15m', data, snapshot)
  f.engine.buildAICacheKey = () => 'cached-key'
  f.engine.aiCache.set('cached-key', { signal: { direction: 'long' }, timestamp: f.clock.now })
  assert.equal(await f.engine.callAI(f.instance, f.strategy.id, 'BTCUSDT', f.strategy.aiPrompt, data, snapshot), null)
  assert.equal(f.calls.length, 0)
})

test('排队超过TTL的快照及未来K线不能用于新的AI请求', async () => {
  const f = createFixture()
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  const data = new Map()
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '15m', data, snapshot)
  f.clock.now += f.config.indicatorPrecompute.staleTtlMs
  assert.equal(await f.engine.callAI(f.instance, f.strategy.id, 'BTCUSDT', f.strategy.aiPrompt, data, snapshot), null)
  f.clock.now = snapshot.timestamp
  snapshot.klinesByTimeframe.get('15m').at(-1).timestamp = snapshot.timestamp + 1
  assert.equal(await f.engine.callAI(f.instance, f.strategy.id, 'BTCUSDT', f.strategy.aiPrompt, data, snapshot), null)
  assert.equal(f.calls.length, 0)
})
