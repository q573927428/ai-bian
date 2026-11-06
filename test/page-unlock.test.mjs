// ==================== 服务端解锁恢复与敏感面板清理回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, ref } from 'vue'
import { PAGE_UNLOCK_KEY, usePageUnlock } from '../app/composables/usePageUnlock.ts'

/** 运行真实 Vue 钩子，使用模拟服务端状态而非 localStorage 授权。 */
async function mountUnlock(t, { verified = false, stored, shared = false } = {}) {
  const oldStorage = globalThis.localStorage
  const oldFetch = globalThis.$fetch
  const storage = new Map(stored ? [['page_password_verified', stored]] : [])
  let serverVerified = verified
  const calls = []
  globalThis.localStorage = { removeItem: key => storage.delete(key) }
  globalThis.$fetch = async (path, options) => {
    calls.push([path, options])
    if (path === '/api/bot/lock') serverVerified = false
    return { success: true, configured: true, verified: serverVerified, expiresAt: serverVerified ? Date.now() + 86400000 : null }
  }
  const renderer = createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const opened = []
  let lockCount = 0
  let peerLockCount = 0
  let unlock, peer
  const app = renderer.createApp({
    setup() {
      unlock = usePageUnlock({ onOpen: panel => opened.push(panel), onLock: () => lockCount++ })
      if (shared) peer = usePageUnlock({ onOpen: panel => opened.push('peer:' + panel), onLock: () => peerLockCount++ })
      return () => null
    },
  })
  if (shared) app.provide(PAGE_UNLOCK_KEY, { passwordVerified: ref(false), hasPassword: ref(false), expiresAt: ref(null) })
  app.mount({})
  await new Promise(resolve => setImmediate(resolve))
  t.after(() => {
    app.unmount()
    if (oldStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = oldStorage
    if (oldFetch === undefined) delete globalThis.$fetch
    else globalThis.$fetch = oldFetch
  })
  return { unlock, peer, opened, storage, calls, authorize: () => { serverVerified = true },
    get lockCount() { return lockCount }, get peerLockCount() { return peerLockCount } }
}

test('伪造 localStorage 不能解锁；服务器 Cookie 才能恢复刷新后的状态', async t => {
  const fixture = await mountUnlock(t, { stored: JSON.stringify({ verified: true, timestamp: Date.now() }) })
  assert.equal(fixture.unlock.passwordVerified.value, false)
  assert.equal(fixture.storage.size, 0)
  await fixture.unlock.handlePasswordSuccess()
  assert.equal(fixture.unlock.passwordVerified.value, false)
})

test('有效 Cookie 在刷新后恢复，不要求重新输入密码', async t => {
  const { unlock, opened } = await mountUnlock(t, { verified: true })
  assert.equal(unlock.passwordVerified.value, true)
  unlock.handleOpenProtectedPanel('config')
  assert.equal(unlock.showPasswordDialog.value, false)
  assert.deepEqual(opened, ['config'])
})

for (const panel of ['config', 'strategies', 'orders']) {
  test(panel + ' 验证成功后恢复待办，同一次解锁可重复打开', async t => {
    const fixture = await mountUnlock(t)
    fixture.unlock.handleOpenProtectedPanel(panel)
    assert.equal(fixture.unlock.showPasswordDialog.value, true)
    assert.deepEqual(fixture.opened, [])
    fixture.authorize()
    await fixture.unlock.handlePasswordSuccess()
    fixture.unlock.handleOpenProtectedPanel(panel)
    assert.deepEqual(fixture.opened, [panel, panel])
    assert.equal(fixture.storage.size, 0)
  })
}

test('共享验证状态且锁定向后端清除 Cookie，关闭所有面板', async t => {
  const fixture = await mountUnlock(t, { shared: true })
  assert.equal(fixture.calls.length, 1, '同次挂载合并服务端状态请求')
  fixture.authorize()
  await fixture.unlock.handlePasswordSuccess()
  assert.equal(fixture.peer.passwordVerified.value, true)
  fixture.peer.handleOpenProtectedPanel('orders')
  assert.deepEqual(fixture.opened, ['peer:orders'])
  await fixture.peer.clearPassword()
  assert.equal(fixture.calls.at(-1)[0], '/api/bot/lock')
  assert.equal(fixture.calls.at(-1)[1].method, 'POST')
  assert.equal(fixture.unlock.passwordVerified.value, false)
  assert.equal(fixture.lockCount, 1)
  assert.equal(fixture.peerLockCount, 1)
})

test('取消入口后独立解锁不执行旧操作', async t => {
  const fixture = await mountUnlock(t)
  fixture.unlock.handleOpenProtectedPanel('orders')
  fixture.unlock.showPasswordDialog.value = false
  fixture.unlock.handleUnlock()
  fixture.authorize()
  await fixture.unlock.handlePasswordSuccess()
  assert.deepEqual(fixture.opened, [])
})
