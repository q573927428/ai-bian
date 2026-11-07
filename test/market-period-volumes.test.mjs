// ==================== 看板多周期成交额聚合与 API 缓存回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { calculatePeriodVolumes } from '../server/utils/market-period-volumes.ts'

const windowEnd = 1800000000000

/** 构造完整的已收盘 24h 窗口；价格和币数量故意不同，确保只累计计价资产成交额。 */
function bars() {
  return Array.from({ length: 288 }, (_, index) => ({
    t: windowEnd / 1000 - (288 - index) * 300,
    o: 3, h: 4, l: 2, c: 3, v: 999, q: 10
  }))
}

test('五周期只累计窗口内成交额，忽略当前未收盘和窗口外 K 线', () => {
  const input = bars()
  input.push({ ...input[0], t: windowEnd / 1000, q: 999999 })
  input.push({ ...input[0], t: windowEnd / 1000 - 86700, q: 999999 })
  assert.deepEqual(calculatePeriodVolumes(input, windowEnd), { '5m': 10, '15m': 30, '1h': 120, '4h': 480, '24h': 2880 })
})

test('缺根或缺额只影响覆盖该缺口的周期，不伪造零成交额', () => {
  const input = bars()
  input.splice(-4, 1)
  assert.deepEqual(calculatePeriodVolumes(input, windowEnd), { '5m': 10, '15m': 30, '1h': null, '4h': null, '24h': null })
  delete input.at(-1).q
  assert.ok(Object.values(calculatePeriodVolumes(input, windowEnd)).every(value => value === null))
})

test('零成交额有效，负数或非有限成交额无效', () => {
  for (const q of [0, -1, NaN, Infinity]) {
    const input = bars()
    input.at(-1).q = q
    assert.equal(calculatePeriodVolumes(input, windowEnd)['5m'], q === 0 ? 0 : null)
  }
})

test('API 只读已选交易对，每个标的一次查询供五周期复用，缓存并合并并发请求', async () => {
  let now = windowEnd + 10000
  let reads = 0
  const context = {
    exports: {},
    Date: class extends Date { static now() { return now } },
    defineEventHandler: handler => handler,
    require(id) {
      if (id === '../../utils/storage') return { getBotConfig: async () => ({ symbols: ['BTC/USDT', 'BTCUSDT'] }) }
      if (id === '../../utils/market-period-volumes') return { calculatePeriodVolumes }
      if (id === '../../utils/kline-simple-storage') return {
        initKLineDb: async () => {},
        getSimpleKLineData(symbol, timeframe, options) {
          reads++
          assert.equal(symbol, 'BTCUSDT')
          assert.equal(timeframe, '5m')
          assert.equal(options.limit, 288)
          assert.equal(options.from, windowEnd / 1000 - 86400)
          assert.equal(options.to, windowEnd / 1000 - 300)
          return bars()
        }
      }
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  const source = fs.readFileSync(new URL('../server/api/market/period-volumes.get.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  const handler = context.exports.default
  const [first, concurrent] = await Promise.all([handler(), handler()])
  assert.equal(first, concurrent)
  assert.equal(reads, 1)
  assert.equal(first.periods['1h'].BTCUSDT, 120)
  assert.equal(first.windowEnd, windowEnd)
  assert.equal(await handler(), first)
  now += 60001
  assert.notEqual(await handler(), first)
  assert.equal(reads, 2)
})
