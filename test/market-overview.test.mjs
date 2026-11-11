// ==================== 市场概览统计、详情计算与请求竞态验证 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import * as contractAssets from '../app/utils/contract-assets.ts'

/** 运行侧栏真实脚本并替换网络，测试不访问币安或本地数据库。 */
function panel(rows, fetcher = async () => ({ success: true, data: { data: [] } })) {
  const file = fs.readFileSync(new URL('../app/components/MarketOverviewPanel.vue', import.meta.url), 'utf8')
  const source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const props = vue.reactive({ rows, selected: rows[0], scopeLabel: '测试' })
  const cleanup = []
  const context = {
    exports: {}, console, AbortController, setInterval, clearInterval,
    defineProps: () => props, defineEmits: () => () => {}, $fetch: fetcher,
    require: id => id === '../utils/contract-assets' ? contractAssets : ({ ...vue, onMounted: () => {}, onBeforeUnmount: callback => cleanup.push(callback) }),
  }
  vm.runInNewContext(ts.transpile(source + '\nglobalThis.api = { summary, hourly, movers, rangePosition, candles, chartLoading, chartBars };', {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }), context)
  return { ...context.api, props, dispose: () => cleanup.forEach(callback => callback()) }
}

const row = (symbol, change, hourly) => ({ symbol, price: 10, volume: 100, priceChangePercent: change, priceChangePercent1h: hourly, fundingRate: 0, onboardDate: 0 })

test('市场宽度排除缺失值，异动榜只纳入有方向的有效1h样本', () => {
  const api = panel([row('A', 2, 3), row('B', -1, -2), row('C', 0, 0), row('D', null, null), row('E', NaN, undefined)])
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(api.summary.value)), { up: 1, down: 1, flat: 1, valid: 3, volume: 500 })
    assert.equal(api.hourly.value.length, 3)
    assert.deepEqual(Array.from(api.movers.value[0].rows, item => item.symbol), ['A'])
    assert.deepEqual(Array.from(api.movers.value[1].rows, item => item.symbol), ['B'])
  } finally { api.dispose() }
})

test('价格区间使用有效字段，无有效区间时显示占位状态', () => {
  const api = panel([{ ...row('A', 2, 3), high24h: 12, low24h: 8, open24h: 10, nextFundingTime: 1 }])
  try {
    assert.equal(api.rangePosition.value, 50)
    api.props.selected = { ...row('A', 2, 3), high24h: 10, low24h: 10 }
    assert.equal(api.rangePosition.value, null)
  } finally { api.dispose() }
})

test('快速切换交易对后，旧本地K线响应不能覆盖新详情', async () => {
  const requests = []
  const api = panel([row('A', 1, 1)], (url, options) => new Promise(resolve => { requests.push({ url, options, resolve }) }))
  try {
    api.props.selected = row('B', 1, 1)
    await vue.nextTick()
    assert.equal(requests.length, 2)
    assert.equal(requests[0].options.signal.aborted, true)
    assert.equal(requests[1].url, '/api/kline-simple')
    assert.equal(requests[1].options.query.symbol, 'B')
    assert.equal(requests[1].options.query.timeframe, '1d')
    assert.equal(requests[1].options.query.limit, 30)
    assert.equal(requests[1].options.query.to - requests[1].options.query.from, 29 * 86400)
    assert.equal(requests[1].options.query.to % 86400, 0)
    const bar = { t: requests[1].options.query.from, o: 10, c: 11, h: 12, l: 9, v: 1 }
    requests[1].resolve({ success: true, data: { data: [bar] } })
    await new Promise(resolve => setImmediate(resolve))
    requests[0].resolve({ success: true, data: { data: [{ ...bar, c: 9 }] } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(api.candles.value[0].c, 11)
    assert.equal(api.chartLoading.value, false)
  } finally { api.dispose() }
})

test('30日日线保留缺失日期空白，按日期排序并剔除窗口外数据', async () => {
  const api = panel([row('A', 1, 1)], async (_url, { query }) => {
    const candle = t => ({ t, o: 10, c: 11, h: 12, l: 9, v: 1 })
    return { success: true, data: { data: [
      candle(query.to), candle(query.from + 2 * 86400), candle(query.from), candle(query.from - 86400),
    ] } }
  })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(api.candles.value.length, 3)
    const bars = api.chartBars.value
    assert.equal(bars[0].x, 8)
    assert.equal(bars[1].x, 8 + 2 * 344 / 29)
    assert.equal(bars[2].x, 352)
  } finally { api.dispose() }
})

test('行情榜和侧栏的Vue脚本、模板均能编译', () => {
  for (const path of ['components/TopSymbolsTable', 'components/MarketOverviewPanel', 'components/PriceHeatmap', 'pages/hot']) {
    const name = path.split('/').pop()
    const source = fs.readFileSync(new URL(`../app/${path}.vue`, import.meta.url), 'utf8')
    const parsed = parse(source)
    assert.equal(parsed.errors.length, 0)
    const script = compileScript(parsed.descriptor, { id: name })
    const template = compileTemplate({ source: parsed.descriptor.template.content, filename: `${name}.vue`, id: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})
