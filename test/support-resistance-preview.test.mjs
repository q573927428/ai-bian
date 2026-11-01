// ==================== 支撑阻力页面试算参数与异步切换回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse } from 'vue/compiler-sfc'

/** 执行实际源码，仅隔离 Nuxt 上下文、网络和图表挂载。 */
function evaluate(source, dependencies = {}, globals = {}) {
  const context = { exports: {}, require: id => dependencies[id] ?? {}, ...globals }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

/** 不启动交易进程，记录只读接口传给指标中心的实际参数。 */
function createHandler() {
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
    '../../utils/storage': { getBotConfig: async () => ({}) },
    '../../utils/environment-context': { loadEnvironmentContext: async () => undefined },
    '../../../app/utils/environment-confidence': { formatEnvironmentConfidence: () => '' },
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

test('共享试算参数触发真实图表请求，快速切换时迟到结果不能覆盖新区域', async () => {
  const state = new Map()
  const { useSupportResistancePreview } = evaluate(readFileSync(new URL('../app/composables/useSupportResistancePreview.ts', import.meta.url), 'utf8'), {
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
  } finally { scope.stop() }
})
