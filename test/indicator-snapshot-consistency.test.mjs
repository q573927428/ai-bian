// ==================== 指标快照、成交量EMA与缓存时效回归 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as technicalIndicators from 'technicalindicators'
import * as efficiencyRatio from '../app/utils/efficiency-ratio.ts'

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
const { SnapshotIndicatorCalculator } = loadModule('../server/modules/strategy-engine/SnapshotIndicatorCalculator.ts', {
  '../../utils/stable-hash': hashes
})
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
    '../../../app/utils/efficiency-ratio': efficiencyRatio,
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
    '../../../app/utils/efficiency-ratio': efficiencyRatio,
    '../../utils/logger': { logger }
  }, globals)
  const scheduler = new SymbolBasedScheduler(hub, { fetchPrice: async () => 250 })
  scheduler.subscribeStrategy(strategy)
  const screener = new AIPreScreener()
  const calls = []
  const { StrategyEngine } = loadModule('../server/modules/strategy-engine/StrategyEngine.ts', {
    '../../../app/utils/efficiency-ratio': efficiencyRatio,
    '../../utils/logger': { logger },
    '../../utils/stable-hash': hashes,
    './SnapshotIndicatorCalculator': { SnapshotIndicatorCalculator },
    '../../utils/ai-pre-screen': { aiPreScreener: screener },
    '../../utils/market-breadth': { getMarketBreadth: async () => ({}) },
    '../../utils/money-flow': { calculateMoneyFlow: () => ({}), formatMoneyFlowPrompt: () => '' }
  }, globals)
  const engine = Object.assign(Object.create(StrategyEngine.prototype), {
    config, indicatorsHub: hub, indicatorRegistry: registry, indicatorPrecompute: precompute,
    aiCache: new Map(), currentLoopAIRequests: 0,
    // 此夹具跳过构造函数，需要显式初始化本轮快照任务管理器。
    snapshotIndicatorCalculator: new SnapshotIndicatorCalculator(),
    getOpeningBlockReason: () => null,
    positionManager: { hasConflict: async () => false },
    aiAnalyzer: { async analyze(...args) { calls.push(args); return null } }
  })
  const instance = { strategy }
  return { clock, globals, config, source, versions, hub, strategy, registry, precompute, scheduler, engine, instance, calls, screener }
}

test('AI 通信失败明确记录分析不可用，不生成观望信号或缓存失败结果', async () => {
  const entries = []
  let requests = 0
  const { MultiStrategyAIAnalyzer } = loadModule('../server/modules/ai-analyzer/MultiStrategyAIAnalyzer.ts', {
    '../../utils/logger': { logger: { ...logger, warn: (...args) => entries.push(args) } },
    '../../utils/stable-hash': hashes,
    '../strategy-store/StrategyStore': { strategyStore: { getStrategy: async () => ({}) } },
    '../../utils/environment-context': { loadEnvironmentContext: async () => ({}) },
    '../../utils/ai-analysis-snapshot': { createStrategySnapshot: () => ({ marketData: { timeframes: ['15m'] } }), createQuantitativeSnapshot: () => ({}) },
    '../../utils/concurrency-pool': { concurrencyPoolManager: { getAIPool: () => ({ submit: task => task() }) } },
    '../../utils/ai-service': {
      getProviderConfig: () => ({}),
      callAIAPI: async () => {
        requests++
        throw new Error(requests === 1 ? 'fetch failed' : 'This operation was aborted')
      }
    }
  }, { process: { env: {} }, useRuntimeConfig: () => ({ aiProvider: 'doubao-agent' }) })
  const analyzer = new MultiStrategyAIAnalyzer({}, {})
  analyzer.buildFullPrompt = () => '测试提示词'
  analyzer.buildSystemPrompt = async () => '测试系统提示词'
  for (let i = 0; i < 2; i++) {
    // 冷却期外重试相同输入，验证失败不会被缓存成正常 IDLE 结果。
    analyzer.providerCooldownUntil.clear()
    const signal = await analyzer.analyze('failure-strategy', 'BTCUSDT', {}, { emaList: [] }, 100, 10)
    assert.equal(signal, null)
  }
  assert.equal(requests, 2)
  assert.equal(entries.length, 2)
  for (const [category, message, data] of entries) {
    assert.equal(category, '🔍扫描结果')
    assert.match(message, /BTCUSDT @100 分析不可用 ｜ 本轮跳过/)
    assert.doesNotMatch(message, /置信度|评分|观望/)
    assert.equal(data.analysisStatus, 'unavailable')
    assert.equal(data.mainTimeframe, '15m')
    assert.equal(data.confidence, undefined)
    assert.equal(data.score, undefined)
  }
})

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

