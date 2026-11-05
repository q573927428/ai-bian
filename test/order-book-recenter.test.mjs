// ==================== 盘口重新居中与连接生命周期回归测试 ====================
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText).toString('base64')}`
const core = moduleUrl(readFileSync(new URL('../server/utils/local-order-book.ts', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../server/utils/order-book-hub.ts', import.meta.url), 'utf8')
  .replace("import WebSocket from 'ws'", 'const WebSocket = globalThis.__depthRecenterFixture.WebSocket')
  .replace("import { binanceApiGateway } from './binance-api-gateway'", 'const binanceApiGateway = globalThis.__depthRecenterFixture.gateway')
  .replace("from './local-order-book'", `from '${core}'`)

test('覆盖偏移只重取快照、不重连；重建期间隐藏旧盘口并正确应用缓存增量', async () => {
  const originalNow = Date.now
  const originalInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  let now = 100000
  let tick
  const sockets = []
  const requests = []
  // 模拟公开行情传输；测试不得加载交易引擎或访问网络。
  class FakeSocket extends EventEmitter {
    constructor() { super(); sockets.push(this) }
    send() {}
    terminate() { this.emit('close') }
  }
  const gateway = {
    shouldPauseBackgroundWork: () => false,
    fetchJson: (_group, key, _url, init) => new Promise(resolve => { requests.push({ resolve, key, signal: init.signal }) })
  }
  Date.now = () => now
  globalThis.setInterval = fn => { tick = fn; return 1 }
  globalThis.clearInterval = () => {}
  globalThis.__depthRecenterFixture = { WebSocket: FakeSocket, gateway }
  let hub
  let unsubscribe
  const frames = []
  const message = data => sockets[0].emit('message', Buffer.from(JSON.stringify(data)))
  const settle = async () => { await Promise.resolve(); await Promise.resolve() }
  try {
    hub = (await import(moduleUrl(source))).orderBookHub
    unsubscribe = hub.subscribe('BTCUSDT', frame => frames.push(frame))
    sockets[0].emit('open')
    message({ id: 'depth', result: null })
    requests[0].resolve({ lastUpdateId: 100, E: now, bids: [['99', '2'], ['90', '3']], asks: [['101', '2'], ['110', '4']] })
    await settle()
    message({ e: 'depthUpdate', s: 'BTCUSDT', E: now, U: 99, u: 101, pu: 98, b: [], a: [] })
    tick()
    assert.equal(frames.at(-1).status, 'live')
    now += 31000
    message({ e: 'depthUpdate', s: 'BTCUSDT', E: now, U: 102, u: 103, pu: 101, b: [['108', '3']], a: [['101', '0'], ['109', '3']] })
    tick()
    assert.equal(requests.length, 2)
    assert.equal(sockets.length, 1, '主动居中无需重新创建 WebSocket')
    assert.equal(frames.at(-1).status, 'syncing')
    assert.deepEqual(frames.at(-1).bids, [])
    message({ e: 'depthUpdate', s: 'BTCUSDT', E: now, U: 199, u: 201, pu: 198, b: [['108', '8']], a: [] })
    requests[1].resolve({ lastUpdateId: 200, E: now, bids: [['108', '3'], ['100', '2']], asks: [['109', '3'], ['120', '4']] })
    await settle()
    tick()
    assert.deepEqual(frames.at(-1).coverage, { lower: 100, upper: 120 })
    assert.deepEqual(frames.at(-1).bids[0], [108, 8])
    tick()
    assert.equal(requests.length, 2, '新快照不应每 500ms 重复获取')
    unsubscribe()
    unsubscribe()
    assert.equal(requests[1].signal.aborted, true, '关闭最后一个观察者释放请求资源')
    const unsubscribeNew = hub.subscribe('BTCUSDT', frame => frames.push(frame))
    sockets[1].emit('open')
    sockets[1].emit('message', Buffer.from(JSON.stringify({ id: 'depth', result: null })))
    assert.notEqual(requests[2].key, requests[1].key, '重新打开不能复用被取消的快照请求键')
    assert.ok(requests[2].key.startsWith('depth:BTCUSDT:'))
    assert.ok(requests[2].key.endsWith(':1000'), '保留档数供网关准确计权')
    unsubscribeNew()
    assert.equal(requests[2].signal.aborted, true)

    const release = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'].map(symbol => hub.subscribe(symbol, () => {}))
    assert.throws(() => hub.subscribe('BNBUSDT', () => {}), /3 个交易对上限/)
    const sameSymbol = hub.subscribe('BTCUSDT', () => {})
    release[0]()
    assert.throws(() => hub.subscribe('BNBUSDT', () => {}), /上限/, '同币种还有观察者时不能释放名额')
    sameSymbol()
    const fourth = hub.subscribe('BNBUSDT', () => {})
    fourth()
    release.forEach(stop => stop())
  } finally {
    unsubscribe?.()
    hub?.close()
    Date.now = originalNow
    globalThis.setInterval = originalInterval
    globalThis.clearInterval = originalClearInterval
    delete globalThis.__depthRecenterFixture
  }
})
