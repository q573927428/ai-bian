// ==================== 全量热门行情与配置列表回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

/** 模拟币安行情和元数据，避免测试访问网络或本地交易配置。 */
function fixture({ holdDaily = false, failDaily = false, localAge, localGap = false, localMissingToday = false } = {}) {
  let configuredSymbols = ['HALTED/USDT', 'MISSINGUSDT']
  let releaseDaily
  const dailyGate = new Promise(resolve => { releaseDaily = resolve })
  const metadata = Array.from({ length: 240 }, (_, index) => ({
    symbol: `COIN${index}USDT`, contractType: 'PERPETUAL', status: 'TRADING', onboardDate: 1,
  }))
  metadata.push(
    { symbol: 'STOCKUSDT', contractType: 'TRADIFI_PERPETUAL', status: 'TRADING', onboardDate: Math.floor(Date.now() / 86400000) * 86400000 },
    { symbol: 'HALTEDUSDT', contractType: 'PERPETUAL', status: 'SETTLING', onboardDate: 1 },
    { symbol: 'DELIVERYUSDT', contractType: 'CURRENT_QUARTER', status: 'TRADING', onboardDate: 1 },
    { symbol: 'BTCUSDC', contractType: 'PERPETUAL', status: 'TRADING', onboardDate: 1 },
  )
  const tickers = metadata.map((item, index) => ({
    symbol: item.symbol, quoteVolume: String(index + 1), lastPrice: '10', priceChangePercent: '2',
  }))
  const calls = []
  const context = {
    exports: {}, console,
    defineEventHandler: handler => handler,
    getQuery: event => event,
    require(id) {
      if (id === '../../utils/storage') return { getBotConfig: async () => ({ symbols: configuredSymbols }) }
      if (id === '../../utils/binance-exchange-info') return { getBinanceExchangeInfo: async () => ({ symbols: metadata }) }
      if (id === '../../utils/kline-simple-storage') return {
        initKLineDb: async () => {},
        getSimpleKLineLastUpdatedAt: () => localAge === undefined ? null : Date.now() - localAge,
        getSimpleKLineData: (_symbol, timeframe, options) => {
          if (timeframe !== '1d' || localAge === undefined) return []
          const today = Math.floor(Date.now() / 86400000) * 86400
          return Array.from({ length: options.limit }, (_, index) => ({
            t: today - (options.limit - 1 - index + (localMissingToday ? 1 : 0)) * 86400,
            o: 10, c: 10, v: 10000000,
          })).filter((_, index) => !localGap || index !== 5)
        },
      }
      if (id === '../../utils/binance-api-gateway') return { binanceApiGateway: {
        async fetchJson(_group, key) {
          calls.push(key)
          if (key === 'ticker24hr:all' || key === 'stableTicker24hr:all') return tickers
          if (key === 'premiumIndex:all' || key === 'stablePremiumIndex:all') return [{ symbol: 'STOCKUSDT', lastFundingRate: '0.0001' }]
          if (key.startsWith('stableKlines:')) {
            if (holdDaily) await dailyGate
            if (failDaily) throw new Error('模拟日线请求失败')
            return Array.from({ length: 30 }, () => [0, '10', '10', '10', '10', '10000000'])
          }
          throw new Error(`Unexpected request: ${key}`)
        },
      } }
      throw new Error(`Unexpected dependency: ${id}`)
    },
  }
  const source = fs.readFileSync(new URL('../server/api/binance/top-symbols.get.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return { handler: context.exports.default, calls, releaseDaily, setConfiguredSymbols: symbols => { configuredSymbols = symbols } }
}

test('热门返回超过 200 个合约，包含新上线股票 T，排除非交易及非 USDT 永续合约', async () => {
  const { handler, calls } = fixture()
  const result = await handler({ mode: 'hot' })
  assert.equal(result.success, true)
  assert.equal(result.data.length, 241)
  assert.equal(result.data[0].symbol, 'STOCKUSDT')
  assert.equal(result.data[0].contractType, 'TRADIFI_PERPETUAL')
  assert.equal(result.data[0].fundingRate, 0.01)
  assert.equal(result.data[0].priceChangePercentDays, undefined)
  assert.ok(result.data.every((item, index, rows) => index === 0 || rows[index - 1].volume >= item.volume))
  await handler({ mode: 'hot' })
  assert.deepEqual(calls, ['ticker24hr:all', 'premiumIndex:all'])
})

test('配置列表继续保留非交易合约和缺失行情的已配置交易对', async () => {
  const { handler } = fixture()
  const result = await handler({ mode: 'configured' })
  assert.equal(result.data.length, 2)
  assert.equal(result.data.find(item => item.symbol === 'HALTEDUSDT').contractType, 'PERPETUAL')
  assert.ok(Number.isNaN(result.data.find(item => item.symbol === 'MISSINGUSDT').price))
})

test('热门与配置列表共享行情缓存，配置修改立即生效且不再请求币安', async () => {
  const { handler, calls, setConfiguredSymbols } = fixture()
  await handler({ mode: 'hot' })
  const configured = await handler({ mode: 'configured' })
  assert.equal(configured.data.length, 2)
  assert.equal(configured.data.find(item => item.symbol === 'HALTEDUSDT').price, 10)
  setConfiguredSymbols([' coin1/usdt ', 'COIN1USDT', 'STOCKUSDT'])
  const changed = await handler({ mode: 'configured' })
  assert.deepEqual(Array.from(changed.data, item => item.symbol), ['STOCKUSDT', 'COIN1USDT'])
  const hot = await handler({ mode: 'hot' })
  assert.equal(hot.data.length, 241)
  assert.ok(hot.data.every(item => item.symbol !== 'HALTEDUSDT'))
  assert.deepEqual(calls, ['ticker24hr:all', 'premiumIndex:all'])
})

test('同时加载配置列表与热门只获取一份行情，空配置不请求币安', async () => {
  const { handler, calls, setConfiguredSymbols } = fixture()
  setConfiguredSymbols([])
  assert.equal((await handler({ mode: 'configured' })).data.length, 0)
  assert.equal(calls.length, 0)
  setConfiguredSymbols(['COIN1USDT'])
  const [configured, hot] = await Promise.all([handler({ mode: 'configured' }), handler({ mode: 'hot' })])
  assert.equal(configured.data.length, 1)
  assert.equal(hot.data.length, 241)
  assert.deepEqual(calls, ['ticker24hr:all', 'premiumIndex:all'])
})

test('进度查询不触发计算，同参数复用任务并按实际候选完成数更新', async () => {
  const { handler, calls, releaseDaily } = fixture({ holdDaily: true })
  const query = { mode: 'stable', pool: 30 }
  assert.equal((await handler({ ...query, progress: '1' })).progress, null)
  assert.equal(calls.length, 0)
  const pending = handler(query)
  const concurrent = handler(query)
  await new Promise(resolve => setImmediate(resolve))
  const before = calls.length
  const running = await handler({ ...query, progress: '1' })
  assert.equal(running.progress.stage, 'analyzing')
  assert.equal(running.progress.total, 30)
  assert.equal(running.progress.completed, 0)
  assert.equal(calls.length, before)
  releaseDaily()
  const [first, second] = await Promise.all([pending, concurrent])
  assert.equal(first.success, true)
  assert.equal(first.data, second.data)
  const done = await handler({ ...query, progress: '1' })
  assert.equal(done.progress.stage, 'completed')
  assert.equal(done.progress.completed, 30)
  assert.equal(calls.filter(key => key.startsWith('stableKlines:')).length, 30)
  const callCount = calls.length
  const cached = await handler(query)
  assert.equal(cached.data, first.data)
  assert.equal(cached.updatedAt, first.updatedAt)
  assert.equal(calls.length, callCount)
})

test('日线失败的候选仍计入已处理数，进度不会卡在未完成状态', async () => {
  const { handler } = fixture({ failDaily: true })
  const query = { mode: 'stable', pool: 30 }
  const result = await handler(query)
  assert.equal(result.success, true)
  assert.equal(result.data.length, 0)
  const { progress } = await handler({ ...query, progress: '1' })
  assert.equal(progress.stage, 'completed')
  assert.equal(progress.completed, progress.total)
})

test('默认 150 个候选复用完整新鲜的本地日线，结果与远端分析一致', async () => {
  const local = fixture({ localAge: 0 })
  const remote = fixture()
  const query = { mode: 'stable' }
  const actual = await local.handler(query)
  const expected = await remote.handler(query)
  assert.equal(actual.params.pool, 150)
  assert.equal(actual.params.minDaily, 20_000_000)
  assert.equal(actual.params.top, 80)
  assert.equal(actual.data.length, 80)
  assert.deepEqual(JSON.parse(JSON.stringify(actual.data)), JSON.parse(JSON.stringify(expected.data)))
  assert.equal(local.calls.filter(key => key.startsWith('stableKlines:')).length, 0)
  assert.equal(remote.calls.filter(key => key.startsWith('stableKlines:')).length, 150)
  const { progress } = await local.handler({ ...query, progress: '1' })
  assert.equal(progress.total, 150)
  assert.equal(progress.completed, 150)
})

for (const [name, options] of [
  ['过期', { localAge: 31 * 60000 }],
  ['断档', { localAge: 0, localGap: true }],
  ['缺少今天日线', { localAge: 0, localMissingToday: true }],
]) {
  test(`本地日线${name}时回退远端请求`, async () => {
    const { handler, calls } = fixture(options)
    await handler({ mode: 'stable', pool: 30 })
    assert.equal(calls.filter(key => key.startsWith('stableKlines:')).length, 30)
  })
}
