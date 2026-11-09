// ==================== 持续放量客户端缓存与非阻塞展示回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

/** 执行组件实际脚本，注入请求和页面状态，验证真实加载流程。 */
function component(fetcher, state = vue.ref({})) {
  const file = fs.readFileSync(new URL('../app/components/TopSymbolsTable.vue', import.meta.url), 'utf8')
  const source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = {
    exports: {}, console, AbortController, setTimeout, clearTimeout,
    defineProps: () => ({ modelValue: false, selectable: false, embedded: false }),
    withDefaults: props => props,
    defineEmits: () => () => {},
    useState: () => state,
    $fetch: fetcher,
    require(id) {
      if (id === 'vue') return { ...vue, onBeforeUnmount: () => {} }
      if (id === 'element-plus') return { ElDialog: {}, ElDrawer: {} }
      if (id === '../composables/useCoinIcon') return { useCoinIcon: () => ({ getCoinIconUrl: () => '' }) }
      throw new Error(`Unexpected import: ${id}`)
    },
  }
  const expose = '\nglobalThis.api = { mode, data, loading, updatedAt, showingCachedResult, fetchData, stopProgressPolling };'
  vm.runInNewContext(ts.transpile(source + expose, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return context.api
}

const result = { success: true, mode: 'stable', updatedAt: 12345, data: [{ symbol: 'BTCUSDT', volume: 100 }] }

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
