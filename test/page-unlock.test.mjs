// ==================== 首页解锁门禁与面板恢复回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer } from 'vue'
import { usePageUnlock } from '../app/composables/usePageUnlock.ts'

const storageKey = 'page_password_verified'

/** 使用无 DOM 渲染器运行真实挂载钩子，验证存储恢复而不启动交易服务。 */
function mountUnlock(t, stored) {
  const previousStorage = globalThis.localStorage
  const storage = new Map(stored === undefined ? [] : [[storageKey, stored]])
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  }
  const renderer = createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null
  })
  const opened = []
  let lockCount = 0
  let unlock
  const app = renderer.createApp({
    setup() {
      unlock = usePageUnlock({ onOpen: panel => opened.push(panel), onLock: () => lockCount++ })
      return () => null
    }
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  })
  return { unlock, opened, storage, get lockCount() { return lockCount } }
}

for (const panel of ['config', 'strategies', 'orders']) {
  test(`${panel} 在验证前不打开，验证成功后恢复且已解锁可直接打开`, t => {
    const { unlock, opened, storage } = mountUnlock(t)
    unlock.handleOpenProtectedPanel(panel)
    assert.equal(unlock.showPasswordDialog.value, true)
    assert.deepEqual(opened, [])
    unlock.handlePasswordSuccess()
    assert.equal(unlock.passwordVerified.value, true)
    assert.deepEqual(opened, [panel])
    assert.equal(JSON.parse(storage.get(storageKey)).verified, true)
    unlock.handleOpenProtectedPanel(panel)
    assert.deepEqual(opened, [panel, panel])
  })
}

test('锁定会清理验证状态、存储及待恢复操作，并通知页面关闭管理面板', t => {
  const fixture = mountUnlock(t)
  fixture.unlock.handleOpenProtectedPanel('config')
  fixture.unlock.clearPassword()
  assert.equal(fixture.lockCount, 1)
  assert.equal(fixture.unlock.passwordVerified.value, false)
  assert.equal(fixture.unlock.hasPassword.value, false)
  assert.equal(fixture.storage.has(storageKey), false)
  fixture.unlock.handlePasswordSuccess()
  assert.deepEqual(fixture.opened, [])
})

test('取消入口验证后独立解锁，不打开旧入口', t => {
  const { unlock, opened } = mountUnlock(t)
  unlock.handleOpenProtectedPanel('orders')
  unlock.showPasswordDialog.value = false
  unlock.handleUnlock()
  unlock.handlePasswordSuccess()
  assert.deepEqual(opened, [])
})

test('挂载时恢复 24 小时内的验证记录', t => {
  const { unlock } = mountUnlock(t, JSON.stringify({ verified: true, timestamp: Date.now() - 1000 }))
  assert.equal(unlock.passwordVerified.value, true)
  assert.equal(unlock.hasPassword.value, true)
})

for (const stored of [JSON.stringify({ verified: true, timestamp: Date.now() - 25 * 60 * 60 * 1000 }), '{broken']) {
  test(`失效或损坏的验证记录保持锁定并移除：${stored}`, t => {
    const { unlock, storage } = mountUnlock(t, stored)
    assert.equal(unlock.passwordVerified.value, false)
    assert.equal(storage.has(storageKey), false)
  })
}
