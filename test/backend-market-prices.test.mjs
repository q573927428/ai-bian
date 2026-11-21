// ==================== 后端行情自启动与共享 WS 取价回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const WebSocketStatus = { CONNECTED: 'CONNECTED', DISCONNECTED: 'DISCONNECTED' }

/** 隔离网络与 Nitro 环境，执行真实模块逻辑，不连接交易所或读取实盘配置。 */
function loadModule(path, dependencies, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = { exports: {}, require: id => {
    assert.ok(id in dependencies, `未隔离的依赖：${id}`)
    return dependencies[id]
  }, ...globals }
  vm.runInNewContext(compiled.outputText, context, { filename: path })
  return context.exports
}

test('ticker 广播传递真实 24h 涨跌额并区分缺失和零', () => {
  const { BinanceWebSocketService } = loadModule('../server/utils/websocket.ts', {
    '../../types/websocket': { WebSocketStatus },
    ws: {}
  })
  const ws = new BinanceWebSocketService()
  ws.symbolMapping.set('btcusdt', 'BTCUSDT')
  const data = []
  ws.on('price', event => data.push(event.data))

  ws.handleTickerMessage({ s: 'BTCUSDT', c: '57860.2', p: '-4359.7', P: '-7.007' })
  ws.handleTickerMessage({ s: 'BTCUSDT', c: '57860.2', p: '0', P: '0' })
  ws.handleTickerMessage({ s: 'BTCUSDT', c: '57860.2' })
  assert.deepEqual(data.map(price => price.change24hAmount), [-4359.7, 0, undefined])
  assert.equal(data[0].change24hPercent, -7.007)
})

/** 模拟可控的 WS 状态、事件时间和 REST 补充价格。 */
function priceFixture() {
  let now = 100_000
  const tickers = new Map()
  const state = { status: WebSocketStatus.CONNECTED }
  const calls = []
  let rest = async () => 99
  const { PriceCacheService } = loadModule('../server/modules/market-data/PriceCacheService.ts', {
    '../../utils/websocket-manager': {
      webSocketManager: { getPrice: symbol => tickers.get(symbol), getWebSocketState: () => state }
    },
    '../../../types/websocket': { WebSocketStatus }
  }, { Date: { now: () => now } })
  return {
    service: new PriceCacheService(), tickers, state, calls,
    binance: { fetchPrice(symbol) { calls.push(symbol); return rest() } },
    advance(ms) { now += ms },
    setRest(callback) { rest = callback }
  }
}

test('10 个同向品种的新鲜 WS 价格无需 REST 请求，优先于已有 REST 缓存', async () => {
  const f = priceFixture()
  for (let i = 0; i < 10; i++) {
    f.tickers.set(`COIN${i}USDT`, { price: 100 + i, timestamp: 99_000 })
    f.service.setPrice(`COIN${i}/USDT`, 1)
  }
  const prices = await Promise.all(Array.from({ length: 10 }, (_, i) => f.service.getPrice(f.binance, `COIN${i}/USDT`)))
  assert.deepEqual(prices, Array.from({ length: 10 }, (_, i) => 100 + i))
  assert.equal(f.calls.length, 0)
  f.tickers.set('COIN0USDT', { price: 123, timestamp: 100_000 })
  assert.equal(await f.service.getPrice(f.binance, 'COIN0/USDT:USDT'), 123)
})

test('WS 缺失、过期、未来时间、无效价格或断线时降级 REST', async () => {
  for (const ticker of [undefined, { price: 100, timestamp: 95_000 },
    { price: 100, timestamp: 101_000 }, { price: 0, timestamp: 99_000 },
    { price: NaN, timestamp: 99_000 }, { price: 100, timestamp: NaN }]) {
    const f = priceFixture()
    f.tickers.set('BTCUSDT', ticker)
    assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 99)
    assert.equal(f.calls.length, 1)
  }
  const f = priceFixture()
  f.tickers.set('BTCUSDT', { price: 100, timestamp: 100_000 })
  f.state.status = WebSocketStatus.DISCONNECTED
  assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 99)
})

test('反复读取 WS 价格不刷新事件时间，REST 缓存过期后重新请求', async () => {
  const f = priceFixture()
  f.tickers.set('BTCUSDT', { price: 100, timestamp: 100_000 })
  assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 100)
  f.advance(4999)
  assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 100)
  f.advance(1)
  assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 99)
  assert.equal(await f.service.getPrice(f.binance, 'BTCUSDT'), 99)
  assert.equal(f.calls.length, 1)
  f.advance(5000)
  await f.service.getPrice(f.binance, 'BTC/USDT')
  assert.equal(f.calls.length, 2)
})

