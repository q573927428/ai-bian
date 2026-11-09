// ==================== 持续放量客户端缓存与非阻塞展示回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

/** 执行组件实际脚本，注入请求和页面状态，验证真实加载流程。 */
function component(fetcher, state = vue.ref({}), props = {}) {
  const file = fs.readFileSync(new URL('../app/components/TopSymbolsTable.vue', import.meta.url), 'utf8')
  const source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = {
    exports: {}, console, AbortController, setTimeout, clearTimeout,
    defineProps: () => ({ modelValue: false, selectable: false, embedded: false, ...props }),
    withDefaults: props => props,
    defineEmits: () => () => {},
    defineExpose: () => {},
    useState: () => state,
    $fetch: fetcher,
    require(id) {
      if (id === 'vue') return { ...vue, onBeforeUnmount: () => {} }
      if (id === 'element-plus') return { ElDialog: {}, ElDrawer: {} }
      if (id === '../composables/useCoinIcon') return { useCoinIcon: () => ({ getCoinIconUrl: () => '' }) }
      throw new Error(`Unexpected import: ${id}`)
    },
  }
  const expose = '\nglobalThis.api = { mode, data, loading, updatedAt, showingCachedResult, fetchData, stopProgressPolling, handleRowClick, detailSymbol, locateSymbol, currentPage, search, tableViewportHeight, rowPadding, pageSize, tableRef, viewMode, heatmapItems, selectHeatmapSymbol, assetType };'
  vm.runInNewContext(ts.transpile(source + expose, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return context.api
}

const result = { success: true, mode: 'stable', updatedAt: 12345, data: [{ symbol: 'BTCUSDT', volume: 100 }] }

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