/** ER 跟随策略选择的 5m、15m、1h，故意保留过时的独立周期配置检验兼容。 */
function createERFixture() {
  const f = createFixture()
  f.source.set('5m', makeKlines(f.clock.now, 300000, 100))
  f.versions.set('5m', 'entry-1')
  f.source.set('1h', f.source.get('1h').map((c, i) => ({ ...c, close: 1000 - i })))
  f.strategy.marketData.timeframes = ['5m', '15m', '1h']
  f.strategy.indicators.push({ type: 'ER', enabled: true, params: { period: 20 }, timeframes: ['4h', '1d'] })
  f.registry.rebuildFromStrategies([f.strategy])
  f.scheduler.updateStrategySubscription(f.strategy)
  return f
}

test('ER 只计算策略勾选周期，忽略旧独立配置，将全部周期及相反方向送入 AI', async () => {
  const f = createERFixture()
  const calculated = []
  const getIndicators = f.hub.getIndicators.bind(f.hub)
  f.hub.getIndicators = async (...args) => {
    if (args[2] === 'ER') calculated.push(args[1])
    return getIndicators(...args)
  }
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  assert.deepEqual(Array.from(snapshot.klinesByTimeframe.keys()), ['5m', '15m', '1h'])
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  assert.deepEqual(calculated, ['5m', '15m', '1h'])
  const indicators = f.calls[0][3]
  assert.equal(indicators.enabledIndicators.er, true)
  assert.deepEqual(Array.from(indicators.er, e => e.timeframe), ['5m', '15m', '1h'])
  assert.deepEqual(Array.from(indicators.er, e => e.er), [1, 1, 1])
  assert.deepEqual(Array.from(indicators.er, e => e.direction), ['up', 'up', 'down'])
  for (const er of indicators.er) {
    assert.equal(er.period, 20)
    assert.equal(er.calculatedAt, snapshot.timestamp)
    assert.ok(er.closedAt <= snapshot.timestamp)
  }
})

test('ER 跟随策略切换为 4h/1d，其他统计所需周期不会混入 ER 输入', async () => {
  const f = createERFixture()
  f.source.set('4h', makeKlines(f.clock.now, 14400000, 100))
  f.source.set('1d', makeKlines(f.clock.now, 86400000, 100))
  f.versions.set('4h', '4h-1')
  f.versions.set('1d', '1d-1')
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', await f.scheduler.buildMarketSnapshot('BTCUSDT'))
  const calculated = []
  const getIndicators = f.hub.getIndicators.bind(f.hub)
  f.hub.getIndicators = async (...args) => {
    if (args[2] === 'ER') calculated.push(args[1])
    return getIndicators(...args)
  }
  f.strategy.marketData.timeframes = ['4h', '1d']
  f.registry.rebuildFromStrategies([f.strategy])
  f.scheduler.updateStrategySubscription(f.strategy)
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  // 1h 仍供成交量统计使用，但不应作为 ER 的观察周期。
  assert.ok(snapshot.klinesByTimeframe.has('1h'))
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  assert.deepEqual(calculated, ['4h', '1d'])
  assert.deepEqual(Array.from(f.calls.at(-1)[3].er, e => e.timeframe), ['4h', '1d'])
})

test('ER 以扫描快照判定已收盘，跨收盘时刻立即更新且不被旧缓存覆盖', async () => {
  const f = createERFixture()
  f.clock.now = Date.UTC(2026, 9, 30, 10, 14, 59)
  const bars = f.source.get('15m')
  bars.at(-1).close = 1
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  const expected = efficiencyRatio.calculateEfficiencyRatio(snapshot.klinesByTimeframe.get('15m'), '15m', { now: snapshot.timestamp })
  // 排队跨过 10:15，不能把扫描时仍在盘中的 K 线当成已收盘数据。
  f.clock.now += 2000
  bars.at(-1).close = 5000
  const data = new Map([['15m_ER', { values: { er: 0.1234 } }]])
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '5m', data, snapshot)
  assert.deepEqual(data.get('15m_ER').values, expected)
  assert.equal(data.get('15m_ER').values.er, 1)
  f.versions.set('15m', 'main-2')
  const newSnapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '5m', data, newSnapshot)
  const next = data.get('15m_ER').values
  assert.equal(next.lastCandleTimestamp - expected.lastCandleTimestamp, 900000)
  assert.equal(next.endClose, 5000)
  assert.equal(next.calculatedAt, newSnapshot.timestamp)
})

