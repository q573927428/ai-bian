// ==================== 客户端失效通知与交易重试边界 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

test('密码输入错误保持弹窗；业务授权失效才触发锁定，所有请求禁止自动重试', async t => {
  const previousFetch = globalThis.$fetch
  const previousWindow = globalThis.window
  const events = []
  let options
  globalThis.$fetch = { create: config => { options = config; return {} } }
  globalThis.window = { dispatchEvent: event => events.push(event.type) }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === '#app' ? 'data:text/javascript,export const defineNuxtPlugin = fn => fn;' : specifier, context)
    },
  })
  t.after(() => {
    hooks.deregister()
    if (previousFetch === undefined) delete globalThis.$fetch
    else globalThis.$fetch = previousFetch
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  const { default: plugin } = await import('../app/plugins/operation-auth.client.ts')
  plugin()
  assert.equal(options.retry, 0)
  options.onResponseError({ request: '/api/bot/check-password', response: { status: 401 } })
  options.onResponseError({ request: '/api/strategies', response: { status: 500 } })
  assert.deepEqual(events, [])
  options.onResponseError({ request: '/api/strategies?test=1', response: { status: 401 } })
  assert.deepEqual(events, ['operation-auth-expired'])
})
