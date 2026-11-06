// ==================== K线同步去重与收盘边界回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/modules/kline-simple-sync/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const isolated = compiled.outputText.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '').replace('export class ', 'class ')

/** 隔离交易所与存储，使用真实同步方法和可控时钟检查请求次数、覆盖范围及保存结果。 */
function createFixture() {
  const state = {
    now: Date.UTC(2026, 10, 6, 12, 0, 10),
    requests: [], saved: [], saveSuccess: true, failFetch: false, incomplete: false
  }
  const interval = 300
  state.last = Math.floor(state.now / 1000 / interval) * interval
  const Service = new Function('Date', 'getSimpleLastKLineTimestamp', 'hasMissingMoneyFlow', 'appendSimpleKLineData', `${isolated}; return KLineSimpleSyncService`)(
    { now: () => state.now }, () => state.last, () => false,
    (_symbol, _timeframe, data) => {
      if (!state.saveSuccess) return false
      state.saved.push(data)
      state.last = Math.max(state.last, ...data.map(item => item.timestamp))
      return true
    }
  )
  const service = Object.assign(Object.create(Service.prototype), {
    recentKLineSyncs: new Map(), SYNC_DEDUP_WINDOW_MS: 15_000,
    syncStatus: new Map(), eventEmitter: { emit() {} },
    async fetchKLineFromBinance(symbol, timeframe, start, end, limit) {
      state.requests.push({ symbol, timeframe, start, limit })
      if (state.failFetch) throw new Error('模拟请求失败')
      const latest = Math.floor(state.now / 1000 / interval) * interval
      return Array.from({ length: state.incomplete ? 8 : 9 }, (_, i) => ({ timestamp: latest - (8 - i) * interval }))
    }
  })
  return { service, state }
}

test('固定同步覆盖最近9根，高频随后跳过；15秒到期重新请求', async () => {
  const { service, state } = createFixture()
  const result = await service.syncSymbolKLine('BTCUSDT', '5m')
  assert.equal(result.success, true)
  assert.equal(state.saved[0].length, 9)
  assert.equal(state.requests[0].start, (state.last - 8 * 300) * 1000)
  assert.ok(state.requests[0].limit >= 9)
  state.now += 14_999
  await service.syncLastBarOnly('BTCUSDT', '5m')
  assert.equal(state.requests.length, 1)
  state.now += 1
  await service.syncLastBarOnly('BTCUSDT', '5m')
  assert.equal(state.requests.length, 2)
})

test('高频成功后固定同步跳过，其他交易对仍独立请求', async () => {
  const { service, state } = createFixture()
  await service.syncLastBarOnly('BTCUSDT', '5m')
  const result = await service.syncSymbolKLine('BTCUSDT', '5m')
  assert.equal(result.count, 0)
  await service.syncLastBarOnly('ETHUSDT', '5m')
  await service.syncLastBarOnly('BTCUSDT', '15m')
  assert.equal(state.requests.length, 3)
})

test('收盘前及收盘后8秒保护期内的更新不会挡住收盘同步', async () => {
  for (const seconds of [-2, 1]) {
    const { service, state } = createFixture()
    const boundary = Date.UTC(2026, 10, 6, 12, 0, 0)
    state.now = boundary + seconds * 1000
    await service.syncLastBarOnly('BTCUSDT', '5m')
    state.now = boundary + 8000
    await service.syncSymbolKLine('BTCUSDT', '5m')
    assert.equal(state.requests.length, 2)
  }
})

test('请求失败或保存失败不产生去重记录，下一次继续请求', async () => {
  for (const failure of ['failFetch', 'saveSuccess']) {
    const { service, state } = createFixture()
    state[failure] = failure === 'failFetch'
    const result = await service.syncSymbolKLine('BTCUSDT', '5m')
    assert.equal(result.success, false)
    assert.equal(service.recentKLineSyncs.size, 0)
    state.failFetch = false
    state.saveSuccess = true
    await service.syncLastBarOnly('BTCUSDT', '5m')
    assert.equal(state.requests.length, 2)
  }
})

test('未连续覆盖最近9根的数据不能用于去重', async () => {
  const { service, state } = createFixture()
  state.incomplete = true
  await service.syncLastBarOnly('BTCUSDT', '5m')
  await service.syncSymbolKLine('BTCUSDT', '5m')
  assert.equal(state.requests.length, 2)
  assert.equal(service.recentKLineSyncs.size, 0)
})

test('高频保存失败或返回空数据时，固定同步仍会请求', async () => {
  for (const empty of [false, true]) {
    const { service, state } = createFixture()
    const fetch = service.fetchKLineFromBinance
    if (empty) service.fetchKLineFromBinance = async () => { state.requests.push({}); return [] }
    else state.saveSuccess = false
    await service.syncLastBarOnly('BTCUSDT', '5m')
    assert.equal(service.recentKLineSyncs.size, 0)
    service.fetchKLineFromBinance = fetch
    state.saveSuccess = true
    const result = await service.syncSymbolKLine('BTCUSDT', '5m')
    assert.equal(result.success, true)
    assert.equal(state.requests.length, 2)
  }
})

test('慢请求不以保存时间延长15秒窗口，离线补齐未追上当前时也不能去重', async () => {
  const { service, state } = createFixture()
  const fetch = service.fetchKLineFromBinance
  service.fetchKLineFromBinance = async (...args) => {
    const data = await fetch.apply(service, args)
    state.now += 16_000
    return data
  }
  await service.syncLastBarOnly('BTCUSDT', '5m')
  assert.equal(service.hasRecentKLineSync('BTCUSDT', '5m'), false)
  service.recentKLineSyncs.clear()
  const latest = Math.floor(state.now / 1000 / 300) * 300 - 300
  service.recordRecentKLineSync('BTCUSDT', '5m', state.now,
    Array.from({ length: 9 }, (_, i) => ({ timestamp: latest - i * 300 })))
  assert.equal(service.recentKLineSyncs.size, 0)
})

test('强制历史同步不受15秒去重影响', async () => {
  const { service, state } = createFixture()
  await service.syncLastBarOnly('BTCUSDT', '5m')
  let historyCalls = 0
  service.config = { maxBars: 495 }
  service.manualSyncHistory = async () => { historyCalls++; return { success: true, totalBars: 495 } }
  const result = await service.syncSymbolKLine('BTCUSDT', '5m', { force: true })
  assert.equal(result.success, true)
  assert.equal(historyCalls, 1)
  assert.equal(state.requests.length, 1)
  assert.equal(service.recentKLineSyncs.size, 0)
})