test('ER 提示词、信号和分析快照保留相同窗口，缺数据不显示成零', async () => {
  const f = createERFixture()
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  // 有效行情保留不足 N+1 根的历史，AI 应看到明确的不可用状态。
  snapshot.klinesByTimeframe.set('1h', snapshot.klinesByTimeframe.get('1h').slice(-21))
  await f.engine.analyzeSymbol(f.instance, 'BTCUSDT', snapshot)
  const [, , promptConfig, indicators, price, volume, progress] = f.calls[0]
  const { MultiStrategyAIAnalyzer } = loadModule('../server/modules/ai-analyzer/MultiStrategyAIAnalyzer.ts', {
    '../../utils/logger': { logger }, '../../utils/stable-hash': hashes,
    '../../utils/candle-volume': candleVolume,
    '../../utils/ai-analysis-snapshot': { ...snapshots, createStrategySnapshot: () => ({}) },
    '../../utils/environment-context': { loadEnvironmentContext: async () => undefined },
    '../../utils/market-breadth': { formatMarketBreadth: () => '' },
    '../../../app/utils/environment-confidence': { formatEnvironmentConfidence: () => '' },
    '../strategy-store/StrategyStore': { strategyStore: { getStrategy: async () => f.strategy } }
  }, f.globals)
  const analyzer = new MultiStrategyAIAnalyzer({}, f.config)
  const prompt = analyzer.buildFullPrompt(promptConfig, 'BTCUSDT', price, indicators, volume, progress)
  assert.match(prompt, /趋势效率 ER（已收盘）/)
  assert.match(prompt, /趋势效率 ER\(20, 5m\)=1\.00；净涨跌\+8\.73%/)
  assert.match(prompt, /趋势效率 ER\(20, 15m\)=1\.00；净涨跌\+8\.73%/)
  assert.match(prompt, /ER\(20, 1h\)：不可用（需要21个已收盘价，当前仅20个）/)
  assert.match(prompt, /方向看净涨跌/)
  assert.match(prompt, /未来胜率/)
  assert.match(prompt, /收盘2026-10-30T10:00:00Z/)
  const requests = []
  analyzer.callAI = async (...args) => {
    requests.push(args)
    return { direction: 'IDLE', confidence: 80, reasoning: 'ER输入回归', technicalData: {}, riskLevel: 'LOW' }
  }
  const signal = await analyzer.analyze(f.strategy.id, 'BTCUSDT', promptConfig, indicators, price, volume, progress)
  const recorded = requests[0].at(-1)
  // 分析器在独立 VM 中执行，先转为当前环境对象再比较冻结快照内容。
  assert.deepEqual(structuredClone(signal.indicators.er), structuredClone(indicators.er))
  assert.deepEqual(structuredClone(recorded.er), structuredClone(indicators.er))
  assert.notEqual(signal.indicators.er[0], indicators.er[0])
  assert.equal(recorded.er[2].status, 'insufficient_data')
  assert.equal(recorded.er[2].er, null)
  const disabled = { ...indicators, enabledIndicators: { ...indicators.enabledIndicators, er: false } }
  assert.doesNotMatch(analyzer.buildFullPrompt(promptConfig, 'BTCUSDT', price, disabled, volume, progress), /趋势效率|ER\(/)
  assert.equal(snapshots.createQuantitativeSnapshot(disabled, volume, progress).er, undefined)
  analyzer.clearCache()
})

test('ER 窗口互不串用，旧独立配置为空仍计算全部策略周期，关闭后不传给 AI', async () => {
  const f = createERFixture()
  const config = f.strategy.indicators.find(i => i.type === 'ER')
  const snapshot = await f.scheduler.buildMarketSnapshot('BTCUSDT')
  const data = new Map()
  config.params.period = 7
  config.timeframes = []
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '5m', data, snapshot)
  assert.equal(data.get('5m_ER').values.period, 7)
  assert.equal(data.get('15m_ER').values.period, 7)
  assert.equal(data.get('1h_ER').values.period, 7)
  config.params.period = 30
  await f.engine.hydrateIndicatorsForStrategy(f.strategy, 'BTCUSDT', '5m', data, snapshot)
  assert.equal(data.get('5m_ER').values.period, 30)
  assert.equal(data.get('15m_ER').values.period, 30)
  assert.equal(data.get('1h_ER').values.period, 30)
  config.enabled = false
  await f.engine.callAI(f.instance, f.strategy.id, 'BTCUSDT', f.strategy.aiPrompt, data, snapshot)
  assert.equal(f.calls[0][3].enabledIndicators.er, false)
  assert.equal(f.calls[0][3].er, undefined)
})
