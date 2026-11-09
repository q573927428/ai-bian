// ==================== 本地 30 日曲线接口回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

/** 执行实际接口，替换本地数据库并禁止引入网络依赖。 */
function fixture(read = () => [], failInit = false) {
  const calls = []
  const context = {
    exports: {},
    defineEventHandler: handler => handler,
    getQuery: query => query,
    require(id) {
      assert.equal(id, '../../utils/kline-simple-storage')
      return {
        initKLineDb: async () => { if (failInit) throw new Error('unavailable') },
        getSimpleKLineData: (symbol, timeframe, options) => {
          calls.push({ symbol, timeframe, options })
          return read(symbol, timeframe, options)
        },
      }
    },
  }
  const source = fs.readFileSync(new URL('../server/api/binance/local-price-curves.get.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return { handler: context.exports.default, calls }
}

test('曲线仅读取最近30日本地数据，过滤无效价格且优先4h', async () => {
  const { handler, calls } = fixture((_symbol, _timeframe, { from, to }) => [
    { t: from - 1, c: 1 }, { t: from, c: 10 }, { t: from + 14400, c: 12 },
    { t: from + 28800, c: NaN }, { t: from + 43200, c: 0 }, { t: to + 1, c: 20 },
  ])
  const result = await handler({ symbols: ' btc/usdt ,BTCUSDT,../bad' })
  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].symbol, 'BTCUSDT')
  assert.equal(calls[0].timeframe, '4h')
  const curve = result.data.BTCUSDT
  assert.equal(curve.to - curve.from, 30 * 86400)
  assert.equal(curve.points.length, 2)
  assert.equal(curve.points[1][1], 12)
})

test('缺少4h时尝试本地日线和小时线，少于两个有效点时留空', async () => {
  const { handler, calls } = fixture((symbol, timeframe, { from }) => {
    if (symbol === 'BTCUSDT' && timeframe === '1d') return [{ t: from, c: 5 }, { t: from + 86400, c: 6 }]
    if (symbol === 'ETHUSDT' && timeframe === '1h') return [{ t: from, c: 6 }, { t: from + 3600, c: 5 }]
    return [{ t: from, c: 10 }]
  })
  const result = await handler({ symbols: 'BTCUSDT,ETHUSDT,MISSINGUSDT' })
  assert.equal(result.data.BTCUSDT.intervalSeconds, 86400)
  assert.equal(result.data.ETHUSDT.intervalSeconds, 3600)
  assert.equal(result.data.MISSINGUSDT, undefined)
  assert.equal(calls.length, 8)
})

test('限制批量数量，空请求与本地数据库故障正常返回空数据', async () => {
  const { handler, calls } = fixture()
  assert.equal(Object.keys((await handler({})).data).length, 0)
  assert.equal(calls.length, 0)
  await handler({ symbols: Array.from({ length: 201 }, (_, index) => `COIN${index}USDT`).join(',') })
  assert.equal(new Set(calls.map(call => call.symbol)).size, 200)
  const failed = fixture(() => [], true)
  const result = await failed.handler({ symbols: 'BTCUSDT' })
  assert.equal(result.success, true)
  assert.equal(Object.keys(result.data).length, 0)
  assert.equal(failed.calls.length, 0)
})
