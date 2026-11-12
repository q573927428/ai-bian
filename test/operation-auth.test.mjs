// ==================== 敏感 API 门禁、真实路由与匿名响应安全回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, request } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const nuxtRequire = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))
const h3Url = pathToFileURL(nuxtRequire.resolve('h3').replace(/\.cjs$/, '.mjs')).href
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`
const secret = 'sentinel-ai-key-never-public'
const strategy = {
  id: 'strategy_001', name: 'test', isActive: false, version: 1,
  performance: { totalTrades: 1 }, marketData: { symbols: ['BTC/USDT'] },
  aiPrompt: { apiKey: secret, userPrompt: 'private-prompt' },
  versionHistory: [{ snapshot: { aiPrompt: { apiKey: secret }, versionHistory: [{ snapshot: { aiPrompt: { apiKey: secret } } }] } }],
}
const position = { symbol: 'BTC/USDT', strategyId: strategy.id, entryPrice: 1, quantity: 1, direction: 'long', reasoning: 'private-reasoning', position: { private: 'hidden' } }
const fixture = {
  strategy, position, effects: 0,
  engine: {
    getRunningStrategies: () => [],
    getPositionManager: () => ({ getAllPositions: () => [position] }),
    getBinanceService: () => ({ fetchCryptoBalances: async () => ({}) }),
    getDailyTradeStatus: async () => ({}), getDailyLossStatus: () => ({}),
    getPositionCloser: () => ({ closePosition: async () => { fixture.effects++ } }),
  },
}
strategy.riskManagement = { maxDailyTrades: 1, maxDailyLoss: 1 }
globalThis.__operationAuthFixture = fixture
const managerSource = `const f = globalThis.__operationAuthFixture;
const manager = {
getEngine: () => f.engine, getAllStrategies: async () => [f.strategy],
getAllStrategiesStatus: async () => [{ id: f.strategy.id, error: 'private-error', isRunning: false }],
createStrategy: async () => { f.effects++; return f.strategy }, deleteStrategy: async () => { f.effects++; return true }
}; export const getStrategyManager = () => manager; export const getStrategyManagerIfAvailable = () => manager;`
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'h3') return nextResolve(h3Url, context)
    if (specifier === '#imports') return nextResolve(moduleUrl('export const useRuntimeConfig = () => ({ configEditPassword: "" });'), context)
    if (specifier.endsWith('/modules/strategy-manager')) return nextResolve(moduleUrl(managerSource), context)
    if (specifier.endsWith('/modules/position-manager/PositionManager')) return nextResolve(moduleUrl(`const f = globalThis.__operationAuthFixture; export const positionManager = { waitForInit: async () => {}, getPosition: () => f.position, getActivePositions: () => [f.position], getStrategyPositions: () => [f.position], getPositionStats: () => ({}) };`), context)
    if (specifier.endsWith('/utils/logger')) return nextResolve(moduleUrl('export const logger = { getRecentLogs: () => [{ message: "private-log" }] };'), context)
    if (specifier.endsWith('/utils/storage')) return nextResolve(moduleUrl('export const getBotConfig = async () => ({ symbols: ["BTC/USDT"], initialCapital: 100, privateConfig: "never-public" });'), context)
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})
const h3 = await import('h3')
const globals = ['defineEventHandler', 'readBody', 'createError', 'getRouterParam', 'getQuery']
const previousGlobals = Object.fromEntries(globals.map(key => [key, globalThis[key]]))
for (const key of globals) globalThis[key] = h3[key]
const { default: guard } = await import('../server/middleware/00-operation-auth.ts')
const { default: login } = await import('../server/api/bot/check-password.post.ts')
const { default: status } = await import('../server/api/bot/check-password.get.ts')
const { default: lock } = await import('../server/api/bot/lock.post.ts')
const { default: botStatus } = await import('../server/api/bot/status.get.ts')
const { default: strategies } = await import('../server/api/strategies/index.get.ts')
const { default: createStrategy } = await import('../server/api/strategies/index.post.ts')
const { default: deleteStrategy } = await import('../server/api/strategies/[id].delete.ts')
const { default: closePosition } = await import('../server/api/positions/close.post.ts')
const { default: positions } = await import('../server/api/positions/index.get.ts')
const { default: publicConfig } = await import('../server/api/market/config.get.ts')
hooks.deregister()

/** 枚举真实路由文件，确保以后新增的写 API 自动接受匿名阻断测试。 */
function writeRoutes(dir = new URL('../server/api/', import.meta.url), prefix = '/api') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return writeRoutes(new URL(`${entry.name}/`, dir), `${prefix}/${entry.name}`)
    const match = /^(.*)\.(post|put|patch|delete)\.ts$/.exec(entry.name)
    if (!match) return []
    const path = `${prefix}${match[1] === 'index' ? '' : '/' + match[1]}`.replace(/\[id\]/g, 'strategy_001')
    return [{ path, method: match[2].toUpperCase() }]
  })
}

test('公开浏览、密码 Cookie、敏感路由与副作用边界', async t => {
  const envKeys = ['NODE_ENV', 'CONFIG_EDIT_USERNAME', 'CONFIG_EDIT_PASSWORD', 'OPERATION_AUTH_ORIGIN', 'BASIC_AUTH_USERNAME', 'BASIC_AUTH_PASSWORD']
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  process.env.NODE_ENV = 'production'
  process.env.CONFIG_EDIT_USERNAME = 'admin'
  process.env.CONFIG_EDIT_PASSWORD = 'test-operation-password'
  process.env.OPERATION_AUTH_ORIGIN = 'https://trade.example.com'
  process.env.BASIC_AUTH_USERNAME = 'legacy'
  process.env.BASIC_AUTH_PASSWORD = 'legacy-password'
  const app = h3.createApp()
  const router = h3.createRouter()
  router.post('/api/bot/check-password', login).get('/api/bot/check-password', status).post('/api/bot/lock', lock)
  router.get('/api/bot/status', botStatus).get('/api/strategies', strategies).post('/api/strategies', createStrategy)
  router.delete('/api/strategies/:id', deleteStrategy).post('/api/positions/close', closePosition)
  router.get('/api/positions', positions).get('/api/market/config', publicConfig)
  app.use(guard).use(router.handler).use(h3.defineEventHandler(() => ({ success: true })))
  const server = createServer(h3.toNodeListener(app))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const key of envKeys) previousEnv[key] === undefined ? delete process.env[key] : process.env[key] = previousEnv[key]
    for (const key of globals) previousGlobals[key] === undefined ? delete globalThis[key] : globalThis[key] = previousGlobals[key]
    delete globalThis.__operationAuthFixture
  })
  const write = (path, cookie, body = {}, method = 'POST', extra = {}) => fetch(base + path, {
    method, headers: { origin: process.env.OPERATION_AUTH_ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body),
  })
  let cookie

  await t.test('旧 Basic 配置不再挡住页面，匿名响应没有完整配置、日志或推理', async () => {
    assert.equal((await fetch(base)).status, 200)
    for (const path of ['/api/bot/status', '/api/strategies', '/api/positions', '/api/market/config']) {
      const response = await fetch(base + path)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('cache-control'), /no-store/)
      const body = await response.text()
      for (const value of [secret, 'private-prompt', 'private-log', 'private-error', 'private-reasoning', 'never-public']) assert.ok(!body.includes(value), `${path}: ${value}`)
    }
  })

  await t.test('枚举所有写接口及敏感读取，匿名请求在业务前被拒绝', async () => {
    for (const { path, method } of writeRoutes()) {
      if (['/api/bot/check-password', '/api/bot/lock'].includes(path)) continue
      assert.equal((await write(path, null, {}, method)).status, 401, `${method} ${path}`)
    }
    for (const path of ['/api/strategies/strategy_001', '/api/strategies/strategy_001/versions', '/api/bot/config', '/api/bot/history/1', '/api/ai/prompt', '/api/ai/prompts', '/api/ai/rules', '/api/ai/trade-decision', '/api/scripts/get-pine', '/api/scan-results', '/api//bot/config', '/api/bot/%63onfig', '/API/BOT/CONFIG']) {
      for (const method of ['GET', 'HEAD']) assert.equal((await fetch(base + path, { method })).status, 401, `${method} ${path}`)
    }
    assert.equal(fixture.effects, 0)
  })

  await t.test('错误密码和空配置失败关闭；普通页面继续可用', async () => {
    assert.equal((await write('/api/bot/check-password', null, { password: 'wrong' })).status, 401)
    const credentials = { username: 'admin', password: process.env.CONFIG_EDIT_PASSWORD }
    for (const invalid of [
      { password: credentials.password },
      { ...credentials, username: 'wrong' },
      { ...credentials, password: 'wrong' },
      { ...credentials, username: {} },
      { ...credentials, password: [] },
    ]) {
      const response = await write('/api/bot/check-password', null, invalid)
      assert.equal(response.status, 401)
      assert.equal((await response.json()).data.message, '账号或密码错误')
    }
    process.env.CONFIG_EDIT_USERNAME = ''
    assert.equal((await write('/api/bot/check-password', null, credentials)).status, 503)
    assert.equal((await write('/api/strategies')).status, 503)
    assert.equal((await (await fetch(base + '/api/bot/check-password')).json()).configured, false)
    process.env.CONFIG_EDIT_USERNAME = 'admin'
    process.env.CONFIG_EDIT_PASSWORD = ''
    assert.equal((await write('/api/bot/check-password', null, { password: 'anything' })).status, 503)
    assert.equal((await write('/api/strategies')).status, 503)
    assert.equal((await fetch(base)).status, 200)
    process.env.CONFIG_EDIT_PASSWORD = 'test-operation-password'
  })

  await t.test('一次密码签发安全 Cookie，刷新状态并复用真实操作路由', async () => {
    const response = await write('/api/bot/check-password', null, { username: ' admin ', password: process.env.CONFIG_EDIT_PASSWORD })
    assert.equal(response.status, 200)
    const header = response.headers.get('set-cookie')
    assert.match(header, /^__Host-operation_auth=/)
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=86400', 'Path=/']) assert.ok(header.includes(flag), flag)
    cookie = header.split(';')[0]
    const body = await response.json()
    assert.ok(Math.abs(body.expiresAt - Date.now() - 86400000) < 2000)
    assert.equal((await (await fetch(base + '/api/bot/check-password', { headers: { cookie } })).json()).verified, true)
    for (const [path, method, data] of [['/api/strategies', 'POST', { name: 'test' }], ['/api/strategies/strategy_001', 'DELETE', {}], ['/api/positions/close', 'POST', { symbol: 'BTC/USDT' }]]) {
      const result = await write(path, cookie, data, method)
      assert.equal(result.status, 200, await result.text())
    }
    assert.equal(fixture.effects, 3)
    const full = await (await fetch(base + '/api/strategies', { headers: { cookie } })).text()
    assert.ok(full.includes('private-prompt'))
    assert.ok(!full.includes(secret), '所有层级历史密钥均需脱敏')
  })

  await t.test('公开指标读取不要求登录，仍禁止缓存私人响应', async () => {
    // 使用兜底响应验证门禁是否放行，避免加载真实行情或触发外部统计请求。
    const paths = ['/api/bot/indicators?symbol=BTCUSDT&timeframe=1h', '/api//bot/indicators', '/api/bot/%69ndicators', '/API/BOT/INDICATORS', '/api/bot/indicators/']
    for (const path of paths) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(base + path, { method })
        assert.equal(response.status, 200)
        assert.match(response.headers.get('cache-control'), /no-store/)
      }
    }
  })

  await t.test('跨站、缺来源、伪造 Cookie 与异常请求不产生副作用', async () => {
    for (const origin of ['https://evil.example', 'null', '']) assert.equal((await write('/api/strategies', cookie, {}, 'POST', { origin })).status, 403)
    assert.equal((await write('/api/strategies', cookie, {}, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await write('/api/strategies', cookie, {}, 'POST', { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await write('/api/strategies', cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A'))).status, 401)
    assert.equal((await fetch(base + '/api/strategies', { method: 'OPTIONS' })).status, 405)
    assert.equal((await write('/api/strategies', cookie, { data: 'x'.repeat(1024 * 1024) })).status, 413)
    // 不带 Content-Length 的 chunked 请求也必须按实际字节数拒绝。
    const chunkedStatus = await new Promise((resolve, reject) => {
      const req = request(base + '/api/strategies', { method: 'POST', headers: { origin: process.env.OPERATION_AUTH_ORIGIN, cookie, 'content-type': 'application/json' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) })
      req.on('error', reject)
      req.write('x'.repeat(1024 * 1024 + 1))
      req.end()
    })
    assert.equal(chunkedStatus, 413)
    assert.equal(fixture.effects, 3)
  })

  await t.test('密码修改、过期、篡改时间及主动锁定', async () => {
    process.env.CONFIG_EDIT_USERNAME = 'rotated-admin'
    assert.equal((await write('/api/strategies', cookie)).status, 401)
    assert.equal((await (await fetch(base + '/api/bot/check-password', { headers: { cookie } })).json()).verified, false)
    process.env.CONFIG_EDIT_USERNAME = 'admin'
    process.env.CONFIG_EDIT_PASSWORD = 'rotated-password'
    assert.equal((await write('/api/strategies', cookie)).status, 401)
    process.env.CONFIG_EDIT_PASSWORD = 'test-operation-password'
    const originalNow = Date.now
    Date.now = () => originalNow() + 86400001
    try { assert.equal((await write('/api/strategies', cookie)).status, 401) } finally { Date.now = originalNow }
    const parts = cookie.split('.')
    parts[2] = String(Number(parts[2]) + 86400000)
    assert.equal((await write('/api/strategies', parts.join('.'))).status, 401)
    const response = await write('/api/bot/lock', cookie)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.equal((await (await fetch(base + '/api/bot/check-password')).json()).verified, false)
  })

  await t.test('共用线上来源配置时，本机开发同源可解锁，跨站和转发头仍不能绕过', async () => {
    process.env.NODE_ENV = 'development'
    try {
      const origin = base
      const localLogin = await write('/api/bot/check-password', null, { username: 'admin', password: process.env.CONFIG_EDIT_PASSWORD }, 'POST', { origin })
      assert.equal(localLogin.status, 200)
      const localCookie = localLogin.headers.get('set-cookie').split(';')[0]
      assert.match(localCookie, /^operation_auth_dev=/)
      const localStatus = await fetch(base + '/api/bot/check-password', { headers: { cookie: localCookie } })
      assert.equal((await localStatus.json()).verified, true)
      assert.equal((await write('/api/strategies', null, {}, 'POST', { origin })).status, 401)
      assert.equal((await write('/api/strategies', null, {}, 'POST', { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })).status, 403)
      // Node fetch 会自行重设 Host；使用原生 HTTP 请求验证实际本机 Host/端口组合。
      const localRequest = (host, origin) => new Promise((resolve, reject) => {
        const req = request(base + '/api/strategies', { method: 'POST', headers: { host, origin, 'content-type': 'application/json' } }, response => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        })
        req.on('error', reject)
        req.end('{}')
      })
      assert.equal(await localRequest('localhost:3000', 'http://localhost:3000'), 401)
      assert.equal(await localRequest('[::1]:3000', 'http://[::1]:3000'), 401)
      assert.equal(await localRequest('localhost:3000', 'http://localhost:3001'), 403)
      assert.equal(fixture.effects, 3)
    } finally { process.env.NODE_ENV = 'production' }
    // 切回生产后，localhost 不再有开发兼容入口。
    assert.equal((await write('/api/strategies', null, {}, 'POST', { origin: base })).status, 403)
  })

  await t.test('生产来源未配置和暴力猜密码被拒绝', async () => {
    process.env.OPERATION_AUTH_ORIGIN = ''
    assert.equal((await write('/api/bot/check-password', null, {})).status, 503)
    process.env.OPERATION_AUTH_ORIGIN = 'https://trade.example.com'
    const originalNow = Date.now
    Date.now = () => originalNow() + 61000
    try {
      for (let i = 0; i < 10; i++) assert.equal((await write('/api/bot/check-password', null, { password: 'wrong' })).status, 401)
      assert.equal((await write('/api/bot/check-password', null, { password: 'wrong' }, 'POST', { 'x-forwarded-for': '1.2.3.4' })).status, 429)
      assert.equal((await fetch(base)).status, 200)
    } finally { Date.now = originalNow }
  })
})
