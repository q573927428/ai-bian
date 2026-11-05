// ==================== 整站访问保护集成验证 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// pnpm 未把 Nuxt 的间接依赖提升到根目录；测试复用 Nuxt 实际安装的 h3。
const nuxtRequire = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))
const h3Url = pathToFileURL(nuxtRequire.resolve('h3').replace(/\.cjs$/, '.mjs')).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'h3' ? h3Url : specifier, context)
  }
})
const { createApp, defineEventHandler, toNodeListener } = await import('h3')
const { default: basicAuth } = await import('../server/middleware/00-basic-auth.ts')
hooks.deregister()

/** 使用隔离 HTTP 服务验证真实中间件，不加载交易引擎或访问线上服务。 */
test('生产环境页面与资金操作 API 统一鉴权，并在缺少配置时拒绝访问', async t => {
  const keys = ['NODE_ENV', 'BASIC_AUTH_USERNAME', 'BASIC_AUTH_PASSWORD']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const app = createApp()
  let reached = 0
  app.use(basicAuth)
  app.use(defineEventHandler(() => { reached++; return { success: true } }))
  const server = createServer(toNodeListener(app))
  t.after(async () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await new Promise(resolve => server.close(resolve))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const credentials = value => ({ authorization: `Basic ${Buffer.from(value).toString('base64')}` })
  process.env.NODE_ENV = 'production'
  delete process.env.BASIC_AUTH_USERNAME
  delete process.env.BASIC_AUTH_PASSWORD
  assert.equal((await fetch(base)).status, 503)
  process.env.BASIC_AUTH_USERNAME = 'owner'
  assert.equal((await fetch(base)).status, 503)
  process.env.BASIC_AUTH_PASSWORD = 'long-secret:with-colon'
  for (const [path, method] of [['/', 'GET'], ['/api/bot/status', 'GET'], ['/api/strategies/strategy_001', 'DELETE'], ['/api/strategies/strategy_001/force-open', 'POST']]) {
    const denied = await fetch(base + path, { method })
    assert.equal(denied.status, 401)
    assert.match(denied.headers.get('www-authenticate'), /^Basic /)
    assert.match(denied.headers.get('cache-control'), /no-store/)
    assert.equal((await fetch(base + path, { method, headers: credentials('owner:wrong') })).status, 401)
    assert.equal((await fetch(base + path, { method, headers: credentials('wrong:long-secret:with-colon') })).status, 401)
  }
  assert.equal(reached, 0)
  const allowed = await fetch(base + '/api/bot/status', { headers: credentials('owner:long-secret:with-colon') })
  assert.equal(allowed.status, 200)
  assert.equal(reached, 1)
  for (const authorization of ['Bearer token', 'Basic !!!', 'Basic ' + Buffer.from('owner').toString('base64')]) {
    assert.equal((await fetch(base, { headers: { authorization } })).status, 401)
  }
  delete process.env.BASIC_AUTH_USERNAME
  delete process.env.BASIC_AUTH_PASSWORD
  process.env.NODE_ENV = 'development'
  assert.equal((await fetch(base)).status, 200)
  process.env.BASIC_AUTH_USERNAME = 'owner'
  assert.equal((await fetch(base)).status, 503)
})
