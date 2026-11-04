// ==================== 支撑阻力页面试算参数与异步切换回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse } from 'vue/compiler-sfc'
import { normalizeSupportResistanceConfig } from '../types/support-resistance.ts'
import { normalizeSquareHeatWindows, SQUARE_HEAT_MAX_WINDOW_MINUTES } from '../types/square-heat-config.ts'
import { latestCvdDivergence } from '../app/utils/cvd-divergence.ts'
import { diTrend } from '../app/utils/environment-confidence.ts'

/** 执行实际源码，仅隔离 Nuxt 上下文、网络和图表挂载。 */
function evaluate(source, dependencies = {}, globals = {}) {
  const context = { exports: {}, require: id => dependencies[id] ?? {}, ...globals }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

/** 不启动交易进程，记录只读接口传给指标中心的实际参数。 */
function createHandler(config = {}) {
  const calls = []
  const hub = {
    getCacheStatus: () => ({ symbols: ['BTC/USDT'] }),
    getIndicators: async (symbol, timeframe, type, options) => {
      calls.push({ type, options })
      return { timestamp: Date.now(), values: { ...options } }
    },
    getKlines: () => [], getOIDiagnostics: () => ({})
  }
  const source = readFileSync(new URL('../server/api/bot/indicators.get.ts', import.meta.url), 'utf8')
  const handler = evaluate(source, {
    '../../modules/strategy-manager': { getStrategyManagerIfAvailable: () => ({ getIndicatorsHub: () => hub }) },
    '../../utils/strategy-indicators-normalizer': { getMaxOIChangePeriod: () => 10 },
    '../../utils/kline-simple-storage': { getSimpleKLineLastUpdatedAt: () => 0 },
    '../../utils/market-breadth': { getMarketBreadth: async () => ({}) },
    '../../utils/storage': { getBotConfig: async () => config },
    '../../../types/support-resistance': { normalizeSupportResistanceConfig },
    '../../../types/square-heat-config': { normalizeSquareHeatWindows, SQUARE_HEAT_MAX_WINDOW_MINUTES },
    '../../../app/utils/cvd-divergence': { latestCvdDivergence },
    '../../utils/environment-context': { loadEnvironmentContext: async () => undefined },
    '../../../app/utils/environment-confidence': { diTrend, formatEnvironmentConfidence: () => '' },
    '../../../app/utils/efficiency-ratio': { normalizeERPeriod: () => 20 }
  }, { defineEventHandler: fn => fn, getQuery: event => event }).default
  return { handler: query => handler({ symbol: 'BTCUSDT', structureOnly: 'true', includeSlowStats: 'false', ...query }), calls }
}

test('试算接口传递左右参数、约束范围，省略参数仍使用3/3', async () => {
  const { handler, calls } = createHandler()
  for (const [query, left, right] of [
    [{}, 3, 3], [{ pivotLeft: '5', pivotRight: '3' }, 5, 3],
    [{ pivotLeft: '4', pivotRight: '5' }, 4, 5],
    [{ pivotLeft: '-9', pivotRight: '999' }, 1, 10],
    [{ pivotLeft: 'bad', pivotRight: '4.9' }, 3, 4]
  ]) {
    const result = await handler(query)
    const call = calls.at(-1)
    assert.equal(call.type, 'SupportResistance')
    assert.equal(call.options.pivotLeft, left)
    assert.equal(call.options.pivotRight, right)
    assert.equal(result.data.parameters.pivotLeft, left)
    assert.equal(result.data.parameters.pivotRight, right)
  }
  assert.equal(calls.length, 5, '结构刷新不应额外加载其他指标')
})

test('情绪窗口按 K 线周期读取配置，旧配置默认24h，诊断覆盖仍有边界', async () => {
  const windows = { '5m': 300, '15m': 1200, '1h': 1500, '4h': 3000, '1d': 3600 }
  const { handler } = createHandler({ squareHeatWindows: windows })
  for (const [timeframe, minutes] of Object.entries(windows)) {
    const result = await handler({ timeframe })
    assert.equal(result.data.parameters.squareHeatWindowMinutes, minutes)
  }
  assert.equal((await createHandler().handler({})).data.parameters.squareHeatWindowMinutes, 1440)
  assert.equal((await handler({ timeframe: '5m', squareHeatWindowMinutes: '60' })).data.parameters.squareHeatWindowMinutes, 60)
  assert.equal((await handler({ squareHeatWindowMinutes: '99999' })).data.parameters.squareHeatWindowMinutes, 10000)
  assert.equal((await handler({ squareHeatWindowMinutes: '-1' })).data.parameters.squareHeatWindowMinutes, 5)
  assert.deepEqual(normalizeSquareHeatWindows({ '5m': NaN, '15m': -1, '1h': 90.9, '4h': 99999 }),
    { '5m': 1440, '15m': 5, '1h': 90, '4h': 10000, '1d': 1440 })
})

test('后台准备全部情绪窗口并去重，单个窗口失败不影响其他窗口', async () => {
  const calls = []
  const { IndicatorsHub } = evaluate(readFileSync(new URL('../server/modules/indicators/IndicatorsHub.ts', import.meta.url), 'utf8'), {
    '../../../types/square-heat-config': { normalizeSquareHeatWindows },
    './OISnapshotService': { OISnapshotService: class { async bootstrapSymbol() {} } },
    './SupportResistanceCache': { SupportResistanceCache: class {} },
    '../../utils/square-heat': { getSquareHeat: async (_symbol, minutes) => {
      calls.push(minutes)
      if (minutes === 30) throw new Error('模拟采集失败')
    } },
    '../../utils/logger': { logger: { warn() {}, error(error) { throw error } } }
  }, { Map, Set })
  const hub = new IndicatorsHub({}, { squareHeatWindows: { '5m': 30, '15m': 30, '1h': 1500, '4h': 3000, '1d': 3600 } })
  hub.getKlines = () => []
  hub.fetchAndCacheOI = async () => {}
  await hub.refreshSymbolSentiment('BTCUSDT')
  assert.deepEqual(calls, [1440, 30, 1500, 3000, 3600])
})

test('共享试算参数触发真实图表请求，快速切换时迟到结果不能覆盖新区域', async () => {
  const state = new Map()
  const store = vue.reactive({ botConfig: null })
  const { useSupportResistancePreview } = evaluate(readFileSync(new URL('../app/composables/useSupportResistancePreview.ts', import.meta.url), 'utf8'), {
    vue,
    '../stores/bot': { useBotStore: () => store },
    '../../types/support-resistance': { normalizeSupportResistanceConfig },
    '#app': { useState: (key, init) => {
      if (!state.has(key)) state.set(key, vue.ref(init()))
      return state.get(key)
    } }
  })
  const preview = useSupportResistancePreview()
  assert.equal(preview, useSupportResistancePreview(), '列表和图表应共享同一状态')
  const requests = []
  const source = parse(readFileSync(new URL('../app/components/IndicatorTrendChart.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const scope = vue.effectScope()
  try {
    const chart = scope.run(() => evaluate(source + '\nexports.probe = () => ({ snapshot, viewport }); exports.load = load;', {
      '../composables/useSupportResistancePreview': { useSupportResistancePreview },
      '../stores/bot': { useBotStore: () => ({}) }
    }, {
      ...vue, onMounted() {}, onBeforeUnmount() {},
      defineProps: () => vue.reactive({ symbol: 'BTCUSDT', timeframe: '1h' }), defineEmits: () => () => {},
      $fetch: (url, { query }) => url === '/api/kline-simple'
        ? Promise.resolve({ success: true, data: { data: [{ t: Date.now() / 1000 }] } })
        : new Promise(resolve => requests.push({ query, resolve }))
    }))
    const first = chart.load()
    assert.equal(requests[0].query.pivotLeft, 3)
    requests[0].resolve({ success: true, data: { indicators: { supportResistance: { values: { tag: '3/3' } } } } })
    await first
    preview.value = { pivotLeft: 5, pivotRight: 3 }
    await vue.nextTick()
    assert.equal(chart.probe().snapshot, undefined, '新参数生效前先清除旧区域')
    assert.equal(requests[1].query.pivotLeft, 5)
    assert.equal(requests[1].query.pivotRight, 3)
    preview.value = { pivotLeft: 5, pivotRight: 5 }
    await vue.nextTick()
    assert.equal(requests[2].query.pivotRight, 5)
    requests[2].resolve({ success: true, data: { indicators: { supportResistance: { values: { tag: '5/5' } } } } })
    await new Promise(setImmediate)
    assert.equal(chart.probe().snapshot.tag, '5/5')
    requests[1].resolve({ success: true, data: { indicators: { supportResistance: { values: { tag: '5/3' } } } } })
    await new Promise(setImmediate)
    assert.equal(chart.probe().snapshot.tag, '5/5')
    store.botConfig = { supportResistanceConfig: { pivotLeft: 4, pivotRight: 6 } }
    await vue.nextTick()
    assert.equal(preview.value.pivotLeft, 4)
    assert.equal(preview.value.pivotRight, 6)
    assert.equal(requests.at(-1).query.pivotRight, 6)
    requests.at(-1).resolve({ success: true, data: { indicators: {} } })
    await new Promise(setImmediate)

    const requestCount = requests.length
    const previousPreview = preview.value
    // 模拟全局每分钟拉回相同配置：不能再触发一轮图表请求。
    store.botConfig = { supportResistanceConfig: { pivotLeft: 4, pivotRight: 6 } }
    await vue.nextTick()
    assert.equal(preview.value, previousPreview, '等值配置轮询应保留共享试算对象')
    assert.equal(requests.length, requestCount, '等值配置轮询不应重复加载图表')
    preview.value = { pivotLeft: 4, pivotRight: 6 }
    await vue.nextTick()
    assert.equal(requests.length, requestCount, '等值试算对象替换不应重复加载图表')

    preview.value = { pivotLeft: 5, pivotRight: 6 }
    await vue.nextTick()
    assert.equal(requests.length, requestCount + 1, '真实参数变化仍应立即加载')
    requests.at(-1).resolve({ success: true, data: { indicators: {} } })
    await new Promise(setImmediate)
    store.botConfig = { supportResistanceConfig: { pivotLeft: 4, pivotRight: 6 } }
    await vue.nextTick()
    assert.equal(preview.value.pivotLeft, 5, '等值全局配置轮询不应覆盖页面临时试算')
    assert.equal(requests.length, requestCount + 1)
  } finally { scope.stop() }
})

test('全局参数作为接口默认值，页面左右确认仍可分别覆盖', async () => {
  const { handler, calls } = createHandler({ supportResistanceConfig: { pivotLeft: 5, pivotRight: 4 } })
  await handler({})
  assert.equal(calls.at(-1).options.pivotLeft, 5)
  assert.equal(calls.at(-1).options.pivotRight, 4)
  await handler({ pivotLeft: '6' })
  assert.equal(calls.at(-1).options.pivotLeft, 6)
  assert.equal(calls.at(-1).options.pivotRight, 4)
})

test('指标中心随全局配置热更新，策略独立参数仍优先', async () => {
  const source = readFileSync(new URL('../server/modules/indicators/IndicatorsHub.ts', import.meta.url), 'utf8')
  const builds = []
  const { IndicatorsHub } = evaluate(source, {
    '../../../types/support-resistance': { normalizeSupportResistanceConfig },
    './SupportResistanceCalculator': { calculateSupportResistance: (_bars, _tf, _ms, options) => { builds.push(options); return options } },
    './SupportResistanceCache': { SupportResistanceCache: class { get(_key, _price, _now, build) { return build() } } },
    './OISnapshotService': { OISnapshotService: class {} },
    '../../utils/stable-hash': { shortHash: JSON.stringify },
    '../../utils/logger': { logger: { info() {}, warn() {} } },
    '../../utils/binance-api-gateway': { binanceApiGateway: { updateConfig() {} } }
  }, { Map, Set })
  const hub = new IndicatorsHub({}, {})
  await hub.getIndicators('BTCUSDT', '1h', 'SupportResistance', {}, [])
  assert.equal(builds.at(-1).pivotLeft, 3)
  hub.updateConfig({ supportResistanceConfig: { pivotLeft: 5, pivotRight: 4 } })
  await hub.getIndicators('BTCUSDT', '1h', 'SupportResistance', {}, [])
  assert.equal(builds.at(-1).pivotLeft, 5)
  assert.equal(builds.at(-1).pivotRight, 4)
  await hub.getIndicators('BTCUSDT', '1h', 'SupportResistance', { pivotRight: 2 }, [])
  assert.equal(builds.at(-1).pivotLeft, 5)
  assert.equal(builds.at(-1).pivotRight, 2)
})

test('旧配置与非法确认根数统一归一化为有效整数', () => {
  assert.deepEqual(normalizeSupportResistanceConfig(), { pivotLeft: 3, pivotRight: 3 })
  assert.deepEqual(normalizeSupportResistanceConfig({ pivotLeft: NaN, pivotRight: null }), { pivotLeft: 3, pivotRight: 3 })
  assert.deepEqual(normalizeSupportResistanceConfig({ pivotLeft: -5, pivotRight: 20.5 }), { pivotLeft: 1, pivotRight: 10 })
})
