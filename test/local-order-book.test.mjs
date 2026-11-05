// ==================== 本地订单簿同步与失效回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/utils/local-order-book.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { LocalOrderBook } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
const snapshot = () => ({ lastUpdateId: 100, E: Date.now(), bids: [['99', '2'], ['98', '3']], asks: [['101', '2'], ['102', '4']] })
const update = (overrides = {}) => ({ e: 'depthUpdate', s: 'BTCUSDT', E: Date.now(), U: 99, u: 101, pu: 98, b: [], a: [], ...overrides })

test('先缓存增量再衔接快照，绝对数量替换且零数量删除', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.update(update({ b: [['99', '7'], ['98', '0']] }))
  assert.equal(book.snapshot().status, 'syncing')
  book.load(snapshot())
  assert.equal(book.snapshot().status, 'live')
  assert.deepEqual(book.snapshot().bids, [[99, 7]])
  book.update(update({ U: 102, u: 103, pu: 101, b: [['99', '1']] }))
  assert.deepEqual(book.snapshot().bids, [[99, 1]])
})

test('快照序号等于首个事件最终序号也可衔接，重复旧事件不回滚数量', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.load(snapshot())
  book.update(update({ u: 100, b: [['99', '5']] }))
  book.update(update({ u: 100, b: [['99', '1']] }))
  assert.equal(book.snapshot().status, 'live')
  assert.deepEqual(book.snapshot().bids[0], [99, 5])
})

test('首事件不能越过快照，后续事件必须通过 pu 连续性检查', () => {
  const first = new LocalOrderBook('BTCUSDT')
  first.load(snapshot())
  assert.throws(() => first.update(update({ U: 102, u: 103 })), /断档/)
  const next = new LocalOrderBook('BTCUSDT')
  next.load(snapshot())
  next.update(update())
  assert.throws(() => next.update(update({ U: 104, u: 105, pu: 103 })), /断档/)
})

test('同步前和陈旧盘口不发布挂单，已知覆盖范围以外的增量不混入', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.load(snapshot())
  assert.deepEqual(book.snapshot().bids, [])
  book.update(update({ b: [['97', '100']], a: [['103', '100']] }))
  const live = book.snapshot()
  assert.deepEqual(live.coverage, { lower: 98, upper: 102 })
  assert.equal(live.bids.length, 2)
  assert.equal(live.asks.length, 2)
  const stale = book.snapshot(Date.now() + 11000)
  assert.equal(stale.status, 'stale')
  assert.deepEqual(stale.bids, [])
  assert.equal(stale.coverage, null)
})

test('延迟的交易所消息不能伪装新鲜行情', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.load(snapshot())
  book.update(update({ E: Date.now() - 15000 }))
  assert.equal(book.snapshot().status, 'stale')
})

test('上移和下移接近覆盖边缘时重居中，普通波动与冷却期间不重复请求', () => {
  const originalNow = Date.now
  let now = 100000
  Date.now = () => now
  try {
    for (const direction of ['up', 'down']) {
      now = 100000
      const book = new LocalOrderBook('BTCUSDT')
      book.load({ lastUpdateId: 100, E: now, bids: [['99', '2'], ['90', '3']], asks: [['101', '2'], ['110', '4']] })
      book.update(update())
      now += 31000
      assert.equal(book.needsRecenter(), false, '居中盘口不因时间流逝自动重取快照')
      now = 110000
      book.update(update({ U: 102, u: 103, pu: 101,
        b: direction === 'up' ? [['108', '3']] : [['99', '0'], ['91', '3']],
        a: direction === 'up' ? [['101', '0'], ['109', '3']] : [['92', '3']] }))
      assert.equal(book.needsRecenter(), false, '覆盖未耗尽时尊重快照冷却')
      now = 130000
      assert.equal(book.needsRecenter(), true, '覆盖明显偏移后请求居中')
    }
  } finally { Date.now = originalNow }
})

test('重居中用新簿缓存增量并衔接新边界，旧边界之外的买盘可正常出现', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.update(update({ U: 199, u: 201, pu: 198, b: [['95', '8']] }))
  book.load({ lastUpdateId: 200, E: Date.now(), bids: [['96', '2'], ['90', '3']], asks: [['97', '2'], ['100', '4']] })
  assert.equal(book.snapshot().status, 'live')
  assert.deepEqual(book.snapshot().coverage, { lower: 90, upper: 100 })
  assert.ok(book.snapshot().bids.some(([price, quantity]) => price === 95 && quantity === 8))
})

test('错误币种被忽略；价格越界、非法值和交叉盘口触发重建', () => {
  const book = new LocalOrderBook('BTCUSDT')
  book.load(snapshot())
  book.update(update({ s: 'ETHUSDT' }))
  assert.equal(book.snapshot().status, 'syncing')
  assert.throws(() => book.update(update({ b: [['99', 'NaN']] })), /无效/)
  const crossed = new LocalOrderBook('BTCUSDT')
  crossed.load(snapshot())
  assert.throws(() => crossed.update(update({ b: [['101', '2']] })), /交叉/)
  const depleted = new LocalOrderBook('BTCUSDT')
  depleted.load(snapshot())
  assert.throws(() => depleted.update(update({ b: [['98', '0'], ['99', '0']] })), /重建/)
})

test('价格在冷却期快速跳出旧范围时立即失效，不能继续发布旧盘口', () => {
  for (const changes of [{ b: [['103', '2']] }, { a: [['97', '2']] }]) {
    const book = new LocalOrderBook('BTCUSDT')
    book.load(snapshot())
    book.update(update())
    assert.equal(book.isLive(), true)
    assert.throws(() => book.update(update({ U: 102, u: 103, pu: 101, ...changes })), /走出覆盖范围/)
    assert.equal(book.isLive(), false)
    assert.deepEqual(book.snapshot().bids, [])
    assert.deepEqual(book.snapshot().asks, [])
  }
})

test('全零或价格交叉的快照在载入时拒绝', () => {
  const empty = new LocalOrderBook('BTCUSDT')
  assert.throws(() => empty.load({ ...snapshot(), bids: [['99', '0']] }), /无效盘口快照/)
  const crossed = new LocalOrderBook('BTCUSDT')
  assert.throws(() => crossed.load({ ...snapshot(), bids: [['102', '1']] }), /无效盘口快照/)
})
