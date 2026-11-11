// ==================== 指标页右侧视图本地记忆回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick } from 'vue'
import { INDICATOR_PANEL_VIEW_KEY, useIndicatorPanelView } from '../app/composables/useIndicatorPanelView.ts'

/** 使用真实Vue挂载钩子，验证恢复与切换保存，避免把未恢复的默认值写回。 */
async function mountPreference(t, initial, denied = false) {
  const previous = globalThis.localStorage
  const values = new Map(initial == null ? [] : [[INDICATOR_PANEL_VIEW_KEY, initial]])
  const writes = []
  globalThis.localStorage = {
    getItem(key) { if (denied) throw new Error('存储不可用'); return values.get(key) ?? null },
    setItem(key, value) { if (denied) throw new Error('存储不可用'); values.set(key, value); writes.push(value) }
  }
  const renderer = createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null
  })
  let view
  const app = renderer.createApp({ setup() { view = useIndicatorPanelView(); return () => null } })
  app.mount({})
  await nextTick()
  t.after(() => { app.unmount(); if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous })
  return { view, values, writes }
}

test('恢复环境视图，不被挂载时的默认图表覆盖', async t => {
  const fixture = await mountPreference(t, 'environment')
  assert.equal(fixture.view.value, 'environment')
  assert.ok(!fixture.writes.includes('chart'))
})

test('切换视图后保存偏好，交易数据不写入存储', async t => {
  const fixture = await mountPreference(t, 'chart')
  fixture.view.value = 'environment'
  await nextTick()
  assert.equal(fixture.values.get(INDICATOR_PANEL_VIEW_KEY), 'environment')
  fixture.view.value = 'chart'
  await nextTick()
  assert.equal(fixture.values.get(INDICATOR_PANEL_VIEW_KEY), 'chart')
  assert.equal(fixture.values.size, 1)
})

test('无偏好或非法值时回退图表', async t => {
  const fixture = await mountPreference(t, 'invalid')
  assert.equal(fixture.view.value, 'chart')
  assert.deepEqual(fixture.writes, [])
})

test('存储不可用时切换仍正常', async t => {
  const fixture = await mountPreference(t, null, true)
  fixture.view.value = 'environment'
  await nextTick()
  assert.equal(fixture.view.value, 'environment')
})
