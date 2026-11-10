// ==================== 图表历史分页、刷新合并与请求隔离回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { mergeKlineHistory } from '../app/utils/kline-history.ts'
import { restoreKlineHistoryCache, saveKlineHistoryCache, KLINE_HISTORY_CACHE_TTL } from '../app/utils/kline-history-cache.ts'

const bar = (t, c = t) => ({ t, o: c, h: c, l: c, c, v: 1 })

/** 模拟浏览器持久存储，跨组件实例共享数据，不访问实际用户缓存。 */
function memoryStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  }
}

/** 执行组件真实加载函数，用可控请求模拟连续点击、轮询和切换上下文。 */
function fixture() {
  const source = parse(readFileSync(new URL('../app/components/kline-chart/KLineChartSimple.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = ts.createSourceFile('chart.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter(statement =>
    (ts.isFunctionDeclaration(statement) && ['loadEarlierKlines', 'persistHistoryCache'].includes(statement.name?.text))
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(ast) === 'loadKLineData')))
  assert.equal(declarations.length, 3)
  const storage = memoryStorage()
  const state = {
    props: { symbol: 'BTCUSDT' }, selectedTimeframe: ref('5m'), timeline: ref(false),
    klineData: ref([bar(3000), bar(3300)]), earlierLoading: ref(false), hasEarlier: ref(true),
    earlierError: ref(''), historyExpanded: ref(false), loading: ref(false), error: ref(''), meta: ref({}),
    historyCacheScope: ref('BTCUSDT:5m:live'), historyCacheExpiresAt: ref(0), storage,
    saveKlineHistoryCache: (...args) => saveKlineHistoryCache(...args, Date.now(), storage),
    restoreKlineHistoryCache: (...args) => restoreKlineHistoryCache(...args, Date.now(), storage),
    getTimeframeSeconds: () => 300,
    historyRequests: [], live: [bar(3300, 99), bar(3600)],
    loadTradeHistory: async () => {}, showLatestKline() {}, hideTooltip() {},
    showScanMarkers: ref(false), loadScanResults() {}, mergeKlineHistory, URLSearchParams, AbortSignal,
    console: { error() {} },
    $fetch: async (_url, options) => {
      state.historyRequests.push(options.query)
      return state.reply
    },
    fetch: async () => ({ ok: true, json: async () => ({ success: true, data: { data: state.live, meta: {} } }) }),
    reply: { success: true, data: [bar(2400), bar(2700)], hasMore: true }
  }
  const context = vm.createContext(state)
  const compiled = ts.transpileModule('let earlierGeneration = 0, requestGeneration = 0, provisionalKlineTimestamp = null, provisionalReloadRequestedAt = 0;\n'
    + declarations.map(statement => statement.getText(ast)).join('\n')
    + '\nglobalThis.loadEarlier = loadEarlierKlines; globalThis.refresh = loadKLineData; globalThis.invalidate = () => { earlierGeneration++; earlierLoading.value = false; }; globalThis.invalidateAll = () => { requestGeneration++; };', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  })
  vm.runInContext(compiled.outputText, context)
  return state
}

test('连续分页使用新的最早时间，自动刷新保留历史并校正重复行情', async () => {
  const state = fixture()
  await state.loadEarlier()
  assert.equal(state.historyRequests[0].before, 3000)
  state.reply = { success: true, data: [bar(1800), bar(2100)], hasMore: true }
  await state.loadEarlier()
  assert.equal(state.historyRequests[1].before, 2400)
  await state.refresh(true)
  assert.deepEqual(state.klineData.value.map(item => item.t), [1800, 2100, 2400, 2700, 3000, 3300, 3600])
  assert.equal(state.klineData.value.find(item => item.t === 3300).c, 99)
})

test('加载期间阻止重复点击，切换上下文后丢弃在途响应', async () => {
  const state = fixture()
  let resolve
  state.reply = new Promise(done => { resolve = done })
  const pending = state.loadEarlier()
  await state.loadEarlier()
  assert.equal(state.historyRequests.length, 1)
  state.invalidate()
  state.klineData.value = [bar(9000)]
  resolve({ success: true, data: [bar(2400)], hasMore: true })
  await pending
  assert.deepEqual(state.klineData.value.map(item => item.t), [9000])
})

