// ==================== 持续放量客户端缓存与非阻塞展示回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

/** 执行组件实际脚本，注入请求和页面状态，验证真实加载流程。 */
function component(fetcher, state = vue.ref({}), props = {}, storage = new Map(), curveFetcher = async () => ({ success: true, data: {} })) {
  const file = fs.readFileSync(new URL('../app/components/TopSymbolsTable.vue', import.meta.url), 'utf8')
  const source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const mounted = []
  const context = {
    exports: {}, console, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    defineProps: () => ({ modelValue: false, selectable: false, embedded: false, ...props }),
    withDefaults: props => props,
    defineEmits: () => () => {},
    defineExpose: () => {},
    useState: () => state,
    $fetch: (url, options) => url === '/api/binance/local-price-curves' ? curveFetcher(url, options) : fetcher(url, options),
    require(id) {
      if (id === 'vue') return { ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: () => {} }
      if (id === 'element-plus') return { ElDialog: {}, ElDrawer: {} }
      if (id === '../composables/useCoinIcon') return { useCoinIcon: () => ({ getCoinIconUrl: () => '' }) }
      throw new Error(`Unexpected import: ${id}`)
    },
  }
  const expose = '\nglobalThis.api = { mode, data, loading, updatedAt, showingCachedResult, fetchData, stopProgressPolling, handleRowClick, detailSymbol, locateSymbol, currentPage, search, tableViewportHeight, rowPadding, pageSize, tableRef, viewMode, heatmapItems, selectHeatmapSymbol, assetType, toggleFavorite, isFavoriteSymbol, sortedData, pagedData, overviewRows, overviewScope, localCurves, curvePaths };'
  vm.runInNewContext(ts.transpile(source + expose, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  mounted.forEach(callback => callback())
  return context.api
}

const result = { success: true, mode: 'stable', updatedAt: 12345, data: [{ symbol: 'BTCUSDT', volume: 100 }] }

test('曲线按真实时间保留空白和缺口，平价序列无无效坐标', () => {
  const api = component(async () => result)
  const paths = api.curvePaths({ from: 0, to: 100, intervalSeconds: 10, points: [[50, 10], [60, 10], [90, 10]] })
  assert.equal(paths.length, 2)
  assert.equal(paths[0], '66.00,12.00 78.80,12.00 ')
  assert.equal(paths[1], '117.20,12.00 ')
})

test('只读取当前页本地曲线，快速翻页的旧响应不能覆盖新页', async () => {
  const pending = []
  const api = component(async () => ({ success: true, data: [] }), vue.ref({}), { embedded: true }, new Map(),
    (_url, options) => new Promise(resolve => pending.push({ options, resolve })))
  await new Promise(resolve => setImmediate(resolve))
  api.data.value = Array.from({ length: 21 }, (_, index) => ({ symbol: `COIN${index}USDT`, volume: 100 - index }))
  await vue.nextTick()
  assert.equal(pending[0].options.query.symbols.split(',').length, 20)
  api.currentPage.value = 2
  await vue.nextTick()
  assert.equal(pending[0].options.signal.aborted, true)
  assert.equal(pending[1].options.query.symbols, 'COIN20USDT')
  pending[1].resolve({ success: true, data: { COIN20USDT: { points: [[1, 1], [2, 2]] } } })
  await new Promise(resolve => setImmediate(resolve))
  pending[0].resolve({ success: true, data: { COIN0USDT: { points: [[1, 1], [2, 2]] } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(api.localCurves.value.COIN20USDT)
  assert.equal(api.localCurves.value.COIN0USDT, undefined)
  api.viewMode.value = 'heatmap'
  await vue.nextTick()
  assert.equal(pending.length, 2)
})

test('收藏标准化且刷新后恢复，损坏存储或写入失败不阻断切换', () => {
  const storage = new Map()
  const api = component(async () => result, vue.ref({}), {}, storage)
  api.toggleFavorite(' btc/usdt ')
  assert.equal(api.isFavoriteSymbol('BTCUSDT'), true)
  const restored = component(async () => result, vue.ref({}), {}, storage)
  assert.equal(restored.isFavoriteSymbol('btc/usdt'), true)
  restored.toggleFavorite('BTCUSDT')
  assert.equal(restored.isFavoriteSymbol('BTCUSDT'), false)
  assert.equal(storage.get('market-favorite-symbols'), '[]')
  storage.set('market-favorite-symbols', '{bad json')
  const corrupted = component(async () => result, vue.ref({}), {}, storage)
  assert.equal(corrupted.isFavoriteSymbol('BTCUSDT'), false)
  const disabled = component(async () => result, vue.ref({}), {}, {
    get: () => { throw new Error('disabled') }, set: () => { throw new Error('disabled') },
  })
  disabled.toggleFavorite('ETHUSDT')
  assert.equal(disabled.isFavoriteSymbol('ETHUSDT'), true)
})

test('收藏列表加载全量行情，筛选搜索排序与概览仅包含收藏', async () => {
  const queries = []
  const rows = [
    { symbol: 'BTCUSDT', volume: 100, contractType: 'PERPETUAL' },
    { symbol: 'ETHUSDT', volume: 300, contractType: 'PERPETUAL' },
    { symbol: 'STOCKUSDT', volume: 200, contractType: 'TRADIFI_PERPETUAL' },
  ]
  const api = component(async (url, options) => {
    if (url === '/api/market/config') return { success: true, data: { symbols: [] } }
    queries.push(options.query)
    return { success: true, data: rows }
  })
  api.toggleFavorite('BTCUSDT')
  api.toggleFavorite('STOCKUSDT')
  api.mode.value = 'favorites'
  await api.fetchData()
  assert.equal(queries[0].mode, 'hot')
  assert.deepEqual(Array.from(api.sortedData.value, row => row.symbol), ['STOCKUSDT', 'BTCUSDT'])
  assert.match(api.overviewScope.value, /收藏列表/)
  api.search.value = 'btc/usdt'
  assert.equal(api.sortedData.value.length, 1)
  assert.equal(api.overviewRows.value.length, 2)
  api.assetType.value = 'tradfi'
  assert.equal(api.sortedData.value.length, 0)
  assert.equal(api.heatmapItems.value[0].symbol, 'STOCKUSDT')
  api.search.value = ''
  api.toggleFavorite('STOCKUSDT')
  assert.equal(api.sortedData.value.length, 0)
  assert.equal(api.overviewRows.value.length, 0)
  assert.equal(queries.length, 1)
})

test('收藏末页删除最后一行时回退到有效页', async () => {
  const api = component(async () => result, vue.ref({}), { embedded: true })
  await new Promise(resolve => setImmediate(resolve))
  api.data.value = Array.from({ length: 21 }, (_, index) => ({ symbol: `COIN${index}USDT`, volume: 100 - index }))
  api.data.value.forEach(row => api.toggleFavorite(row.symbol))
  api.mode.value = 'favorites'
  await vue.nextTick()
  api.currentPage.value = 2
  assert.equal(api.pagedData.value.length, 1)
  api.toggleFavorite('COIN20USDT')
  await vue.nextTick()
  assert.equal(api.currentPage.value, 1)
  assert.equal(api.pagedData.value.length, 20)
})

test('热力图复用全量榜单，搜索不截断区块，选择及切换视图不增加请求', async () => {
  let requests = 0
  const api = component(async () => { requests++; return { success: true, data: [] } }, vue.ref({}), { embedded: true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    const before = requests
    api.data.value = [
      { symbol: 'BTCUSDT', volume: 100, price: 10, priceChangePercent: 2, contractType: 'PERPETUAL' },
      { symbol: 'STOCKUSDT', volume: 200, price: 20, priceChangePercent: null, contractType: 'TRADIFI_PERPETUAL' },
    ]
    api.viewMode.value = 'heatmap'
    api.search.value = 'BTC'
    assert.equal(api.heatmapItems.value.length, 2)
    assert.equal(api.heatmapItems.value[1].change, null)
    assert.equal(api.heatmapItems.value[1].volume, 200)
    api.selectHeatmapSymbol('STOCKUSDT')
    assert.equal(api.detailSymbol.value.symbol, 'STOCKUSDT')
    assert.equal(api.search.value, 'BTC')
    await api.locateSymbol('STOCKUSDT')
    assert.equal(api.search.value, '')
    assert.equal(api.viewMode.value, 'heatmap')
    api.assetType.value = 'crypto'
    assert.equal(api.heatmapItems.value.length, 1)
    api.viewMode.value = 'table'
    await vue.nextTick()
    assert.equal(requests, before)
  } finally { api.stopProgressPolling() }
})

test('行高随表格可用高度伸展，大分页保持最小行高且超高屏幕不无限拉伸', () => {
  const api = component(async () => result)
  api.tableViewportHeight.value = 641
  assert.equal(api.rowPadding.value, 4.5)
  api.pageSize.value = 50
  assert.equal(api.rowPadding.value, 2)
  api.pageSize.value = 20
  api.tableViewportHeight.value = 2000
  assert.equal(api.rowPadding.value, 8.5)
})

test('独立页点击行切换详情，异动定位清除搜索并跳到所在页', async () => {
  const api = component(async () => ({ success: true, data: [] }), vue.ref({}), { embedded: true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    api.data.value = Array.from({ length: 45 }, (_, index) => ({ symbol: `COIN${index}USDT`, volume: 100 - index }))
    api.handleRowClick(api.data.value[2])
    assert.equal(api.detailSymbol.value.symbol, 'COIN2USDT')
    api.search.value = 'COIN2'
    await api.locateSymbol('COIN44USDT')
    assert.equal(api.search.value, '')
    assert.equal(api.currentPage.value, 3)
    assert.equal(api.detailSymbol.value.symbol, 'COIN44USDT')
  } finally { api.stopProgressPolling() }
})

test('配置标记请求未结束时，缓存行情也能立即展示并结束加载', async () => {
  const api = component(url => url === '/api/market/config' ? new Promise(() => {}) : Promise.resolve(result))
  api.mode.value = 'stable'
  try {
    await api.fetchData()
    assert.equal(api.loading.value, false)
    assert.equal(api.data.value[0].symbol, 'BTCUSDT')
  } finally {
    api.stopProgressPolling()
  }
})

test('跨页和同页定位均显式高亮并滚动，重复点击仍能重新定位', async () => {
  const api = component(async () => ({ success: true, data: [] }), vue.ref({}), { embedded: true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    api.data.value = Array.from({ length: 100 }, (_, index) => ({ symbol: `COIN${index}USDT`, volume: 100 - index }))
    api.pageSize.value = 50
    await vue.nextTick()
    const highlighted = []
    const scrolls = []
    const viewport = { scrollTop: 100, clientHeight: 200, getBoundingClientRect: () => ({ top: 100 }), scrollTo: options => scrolls.push(options.top) }
    const rows = Array.from({ length: 50 }, (_, index) => ({ getBoundingClientRect: () => ({ top: 100 + index * 30 - viewport.scrollTop, height: 30 }) }))
    api.tableRef.value = {
      setCurrentRow: row => highlighted.push(row.symbol),
      $el: { querySelector: () => viewport, querySelectorAll: () => rows },
    }
    await api.locateSymbol('COIN94USDT')
    assert.equal(api.currentPage.value, 2)
    assert.equal(highlighted.at(-1), 'COIN94USDT')
    assert.equal(scrolls.at(-1), 44 * 30 - 85)
    await api.locateSymbol('COIN51USDT')
    assert.equal(api.currentPage.value, 2)
    assert.equal(highlighted.at(-1), 'COIN51USDT')
    assert.equal(scrolls.at(-1), 0)
    await api.locateSymbol('COIN51USDT')
    assert.equal(scrolls.length, 3)
    await Promise.all([api.locateSymbol('COIN94USDT'), api.locateSymbol('COIN2USDT')])
    assert.equal(api.currentPage.value, 1)
    assert.equal(highlighted.at(-1), 'COIN2USDT')
    assert.equal(highlighted.length, 4)
  } finally { api.stopProgressPolling() }
})

test('重进页面先展示相同参数的结果，核对请求未完成时不遮挡表格', async () => {
  const state = vue.ref({})
  const first = component(url => Promise.resolve(url === '/api/market/config' ? { success: true, data: { symbols: [] } } : result), state)
  first.mode.value = 'stable'
  await first.fetchData()
  let release
  const pending = new Promise(resolve => { release = resolve })
  const next = component(url => url === '/api/market/config' ? Promise.resolve({ success: true }) : pending, state)
  next.mode.value = 'stable'
  try {
    const request = next.fetchData()
    assert.equal(next.loading.value, true)
    assert.equal(next.showingCachedResult.value, true)
    assert.equal(next.data.value[0].symbol, 'BTCUSDT')
    assert.equal(next.updatedAt.value, 12345)
    release({ ...result, updatedAt: 54321 })
    await request
    assert.equal(next.updatedAt.value, 54321)
    assert.equal(next.loading.value, false)
  } finally {
    next.stopProgressPolling()
  }
})