test('不同交易对格式共享在途 REST 请求，失败或非法结果后可重试', async () => {
  const f = priceFixture()
  let resolve
  f.setRest(() => new Promise(done => { resolve = done }))
  const first = f.service.getPrice(f.binance, 'BTC/USDT')
  const second = f.service.getPrice(f.binance, 'BTCUSDT')
  assert.equal(f.calls.length, 1)
  resolve(101)
  assert.deepEqual(await Promise.all([first, second]), [101, 101])
  f.advance(5000)
  f.setRest(async () => { throw new Error('network failure') })
  await assert.rejects(f.service.getPrice(f.binance, 'BTC/USDT'), /network failure/)
  f.setRest(async () => 0)
  await assert.rejects(f.service.getPrice(f.binance, 'BTC/USDT'), /当前价格无效/)
  f.setRest(async () => 102)
  assert.equal(await f.service.getPrice(f.binance, 'BTC/USDT'), 102)
})

/** 无页面访问情况下启动真实插件，手动驱动其重试和关闭钩子。 */
function pluginFixture(initialize = async () => {}) {
  let closeHook, tick
  const calls = { initialize: 0, close: 0, cleared: 0, warnings: 0 }
  const state = { status: WebSocketStatus.CONNECTED }
  const { default: plugin } = loadModule('../server/plugins/market-prices.ts', {
    '../utils/market-price-hub': { marketPriceHub: {
      async initialize() { calls.initialize++; await initialize() },
      getStatus: () => state,
      close() { calls.close++ }
    } },
    '../utils/logger': { logger: { warn() { calls.warnings++ } } },
    '../../types/websocket': { WebSocketStatus }
  }, {
    defineNitroPlugin: callback => callback,
    setInterval(callback, ms) { assert.equal(ms, 30_000); tick = callback; return { unref() {} } },
    clearInterval() { calls.cleared++ }
  })
  plugin({ hooks: { hook(name, callback) { assert.equal(name, 'close'); closeHook = callback } } })
  return { calls, state, tick: () => tick(), close: () => closeHook() }
}

/** 等待异步初始化链自然结束，不使用真实定时器。 */
const flush = () => new Promise(resolve => setImmediate(resolve))

test('后台启动即初始化，无页面请求；连接正常不重复初始化，断线会重试', async () => {
  const f = pluginFixture()
  assert.equal(f.calls.initialize, 1)
  await flush()
  f.tick()
  assert.equal(f.calls.initialize, 1)
  f.state.status = WebSocketStatus.DISCONNECTED
  f.tick()
  await flush()
  assert.equal(f.calls.initialize, 2)
  await f.close()
  assert.equal(f.calls.close, 1)
  assert.equal(f.calls.cleared, 1)
  f.tick()
  assert.equal(f.calls.initialize, 2)
})

test('首次订阅失败后自动重试，在途初始化不会重复启动', async () => {
  let reject
  const f = pluginFixture(() => new Promise((_, fail) => { reject = fail }))
  f.tick()
  assert.equal(f.calls.initialize, 1)
  reject(new Error('连接失败'))
  await flush()
  assert.equal(f.calls.warnings, 1)
  f.tick()
  assert.equal(f.calls.initialize, 2)
  reject(new Error('再次失败'))
  await flush()
  await f.close()
})

test('服务关闭等待在途初始化，完成后关闭连接且不再订阅', async () => {
  let resolve
  const f = pluginFixture(() => new Promise(done => { resolve = done }))
  const closing = f.close()
  assert.equal(f.calls.close, 0)
  f.tick()
  assert.equal(f.calls.initialize, 1)
  resolve()
  await closing
  assert.equal(f.calls.close, 1)
})

test('行情中心无需浏览器即可订阅配置交易对，热更新不重复订阅且关闭清理资源', async () => {
  const callbacks = new Map()
  const subscriptions = []
  const removals = []
  let disconnected = 0, cleared = 0
  const { marketPriceHub: hub } = loadModule('../server/utils/market-price-hub.ts', {
    './storage': { getBotConfig: async () => ({ symbols: ['BTC/USDT', 'ETH/USDT', 'BTCUSDT'] }) },
    './websocket-manager': { webSocketManager: {
      initialize: async () => {},
      getWebSocketState: () => ({ status: WebSocketStatus.CONNECTED }),
      subscribeStatus() {},
      subscribePrice(symbol, callback) { subscriptions.push(symbol); callbacks.set(symbol, callback) },
      unsubscribePrice(symbol) { removals.push(symbol); callbacks.delete(symbol) },
      disconnect() { disconnected++; callbacks.clear() }
    } }
  }, {
    setTimeout: () => 1,
    clearTimeout() { cleared++ }
  })
  await hub.initialize()
  assert.deepEqual(subscriptions, ['BTCUSDT', 'ETHUSDT'])
  callbacks.get('BTCUSDT')({ symbol: 'BTCUSDT', price: 100, timestamp: 100_000 })
  assert.equal(hub.getSnapshot(['BTC/USDT']).BTCUSDT.price, 100)
  await hub.initialize()
  assert.equal(subscriptions.length, 2)
  await hub.syncSymbols(['ETHUSDT', 'SOL/USDT'])
  assert.deepEqual(subscriptions, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  assert.deepEqual(removals, ['BTCUSDT'])
  hub.close()
  assert.equal(Object.keys(hub.getSnapshot()).length, 0)
  assert.equal(disconnected, 1)
  assert.equal(cleared, 1)
})