test('失败保留图表并允许重试，历史耗尽后停止请求', async () => {
  const state = fixture()
  state.$fetch = async () => { throw new Error('timeout') }
  await state.loadEarlier()
  assert.equal(state.klineData.value.length, 2)
  assert.ok(state.earlierError.value)
  assert.equal(state.earlierLoading.value, false)
  state.$fetch = async () => ({ success: true, data: [], hasMore: false })
  await state.loadEarlier()
  assert.equal(state.hasEarlier.value, false)
  assert.equal(state.earlierError.value, '')
})

test('历史加载完成后，普通刷新失败仍保留已加载数据', async () => {
  const state = fixture()
  await state.loadEarlier()
  state.fetch = async () => ({ ok: true, json: async () => ({ success: false, message: '暂时不可用' }) })
  await state.refresh()
  assert.deepEqual(state.klineData.value.map(item => item.t), [2400, 2700, 3000, 3300])
  assert.equal(state.loading.value, false)
})

test('网页刷新后先取最新行情，再恢复缓存历史；跨周期保留已裁剪的一根', async () => {
  const state = fixture()
  await state.loadEarlier()
  const expiry = state.historyCacheExpiresAt.value
  state.klineData.value = []
  state.historyExpanded.value = false
  state.historyCacheExpiresAt.value = 0
  await state.refresh()
  assert.deepEqual(state.klineData.value.map(item => item.t), [2400, 2700, 3000, 3300, 3600])
  assert.equal(state.klineData.value.find(item => item.t === 3300).c, 99)
  assert.equal(state.historyCacheExpiresAt.value, expiry)
})

test('老订单本地无数据时自动定位开仓时段，随后仍可继续向前加载', async () => {
  const state = fixture()
  state.props.historicalOrder = { openTime: 3000000 }
  state.live = []
  state.reply = { success: true, data: [bar(2700), bar(3000), bar(3300)], hasMore: true }
  await state.refresh()
  assert.equal(state.historyRequests[0].before, 33000)
  assert.deepEqual(state.klineData.value.map(item => item.t), [2700, 3000, 3300])
  assert.equal(state.error.value, '')
  assert.equal(state.loading.value, false)
  state.reply = { success: true, data: [bar(2400)], hasMore: true }
  await state.loadEarlier()
  assert.equal(state.historyRequests[1].before, 2700)
  assert.deepEqual(state.klineData.value.map(item => item.t), [2400, 2700, 3000, 3300])
})

test('本地已有入场时段时无需查询交易所', async () => {
  const state = fixture()
  state.props.historicalOrder = { openTime: 3300000 }
  await state.refresh()
  assert.equal(state.historyRequests.length, 0)
  assert.equal(state.error.value, '')
})

test('交易所仍无入场时段时显示错误并可重试，不用错误时段冒充订单行情', async () => {
  const state = fixture()
  state.props.historicalOrder = { openTime: 3000000 }
  state.live = []
  await state.refresh()
  assert.match(state.error.value, /交易所未返回/)
  assert.equal(state.klineData.value.length, 0)
  state.reply = { success: true, data: [bar(2700), bar(3000)], hasMore: true }
  await state.refresh()
  assert.equal(state.error.value, '')
  assert.equal(state.klineData.value.length, 2)
})

test('交易所补取过程中切换图表后，旧订单响应不能写入新图表', async () => {
  const state = fixture()
  state.props.historicalOrder = { openTime: 3000000 }
  state.live = []
  let resolve
  state.reply = new Promise(done => { resolve = done })
  const pending = state.refresh()
  // 等待本地查询完成、进入交易所补取阶段。
  while (!state.historyRequests.length) await Promise.resolve()
  state.invalidateAll()
  state.klineData.value = [bar(9000)]
  resolve({ success: true, data: [bar(3000)], hasMore: true })
  await pending
  assert.deepEqual(state.klineData.value.map(item => item.t), [9000])
})

