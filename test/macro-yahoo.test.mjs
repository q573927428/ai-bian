// ==================== Yahoo 原生周期与缓存数据清洗测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeYahooKlines, fetchYahooKlines } from '../server/utils/yahoo-finance.ts'
import { MACRO_MARKETS, MACRO_PERIODS, macroStorageSymbol } from '../types/macro-market.ts'
import { initKLineDb, closeKLineDb, appendSimpleKLineData, getSimpleKLineData } from '../server/utils/kline-simple-storage.ts'

/** 构造带上游时间戳的响应，验证休市缺口和报价快照处理。 */
function payload(timestamps, quote, meta = {}) {
  return { chart: { error: null, result: [{ meta: { dataGranularity: '4h', ...meta }, timestamp: timestamps, indicators: { quote: [quote] } }] } }
}

test('原生4H保留休市缺口、过滤空价格并按时间戳覆盖修订值', () => {
  const result = normalizeYahooKlines(payload([90000, 14400, 28800, 14400], {
    open: [10, 20, null, 21], high: [12, 23, 0, 24], low: [9, 19, 0, 20], close: [11, 22, 0, 23],
  }), '4h')
  assert.deepEqual(result, [
    { timestamp: 14400, open: 21, high: 24, low: 20, close: 23, volume: 0 },
    { timestamp: 90000, open: 10, high: 12, low: 9, close: 11, volume: 0 },
  ])
})

test('报价时间快照不能被追加为新的4H柱，未收盘原生柱仍保留', () => {
  const result = normalizeYahooKlines(payload([14400, 28800, 30000], {
    open: [10, 11, 12], high: [13, 14, 15], low: [9, 10, 11], close: [12, 13, 14],
  }, { regularMarketTime: 30000 }), '4h')
  assert.deepEqual(result.map(bar => bar.timestamp), [14400, 28800])
})

test('不接受错误周期、上游错误或冒充日线的单点报价', () => {
  assert.throws(() => normalizeYahooKlines(payload([], {}), '1h'), /周期/)
  assert.throws(() => normalizeYahooKlines({ chart: { error: { description: 'rate limited' } } }, '4h'), /rate limited/)
  assert.throws(() => normalizeYahooKlines(payload([30000], {}, { dataGranularity: '1d', regularMarketTime: 30000 }), '1d'), /暂无原生日线历史/)
})

test('四个Yahoo标的支持五个周期，CQQQ替换恒生科技，EWY读取币安缓存', () => {
  assert.equal(MACRO_MARKETS.filter(market => market.source === 'yahoo').length, 4)
  assert.deepEqual(MACRO_PERIODS, ['15m', '1h', '4h', '1d', '1w'])
  assert.equal(macroStorageSymbol(MACRO_MARKETS.find(market => market.id === 'ewy')), 'EWYUSDT')
  assert.equal(macroStorageSymbol(MACRO_MARKETS.find(market => market.id === 'tnx')), 'YAHOO:^TNX')
  const chinaTech = MACRO_MARKETS.find(market => market.id === 'cqqq')
  assert.equal(macroStorageSymbol(chinaTech), 'YAHOO:CQQQ')
  assert.equal(chinaTech.tradingView, 'AMEX:CQQQ')
  assert.equal(MACRO_MARKETS.some(market => market.symbol === 'HSTECH.HK'), false)
})

test('原生1wk映射为本地1w，保留周起点并过滤周内追加报价快照', () => {
  const quote = { open: [10, 11, 12], high: [13, 14, 15], low: [9, 10, 11], close: [12, 13, 14] }
  const weekly = payload([604800, 1209600, 1400000], quote, { dataGranularity: '1wk', regularMarketTime: 1400000 })
  assert.deepEqual(normalizeYahooKlines(weekly, '1w').map(bar => bar.timestamp), [604800, 1209600])
  assert.throws(() => normalizeYahooKlines(weekly, '1d'), /周期/)
})

test('周线首次请求10y及1wk，增量回退不受分钟历史保留期裁剪', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async url => {
    requests.push(new URL(url))
    return { ok: true, json: async () => payload([604800], { open: [1], high: [2], low: [1], close: [2] }, { dataGranularity: '1wk' }) }
  }
  try {
    await fetchYahooKlines('CQQQ', '1w')
    await fetchYahooKlines('CQQQ', '1w', 604800)
    assert.equal(requests[0].searchParams.get('interval'), '1wk')
    assert.equal(requests[0].searchParams.get('range'), '10y')
    assert.equal(requests[1].searchParams.get('interval'), '1wk')
    assert.equal(requests[1].searchParams.get('period1'), '604800')
    assert.equal(requests[1].searchParams.has('range'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('直接请求4h且增量回退窗口不超出Yahoo分钟历史保留期', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async url => {
    requested = new URL(url)
    return { ok: true, json: async () => payload([14400], { open: [1], high: [2], low: [1], close: [2] }) }
  }
  try {
    await fetchYahooKlines('^TNX', '4h', 1)
    assert.equal(requested.searchParams.get('interval'), '4h')
    assert.equal(decodeURIComponent(requested.pathname.split('/').at(-1)), '^TNX')
    assert.ok(Number(requested.searchParams.get('period1')) >= Math.floor(Date.now() / 1000) - 729 * 86400 - 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Yahoo适配结果写入隔离数据库：覆盖末根、限制495根且不覆盖币安数据', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'macro-kline-test-'))
  const originalDirectory = process.env.KLINE_DATA_DIR
  process.env.KLINE_DATA_DIR = directory
  try {
    await initKLineDb()
    const timestamps = Array.from({ length: 500 }, (_, index) => (index + 1) * 14400)
    const quote = { open: timestamps.map(() => 10), high: timestamps.map(() => 12), low: timestamps.map(() => 9), close: timestamps.map(() => 11) }
    const bars = normalizeYahooKlines(payload(timestamps, quote), '4h')
    assert.equal(appendSimpleKLineData('YAHOO:^TNX', '4h', bars), true)
    assert.equal(appendSimpleKLineData('BTCUSDT', '4h', [bars[0]]), true)
    const last = { ...bars.at(-1), close: 12 }
    assert.equal(appendSimpleKLineData('YAHOO:^TNX', '4h', [last]), true)
    const stored = getSimpleKLineData('YAHOO:^TNX', '4h')
    assert.equal(stored.length, 495)
    assert.equal(stored.at(-1).c, 12)
    assert.equal(stored[0].t, timestamps[5])
    assert.equal(getSimpleKLineData('BTCUSDT', '4h').length, 1)
  } finally {
    await closeKLineDb()
    if (originalDirectory === undefined) delete process.env.KLINE_DATA_DIR
    else process.env.KLINE_DATA_DIR = originalDirectory
    await rm(directory, { recursive: true, force: true })
  }
})
