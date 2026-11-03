// ==================== 情绪采集合并、失败回退与刷新隔离回归 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

/** 执行真实源码，隔离网络和历史文件，避免测试接触交易所或改写运行数据。 */
function evaluate(path, dependencies, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const context = { exports: {}, setTimeout, clearTimeout, AbortSignal, ...globals,
    require: id => dependencies[id] ?? {} }
  vm.runInNewContext(result.outputText, context, { filename: path })
  return context.exports
}

/** 可推进时钟和可替换网络行为，用于验证过期状态、请求数量与冷却期。 */
function fixture() {
  const clock = { now: Date.UTC(2026, 10, 3, 10) }
  class FixtureDate extends Date {
    static now() { return clock.now }
  }
  const requests = []
  const logs = []
  const posts = [
    { id: 1, date: clock.now / 1000 - 60, tendency: 1 },
    { id: 2, date: clock.now / 1000 - 3600, tendency: 2 }
  ]
  const network = { async fetch() {
    return { ok: true, async json() { return { code: '000000', data: { feedData: posts } } } }
  } }
  const api = evaluate('../server/utils/square-heat.ts', {
    'node:fs': { existsSync: () => false, mkdirSync() {}, writeFileSync() {} },
    'node:path': { join: (...parts) => parts.join('/') },
    './logger': { logger: { warn: (...args) => logs.push(args) } }
  }, { Date: FixtureDate, process: { cwd: () => '/isolated' },
    fetch: (...args) => { requests.push(args); return network.fetch(...args) } })
  return { api, clock, requests, network, logs }
}

test('并发与串行的不同窗口共享帖子请求，统计窗口独立且不重复记录历史', async () => {
  const { api, requests } = fixture()
  const results = await Promise.all([api.getSquareHeat('BTC/USDT', 30), api.getSquareHeat('BTC/USDT', 1440)])
  assert.equal(results[0].postCount, 1)
  assert.equal(results[1].postCount, 2)
  assert.equal(requests.length, 1)
  assert.equal((await api.getSquareHeat('BTC/USDT', 3600)).postCount, 2)
  assert.equal(requests.length, 1)
  assert.equal((await api.getSquareHeat('BTC/USDT', 30)).historyAvg, 0)
})

test('过期后失败保留原数值和时间，标记过期并在冷却期内合并失败', async () => {
  const { api, clock, requests, network, logs } = fixture()
  const initial = await api.getSquareHeat('BTCUSDT', 30)
  clock.now += 31 * 60000
  network.fetch = async () => { throw new Error('模拟网络故障') }
  const fallback = await api.getSquareHeat('BTCUSDT', 30)
  assert.equal(fallback.postCount, initial.postCount)
  assert.equal(fallback.lastUpdated, initial.lastUpdated)
  assert.equal(fallback.stale, true)
  assert.match(fallback.refreshError, /page=1.*模拟网络故障/)
  assert.equal(api.getCachedSquareHeat('BTCUSDT', 30).stale, true)
  await api.getSquareHeat('BTCUSDT', 30)
  await assert.rejects(api.getSquareHeat('BTCUSDT', 3000), /模拟网络故障/)
  assert.equal(requests.length, 2)
  assert.equal(logs.length, 1)
  clock.now += 60001
  network.fetch = async () => ({ ok: true, json: async () => ({ data: { feedData: [] } }) })
  const recovered = await api.getSquareHeat('BTCUSDT', 30)
  assert.equal(recovered.postCount, 0)
  assert.equal(recovered.stale, undefined)
  assert.equal(recovered.lastUpdated, clock.now)
})

test('共享分页按帖子标识去重，较短窗口不混入窗口外样本', async () => {
  const { api, clock, network, requests } = fixture()
  const recent = Array.from({ length: 100 }, (_, id) => ({ id, date: clock.now / 1000 - 60, tendency: 1 }))
  network.fetch = async url => ({ ok: true, json: async () => ({ data: { feedData:
    new URL(url).searchParams.get('pageIndex') === '1' ? recent
      : [recent[0], { id: 101, date: clock.now / 1000 - 3600, tendency: 2 }]
  } }) })
  const [short, long] = await Promise.all([api.getSquareHeat('BTCUSDT', 30), api.getSquareHeat('BTCUSDT', 1440)])
  assert.equal(requests.length, 2)
  assert.equal(short.postCount, 100)
  assert.equal(long.postCount, 101)
  assert.equal(long.bearishCount, 1)
})

test('错误响应和响应体错误不得缓存为零，冷启动明确失败', async () => {
  const { api, network, requests } = fixture()
  network.fetch = async () => ({ ok: true, json: async () => ({ code: 'blocked', data: {} }) })
  await assert.rejects(api.getSquareHeat('BTCUSDT'), /无效数据/)
  assert.equal(api.getCachedSquareHeat('BTCUSDT'), undefined)
  await assert.rejects(api.getSquareHeat('BTCUSDT', 30), /无效数据/)
  assert.equal(requests.length, 1)
})

