// ==================== 历史订单服务端分页与轻量接口回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { queryTradeHistory, getTradeHistoryOptions } from '../server/utils/trade-history-query.ts'

const records = Array.from({ length: 3205 }, (_, index) => ({
  id: String(index), symbol: index % 2 ? 'ETH/USDT' : 'BTC/USDT', strategyId: 'strategy_001',
  direction: 'LONG', openTime: 1000 + index, closeTime: 10000 + index,
  pnl: index % 2 ? -1 : 2, entryScore: 10,
  ...(index % 2 ? {} : { entryScoreBreakdown: { finalScore: 80 }, entryIndicators: { OIChangePercent: 0, EstimatedVolumeEmaRatioPercent: 150 } }),
  aiReasoning: '完整详情',
}))

test('超过 3000 笔仍完整统计，分页只返回当前页并保留详情', () => {
  const result = queryTradeHistory(records, { page: 2, pageSize: 16 })
  assert.equal(result.pagination.total, 3205)
  assert.equal(result.pagination.totalPages, 201)
  assert.equal(result.data.length, 16)
  assert.equal(result.data[0].id, '3188')
  assert.equal(result.data[0].aiReasoning, '完整详情')
  assert.equal(result.summary.orderCount, 3205)
  assert.equal(result.summary.winCount, 1603)
  assert.equal(result.summary.totalPnl, 1604)
  assert.equal(records[0].id, '0', '查询不能修改服务端共享缓存')
})

test('数值筛选包含边界、评分优先采用明细终分，缺指标旧记录不视为零', () => {
  const result = queryTradeHistory(records, { oiMin: 0, oiMax: 0, scoreMin: 80, scoreMax: 80, estimatedVolumeMin: 150, estimatedVolumeMax: 150, pageSize: 1 })
  assert.equal(result.pagination.total, 1603)
  assert.equal(result.summary.totalPnl, 3206)
  assert.equal(result.summary.winRate, 100)
  assert.deepEqual(result.options.symbols, ['BTC/USDT', 'ETH/USDT'])
})

test('缺失排序值双向置底，空结果汇总为零，越界分页回落到最后一页', () => {
  for (const sortDirection of ['asc', 'desc']) {
    const result = queryTradeHistory(records.slice(0, 4), { sortField: 'oiChangePercent', sortDirection })
    assert.deepEqual(result.data.map(r => r.id), ['0', '2', '1', '3'])
  }
  const empty = queryTradeHistory(records, { symbol: 'NONE' })
  assert.equal(empty.pagination.total, 0)
  assert.equal(empty.summary.winRate, 0)
  assert.equal(empty.summary.totalPnl, 0)
  assert.equal(queryTradeHistory(records, { page: 99999, pageSize: 16 }).pagination.page, 201)
  assert.throws(() => queryTradeHistory(records, { pnlMin: 'invalid' }))
  assert.throws(() => queryTradeHistory(records, { sortField: 'aiReasoning' }))
})

