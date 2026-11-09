// ==================== 盘口满额提示与手动重试回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

/** 隔离浏览器与网络，执行图层真实连接逻辑，验证满额后不再创建连接。 */
test('满额事件关闭 EventSource，迟到错误不覆盖提示；手动重试只新建一次连接', async () => {
  const sockets = []
  const fixture = {
    props: { enabled: true, symbol: 'BTC/USDT', historical: false },
    computed: fn => ({ get value() { return fn() } }),
    shallowRef: value => ({ value }),
    onBeforeUnmount() {}, onMounted() {}, watch() {},
    // 模拟具名事件和关闭动作，不访问服务器或币安。
    EventSource: class {
      handlers = {}
      closed = false
      constructor() { sockets.push(this) }
      addEventListener(name, handler) { this.handlers[name] = handler }
      close() { this.closed = true }
    }
  }
  const file = readFileSync(new URL('../app/components/kline-chart/OrderBookOverlay.vue', import.meta.url), 'utf8')
  let source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import \{[^}]+\} from 'vue'/, 'const {computed,onBeforeUnmount,onMounted,shallowRef,watch} = globalThis.__capacityFixture')
    .replace('const props = defineProps<Props>()', 'const props = globalThis.__capacityFixture.props')
    .replace('defineEmits<{ toggle: [] }>()', '')
    .replace('new EventSource(', 'new globalThis.__capacityFixture.EventSource(')
  source += '\nexport function start() { mounted = true; reconnect() }\nexport { reconnect, connectionStatus, statusLabel };'
  globalThis.__capacityFixture = fixture
  try {
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    const component = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
    component.start()
    assert.equal(sockets.length, 1)
    sockets[0].handlers.capacity()
    assert.equal(sockets[0].closed, true)
    assert.equal(component.connectionStatus.value, 'capacity')
    assert.equal(component.statusLabel.value, '盘口已满')
    sockets[0].onerror()
    assert.equal(component.connectionStatus.value, 'capacity')
    assert.equal(sockets.length, 1)
    component.reconnect()
    assert.equal(sockets.length, 2)
    assert.equal(component.connectionStatus.value, 'syncing')
    sockets[0].handlers.capacity()
    assert.equal(sockets[1].closed, false, '旧连接迟到事件不能关闭新连接')
    sockets[1].onerror()
    assert.equal(component.connectionStatus.value, 'disconnected')
    assert.equal(sockets[1].closed, false, '普通网络错误保留浏览器自动恢复')
    fixture.props.enabled = false
    component.reconnect()
    assert.equal(sockets[1].closed, true, '切换成交分布后关闭盘口连接')
    assert.equal(sockets.length, 2, '隐藏盘口期间不得重新连接')
  } finally { delete globalThis.__capacityFixture }
})