test('回退数据六小时后清理，不无限保留', async () => {
  const { api, clock } = fixture()
  await api.getSquareHeat('BTCUSDT')
  clock.now += 6 * 60 * 60000
  assert.equal(api.getCachedSquareHeat('BTCUSDT'), undefined)
  api.cleanExpiredSquareHeatCache()
  assert.equal(api.getSquareHeatCacheStatus().size, 0)
})

test('币种过期时间错开且不超过30分钟', async () => {
  const { api, clock } = fixture()
  await api.getSquareHeat('BTCUSDT')
  await api.getSquareHeat('ETHUSDT')
  const startedAt = clock.now
  const expiredAt = []
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    for (let second = 25 * 60; second <= 30 * 60; second++) {
      clock.now = startedAt + second * 1000
      if (api.getCachedSquareHeat(symbol).stale) { expiredAt.push(second); break }
    }
  }
  assert.equal(expiredAt.length, 2)
  assert.notEqual(expiredAt[0], expiredAt[1])
})

test('超时信号覆盖响应体读取，超时不生成默认数据', async () => {
  const durations = []
  const api = evaluate('../server/utils/square-heat.ts', {
    'node:fs': { existsSync: () => false, mkdirSync() {}, writeFileSync() {} },
    'node:path': { join: (...parts) => parts.join('/') },
    './logger': { logger: { warn() {} } }
  }, { process: { cwd: () => '/isolated' },
    AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout(ms) {
      durations.push(ms)
      const controller = new AbortController()
      setTimeout(() => controller.abort(new Error('模拟超时')), 5)
      return controller.signal
    } },
    fetch: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) })
  })
  await assert.rejects(api.getSquareHeat('BTCUSDT'), /模拟超时/)
  assert.deepEqual(durations, [30000, 8000])
  assert.equal(api.getCachedSquareHeat('BTCUSDT'), undefined)
})

test('情绪挂起时 OI 刷新完成，工作协程受并发限制且停止后不派发新币种', async () => {
  let release
  let active = 0
  let maxActive = 0
  let sentimentCalls = 0
  const blocked = new Promise(resolve => { release = resolve })
  const { IndicatorsHub } = evaluate('../server/modules/indicators/IndicatorsHub.ts', {
    './OISnapshotService': { OISnapshotService: class {
      pruneExpiredHistory() {}
      async bootstrapSymbol() {}
    } },
    './SupportResistanceCache': { SupportResistanceCache: class {} },
    '../../../types/square-heat-config': { normalizeSquareHeatWindows: () => ({ '5m': 30 }) },
    '../../utils/logger': { logger: { warn() {}, error() {} } },
    '../../utils/binance-api-gateway': { binanceApiGateway: { shouldPauseBackgroundWork: () => false } },
    '../../utils/square-heat': { cleanExpiredSquareHeatCache() {}, async getSquareHeat() {
      sentimentCalls++
      maxActive = Math.max(maxActive, ++active)
      await blocked
      active--
    } }
  })
  const hub = new IndicatorsHub({}, {})
  for (let i = 0; i < 8; i++) hub.symbolDataCache.set(`SYM${i}`, {})
  hub.getKlines = () => []
  let oiCalls = 0
  hub.fetchAndCacheOI = async () => { oiCalls++ }
  const sentiment = hub.refreshSentimentData()
  await hub.refreshAllData()
  assert.equal(oiCalls, 8)
  assert.equal(hub.isRefreshingAllData, false)
  assert.equal(hub.isRefreshingSentiment, true)
  await hub.refreshSentimentData()
  assert.equal(maxActive, 2)
  assert.equal(sentimentCalls, 2)
  hub.stopUpdateLoop()
  release()
  await sentiment
  assert.equal(sentimentCalls, 2)
  assert.equal(hub.isRefreshingSentiment, false)
})

test('策略指标拒绝过期情绪样本，恢复后沿用真实采集时间', async () => {
  const state = { stale: true }
  const { IndicatorsHub } = evaluate('../server/modules/indicators/IndicatorsHub.ts', {
    './OISnapshotService': { OISnapshotService: class {} },
    './SupportResistanceCache': { SupportResistanceCache: class {} },
    '../../utils/square-heat': { getSquareHeat: async () => ({
      stale: state.stale, lastUpdated: 12345, postCount: 10
    }) }
  })
  const hub = new IndicatorsHub({}, {})
  await assert.rejects(hub.getIndicators('BTCUSDT', '1h', 'SquareHeat'), /社区情绪已过期/)
  state.stale = false
  const indicator = await hub.getIndicators('BTCUSDT', '1h', 'SquareHeat')
  assert.equal(indicator.timestamp, 12345)
  assert.equal(indicator.values.postCount, 10)
})