/** 在沙箱执行真实接口源码，注入历史数据，不启动交易进程。 */
async function loadHandler(file, trades) {
  const source = await readFile(new URL(`../server/api/bot/${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, defineEventHandler: handler => handler, getQuery: event => event,
    createError: value => new Error(value.statusMessage),
    require: name => {
      if (name.endsWith('trade-history-query')) return { getTradeHistoryOptions }
      if (name.endsWith('trade-history-cache')) return {
        getCachedTradeHistory: () => trades,
        toTradeMarker: record => ({ id: record.id, mainTimeframe: record.mainTimeframe }),
      }
      throw new Error(`未处理依赖: ${name}`)
    },
  })
  return module.exports.default
}

test('收益汇总使用已结算净盈亏，手续费和资金费不重复扣减，回撤保留日内峰谷', async () => {
  const start = Date.UTC(2026, 9, 1)
  // 故意打乱顺序，三笔交易同日完成；日线终值为 5，但日内最大回撤为 15。
  const trades = [
    { id: 'c', symbol: 'BTC/USDT', strategyId: 'a', closeTime: start + 3000, pnl: 10, totalCommission: 3 },
    { id: 'a', symbol: 'BTC/USDT', strategyId: 'a', closeTime: start + 1000, pnl: 10, totalCommission: 2, grossRealizedPnl: 11, fundingFee: 1 },
    { id: 'b', symbol: 'BTC/USDT', strategyId: 'a', closeTime: start + 2000, pnl: -15, totalCommission: 4 },
  ]
  const handler = await loadHandler('history-summary.get.ts', trades)
  const result = handler({})
  assert.equal(result.stats.totalPnl, 5)
  assert.equal(result.stats.netPnl, 5)
  assert.equal(result.stats.totalFee, 9)
  assert.equal(result.stats.maxDrawdown, 15)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].pnl, result.stats.netPnl)
  assert.equal(result.stats.totalTrades, 3)
  assert.equal(result.stats.winRate, 2 / 3 * 100)

  // 筛选后从零重新计算，第一笔即亏损也必须形成回撤。
  const filtered = handler({ startTime: start + 2000, endTime: start + 3000 })
  assert.equal(filtered.stats.netPnl, -15)
  assert.equal(filtered.stats.totalFee, 4)
  assert.equal(filtered.stats.maxDrawdown, 15)
  const empty = handler({ symbol: 'NONE' })
  for (const value of Object.values(empty.stats)) assert.equal(value, 0)
  assert.equal(empty.data.length, 0)
})

test('首页总数包含全部记录，今日统计使用客户端半开时间区间', async () => {
  const handler = await loadHandler('history-overview.get.ts', records)
  const { data } = handler({ startTime: 10000, endTime: 10002 })
  assert.equal(data.totalTrades, 3205)
  assert.equal(data.todayTrades, 2)
  assert.equal(data.todayPnl, 1)
  assert.equal(data.todayWinRate, 50)
  assert.equal(data.totalPnl, 1604)
  assert.throws(() => handler({ startTime: 2, endTime: 1 }))
})

test('K 线旧记录周期从全量历史推断，多个周期时保持不确定状态', async () => {
  const trades = [
    { id: 'old', strategyId: 'a', symbol: 'BTC/USDT', openTime: 1, closeTime: 2 },
    { id: 'new', strategyId: 'a', symbol: 'ETH/USDT', mainTimeframe: '5m', openTime: 1, closeTime: 2 },
  ]
  let handler = await loadHandler('history-markers.get.ts', trades)
  assert.equal(handler({ symbol: 'BTCUSDT' }).data[0].inferredTimeframe, '5m')
  handler = await loadHandler('history-markers.get.ts', [...trades, { ...trades[1], id: 'changed', mainTimeframe: '15m' }])
  assert.equal(handler({ symbol: 'BTCUSDT' }).data[0].inferredTimeframe, undefined)
})

test('快速切换筛选时迟到的旧请求不会覆盖筛选选项和汇总', async () => {
  const source = await readFile(new URL('../app/stores/tradeHistory.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  const pending = []
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    $fetch: (_url, options) => new Promise(resolve => pending.push({ resolve, options })),
    require: name => name === 'pinia' ? { defineStore: (_id, setup) => setup } : { ref: value => ({ value }) },
  })
  const store = module.exports.useTradeHistoryStore()
  const first = store.fetchPage(1, 16)
  store.setFilter({ symbol: 'ETH/USDT' })
  const second = store.fetchPage(1, 16)
  const response = symbol => ({ success: true, data: [], options: { symbols: [symbol], strategies: [], closeCategories: [] }, summary: { orderCount: symbol === 'ETH/USDT' ? 2 : 1 } })
  pending[1].resolve(response('ETH/USDT'))
  await second
  pending[0].resolve(response('BTC/USDT'))
  assert.equal(await first, null)
  assert.equal(store.availableSymbols.value[0], 'ETH/USDT')
  assert.equal(store.filteredSummary.value.orderCount, 2)
  assert.equal(pending[1].options.params.symbol, 'ETH/USDT')
  assert.equal(pending[1].options.params.pageSize, 16)
})
