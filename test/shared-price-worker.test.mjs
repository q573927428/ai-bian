// ==================== 跨标签页价格连接复用回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

/** 在隔离 Worker 上下文模拟多个页面，不依赖浏览器或交易服务。 */
function fixture() {
  let now = 100000
  let sweep
  const streams = []
  const context = {
    Map, JSON, Date: { now: () => now }, self: {},
    setInterval: callback => { sweep = callback },
    EventSource: class {
      handlers = {}
      closed = false
      constructor(url) { assert.equal(url, '/api/market/prices/stream'); streams.push(this) }
      addEventListener(name, handler) { this.handlers[name] = handler }
      close() { this.closed = true }
    }
  }
  vm.runInNewContext(readFileSync(new URL('../public/workers/market-prices.js', import.meta.url), 'utf8'), context)
  const open = () => {
    const messages = []
    const port = { postMessage: data => messages.push(data), start() {}, close() {} }
    context.self.onconnect({ ports: [port] })
    const send = data => port.onmessage({ data })
    send('connect')
    return { messages, send }
  }
  return { streams, open, advance: ms => { now += ms }, sweep: () => sweep() }
}

test('三个标签页共享一条价格 SSE，晚加入收到合并快照，最后退出才关闭', () => {
  const f = fixture()
  const first = f.open()
  f.streams[0].onopen()
  f.streams[0].handlers.snapshot({ data: JSON.stringify({ prices: { BTCUSDT: { price: 100 } } }) })
  f.streams[0].handlers.prices({ data: JSON.stringify({ prices: { BTCUSDT: { price: 101 } } }) })
  const second = f.open()
  const third = f.open()
  assert.equal(f.streams.length, 1)
  assert.equal(JSON.parse(second.messages.find(m => m.type === 'snapshot').data).prices.BTCUSDT.price, 101)
  const count = third.messages.length
  third.send('connect')
  assert.equal(third.messages.length, count, '心跳不能重复发送旧快照并伪装成价格更新')
  first.send('close')
  second.send('close')
  assert.equal(f.streams[0].closed, false)
  third.send('close')
  assert.equal(f.streams[0].closed, true)
})

test('休眠标签页过期后释放连接，恢复心跳可重新注册；不回放陈旧价格', () => {
  const f = fixture()
  const first = f.open()
  f.streams[0].onopen()
  f.streams[0].handlers.snapshot({ data: JSON.stringify({ prices: { BTCUSDT: { price: 100 } } }) })
  f.advance(11000)
  const second = f.open()
  assert.equal(second.messages.filter(m => m.type === 'snapshot').length, 0)
  f.advance(100000)
  f.sweep()
  assert.equal(f.streams[0].closed, true)
  first.send('connect')
  assert.equal(f.streams.length, 2)
  first.send('close')
  assert.equal(f.streams[1].closed, true)
})