test('30分钟固定过期，普通同步写缓存不续期，过期后不再恢复', () => {
  const storage = memoryStorage()
  const now = 1000000
  const expiry = saveKlineHistoryCache('BTCUSDT:5m', [bar(300), bar(600), bar(900)], true, 0, now, storage)
  assert.equal(expiry, now + KLINE_HISTORY_CACHE_TTL)
  assert.equal(saveKlineHistoryCache('BTCUSDT:5m', [bar(300), bar(600), bar(900)], true, expiry, now + 120000, storage), expiry)
  const restored = restoreKlineHistoryCache('BTCUSDT:5m', [bar(900, 99), bar(1200)], 300, now + 120000, storage)
  assert.deepEqual(restored.data.map(item => item.t), [300, 600, 900, 1200])
  assert.equal(restored.data[2].c, 99)
  assert.equal(restoreKlineHistoryCache('BTCUSDT:5m', [bar(900)], 300, expiry, storage), null)
  assert.equal(storage.length, 0)
})

test('不同交易对和周期缓存隔离，历史与服务器有缺口时丢弃缓存', () => {
  const storage = memoryStorage()
  saveKlineHistoryCache('BTCUSDT:5m', [bar(300), bar(600)], false, 0, 1000000, storage)
  assert.equal(restoreKlineHistoryCache('ETHUSDT:5m', [bar(900)], 300, 1000001, storage), null)
  assert.equal(restoreKlineHistoryCache('BTCUSDT:15m', [bar(900)], 900, 1000001, storage), null)
  assert.equal(restoreKlineHistoryCache('BTCUSDT:5m', [bar(1200)], 300, 1000001, storage), null)
  assert.equal(storage.length, 0)
})

test('损坏或不可用的浏览器存储不影响图表，缓存空间有上限', () => {
  const storage = memoryStorage()
  storage.setItem('kline-history:v1:broken', '{invalid')
  assert.equal(restoreKlineHistoryCache('broken', [bar(900)], 300, 1000000, storage), null)
  assert.equal(storage.length, 0)
  const denied = { get length() { throw new Error('storage disabled') } }
  assert.doesNotThrow(() => saveKlineHistoryCache('blocked', [bar(300)], true, 0, 1000000, denied))
  assert.equal(restoreKlineHistoryCache('blocked', [bar(900)], 300, 1000000, denied), null)
  for (let i = 0; i < 8; i++) saveKlineHistoryCache(`symbol${i}`, [bar(300)], true, 0, 1000000 + i, storage)
  assert.equal(storage.length, 5)
  saveKlineHistoryCache('large', Array.from({ length: 5100 }, (_, i) => bar((i + 1) * 300)), false, 0, 1000010, storage)
  const restored = restoreKlineHistoryCache('large', [bar(5100 * 300)], 300, 1000011, storage)
  assert.equal(restored.data.length, 5000)
  assert.equal(restored.hasEarlier, true)
})

/** 隔离网络执行实际接口，验证秒/毫秒边界和固定分页数量。 */
function earlierHandler(gateway) {
  const source = readFileSync(new URL('../server/api/kline-simple/earlier.get.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .*;\r?\n/gm, '').replace('export default ', 'return ')
  return new Function('binanceApiGateway', 'defineEventHandler', 'getQuery', 'createError', compiled)(
    gateway, handler => handler, event => event, error => Object.assign(new Error(error.message), error))
}

test('历史接口固定499根，严格排除最早一根，不写同步存储', async () => {
  let requested
  const handler = earlierHandler({ fetchJson: async (_group, _key, url) => {
    requested = new URL(url)
    return [[2700000, '1', '2', '0.5', '1.5', '3', 0, '4', 0, 0, '2']]
  } })
  const result = await handler({ symbol: 'BTC/USDT', timeframe: '5m', before: '3000' })
  assert.equal(requested.searchParams.get('limit'), '499')
  assert.equal(requested.searchParams.get('endTime'), '2999999')
  assert.equal(requested.searchParams.get('symbol'), 'BTCUSDT')
  assert.equal(result.data[0].t, 2700)
  assert.equal(result.data[0].bq, 2)
  assert.equal(result.hasMore, false)
  await assert.rejects(handler({ symbol: 'BTCUSDT', timeframe: '1s', before: 3000 }), { statusCode: 400 })
})
