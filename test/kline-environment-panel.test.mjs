// ==================== K 线环境标签的请求与联动回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'

test('环境详情仅在显示时查询当前标的和周期，且不会被旧响应覆盖', async () => {
  const component = readFileSync(new URL('../app/components/KLineEnvironmentPanel.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const panelLogic = script.slice(script.indexOf('const now = ')).replaceAll('import.meta.client', 'true')
  const props = reactive({ active: false, symbol: 'BTCUSDT', timeframe: '1h' })
  const requests = []
  const timers = new Set()
  const scope = effectScope()
  const harness = vm.createContext({
    props, computed, ref, shallowRef, watch, AbortController,
    $fetch: (url, options) => new Promise(resolve => requests.push({ url, ...options, resolve })),
    useGlobalPolling: (_refresh, enabled) => { harness.pollingEnabled = enabled },
    setInterval: () => { const id = Symbol(); timers.add(id); return id },
    clearInterval: id => timers.delete(id)
  })
  scope.run(() => vm.runInContext(ts.transpile(`
    ${panelLogic}
    globalThis.snapshot = () => environment.value;
    globalThis.emptyState = () => emptyDescription.value;
  `), harness))

  try {
    assert.equal(requests.length, 0)
    assert.equal(harness.pollingEnabled(), false)
    props.active = true
    await nextTick()
    assert.equal(requests.length, 1)
    assert.equal(harness.pollingEnabled(), true)
    assert.equal(timers.size, 1)
    assert.equal(requests[0].query.symbol, 'BTCUSDT')
    assert.equal(requests[0].query.timeframe, '1h')

    props.symbol = 'ETHUSDT'
    props.timeframe = '15m'
    await nextTick()
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests.length, 2, '一次交互同时切换标的和周期，只请求一次')
    assert.equal(requests[1].query.symbol, 'ETHUSDT')
    assert.equal(requests[1].query.timeframe, '15m')
    requests[1].resolve({ success: true, data: {} })
    await nextTick()
    requests[0].resolve({ success: true, data: {} })
    await nextTick()
    assert.equal(harness.snapshot()?.symbol, 'ETHUSDT')
    assert.equal(harness.snapshot()?.timeframe, '15m')

    props.timeframe = '1w'
    await nextTick()
    assert.equal(harness.snapshot(), undefined)
    assert.equal(harness.emptyState(), '周线暂无环境详情')
    assert.equal(requests.length, 2)

    props.timeframe = '4h'
    await nextTick()
    props.active = false
    await nextTick()
    assert.equal(requests[2].signal.aborted, true)
    assert.equal(harness.pollingEnabled(), false)
    assert.equal(timers.size, 0)
  } finally {
    scope.stop()
  }
})
