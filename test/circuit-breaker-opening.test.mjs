// ==================== 策略每日亏损开仓门禁回归测试 ====================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const logger = { info() {}, warn() {}, error() {}, success() {} }
const require = createRequire(import.meta.url)

/** 执行真实源码，仅隔离交易所、日志和持久化依赖，避免连接实盘或改写交易数据。 */
function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = {
    exports: {}, setTimeout, clearTimeout, clearInterval,
    require: id => dependencies[id] ?? (id.startsWith('node:') ? require(id) : {}),
    ...globals
  }
  vm.runInNewContext(compiled.outputText, context, { filename: path })
  return context.exports
}

const tradeHelpers = loadModule('../server/utils/trade-helpers.ts')
const hashes = loadModule('../server/utils/stable-hash.ts')
const { SnapshotIndicatorCalculator } = loadModule('../server/modules/strategy-engine/SnapshotIndicatorCalculator.ts', {
  '../../utils/stable-hash': hashes
})
const riskCalculations = loadModule('../server/utils/indicators-risk.ts')
const riskDependencies = { '../../utils/logger': { logger } }
const dailyRisk = loadModule('../server/modules/risk-control/DailyRiskState.ts', riskDependencies)

/** 保留真实开仓、下单和门禁流程，用可控制的异步边界模拟触发熔断。 */
function createFixture(now = Date.now()) {
  const clock = { now }
  /** 固定源码中使用的时间，模拟北京时间跨日，不修改测试进程的全局时钟。 */
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  const globals = { Date: FixtureDate }
  const dailyRiskState = loadModule('../server/modules/risk-control/DailyRiskState.ts', riskDependencies, globals)
  const hooks = {}
  const calls = { reserved: 0, released: [], committed: 0, locked: [], unlocked: [], orders: [], snapshots: 0, persisted: [], balanceFetches: 0 }
  const positions = new Map()
  const state = {
    riskDayKey: dailyRisk.getRiskDayKey(now)
  }
  const trigger = () => {
    // 平仓会整体替换策略门禁，检查方必须始终读取共享状态中的最新对象。
    const risk = dailyRiskState.getStrategyDailyRiskState(state, 'strategy-a')
    risk.circuitBreaker = { ...risk.circuitBreaker, isTriggered: true, reason: '策略 strategy-a 当日亏损达到上限，今日禁止继续开仓', timestamp: clock.now }
  }
  const storage = { async saveBotState(value) { calls.persisted.push(JSON.parse(JSON.stringify(value))) } }
  const { BinanceService } = loadModule('../server/utils/binance.ts', {
    './logger': { logger },
    './binance-api-gateway': {
      binanceApiGateway: {
        async trade(key, submit) {
          await hooks.beforeDispatch?.(key)
          return submit()
        }
      }
    }
  }, globals)
  const binance = Object.assign(Object.create(BinanceService.prototype), {
    privateExchange: {
      async createOrder(symbol, type, side, amount) {
        calls.orders.push({ symbol, type, side, amount })
        if (type === 'STOP_MARKET') await hooks.onStopLoss?.()
        else await hooks.onMarketOrder?.()
        return { id: String(calls.orders.length), symbol, side, amount, average: 100, price: 100 }
      }
    },
    async fetchBalance() { calls.balanceFetches++; await hooks.onFetchBalance?.(); const balance = hooks.accountBalance ?? 1000; return { balance, availableBalance: balance } },
    async fetchPrice() { return 100 },
    async setLeverage(symbol, leverage) { return leverage },
    async setMarginMode() {},
    async calculateOrderAmount(symbol, usdtAmount, price) { return usdtAmount / price },
    async waitForOrderExecutionSummary() { return null }
  })
  const positionManager = {
    async hasConflict() { return false },
    lockSymbol(symbol) { calls.locked.push(symbol) },
    unlockSymbol(symbol) { calls.unlocked.push(symbol) },
    recordPosition(symbol, position) { positions.set(symbol, position) },
    getPosition(symbol) { return positions.get(symbol) },
    clearPosition(symbol) { positions.delete(symbol) }
  }
  const { StrategyEngine } = loadModule('../server/modules/strategy-engine/StrategyEngine.ts', {
    './SnapshotIndicatorCalculator': { SnapshotIndicatorCalculator },
    '../../utils/logger': { logger },
    '../../utils/storage': storage,
    '../risk-control/DailyRiskState': dailyRiskState,
    '../../utils/indicators-risk': riskCalculations,
    '../../utils/trade-helpers': tradeHelpers,
    '../indicators/support-resistance-entry': { summarizeEntrySupportResistance: () => undefined },
    './helpers/position-helpers': { waitAndConfirmPosition: async () => ({ quantity: 0.5, entryPrice: 100 }) },
    '../../utils/trade-decision-store': {
      async saveTradeDecision() { await hooks.afterDecisionSaved?.(); return 'analysis-id' },
      getAnalysisMonth: () => '2026-10'
    }
  }, globals)
  const instance = {
    isRunning: true, totalSignals: 0, totalTrades: 0, winTrades: 0,
    strategy: {
      id: 'strategy-a', name: '测试策略', indicators: [], statistics: [],
      marketData: { symbols: ['BTCUSDT', 'ETHUSDT'], timeframes: ['5m'] },
      executionConfig: { leverage: 5, scanInterval: 5 },
      riskManagement: { maxDailyTrades: 5, maxDailyLoss: 10, maxRiskPercentage: 1, stopLossATRMultiplier: 2, takeProfitRatios: [1, 2] }
    }
  }
  const strategies = new Map([[instance.strategy.id, instance.strategy]])
  const store = { async getStrategy(id) { await hooks.onGetStrategy?.(id); return strategies.get(id) ?? null } }
  const snapshot = { price: 100, indicatorsByTimeframe: new Map() }
  const engine = Object.assign(Object.create(StrategyEngine.prototype), {
    state, binance, positionManager, store, config: { strategyScheduler: { symbolBatchSize: 1, symbolBatchDelayMs: 0 } },
    runningStrategies: new Map([[instance.strategy.id, instance]]),
    scansPaused: false, isGlobalLoopRunning: false, globalScanInterval: 300000,
    currentLoopAIRequests: 0, loopStats: { scanCount: 0 },
    dailyTradeLimiter: {
      async reserve() {
        calls.reserved++
        return { allowed: hooks.dailyLimitReached !== true, reservationId: 'reservation', openedCount: 5, reservedCount: 0, limit: 5 }
      },
      async commit() { calls.committed++ },
      async release(id) { calls.released.push(id) }
    },
    concurrencyPoolManager: { getIndicatorPool: () => ({ submit: task => task() }) },
    scheduler: { async buildMarketSnapshot() { calls.snapshots++; await hooks.onSnapshot?.(); return snapshot } }
  })
  const signal = {
    strategyId: instance.strategy.id, symbol: 'BTCUSDT', direction: 'long', action: 'open',
    price: 100, confidence: 100, reasoning: '测试开仓', indicators: { atr: 1 }, riskLevel: 'LOW'
  }
  return { engine, binance, instance, signal, snapshot, state, trigger, hooks, calls, positions, positionManager, clock, globals, dailyRiskState, storage, strategies, store }
}

/** 增加独立配置的策略，验证每日亏损门禁不会阻止其他策略。 */
function addStrategy(f, id, maxDailyLoss) {
  const instance = structuredClone(f.instance)
  instance.strategy.id = id
  instance.strategy.name = id
  instance.strategy.marketData.symbols = ['SOLUSDT']
  instance.strategy.riskManagement.maxDailyLoss = maxDailyLoss
  f.strategies.set(id, instance.strategy)
  f.engine.runningStrategies.set(id, instance)
  return instance
}

/** 保留真实平仓入口和每日风控结算，仅以固定结算结果隔离币安历史查询。 */
function createCloser(f, { netPnl = -1, closeTime = f.clock.now } = {}) {
  const { StrategyPositionCloser } = loadModule('../server/modules/strategy-engine/StrategyPositionCloser.ts', {
    '../../utils/logger': { logger },
    '../../utils/trade-helpers': tradeHelpers,
    '../../utils/storage': f.storage,
    '../risk-control/DailyRiskState': f.dailyRiskState,
    './helpers/trade-recorder': { async recordTrade() {} }
  }, f.globals)
  const closer = new StrategyPositionCloser(f.binance, f.positionManager, {}, f.state, f.store)
  closer.resolveSettlement = async () => ({
    exitPrice: 100, totalCommission: 0, netPnl, netPnlPercentage: netPnl, closeTime,
    settlement: { grossRealizedPnl: netPnl, entryCommission: 0, exitCommission: 0, fundingFee: 0, closeTime }
  })
  return closer
}

test('策略每日亏损门禁阻止该策略所有方向开仓，且不预占次数或锁定交易对', async () => {
  const f = createFixture()
  f.trigger()
  for (const direction of ['long', 'short']) {
    await assert.rejects(f.engine.executeSignal(f.instance, { ...f.signal, direction }, new Map()), /策略熔断.*当日亏损达到上限/)
  }
  assert.equal(f.calls.reserved, 0)
  assert.deepEqual(f.calls.locked, [])
  assert.deepEqual(f.calls.orders, [])
})

test('不需要全局运行字段即可正常开仓，各策略通过自身实例管理运行状态', async () => {
  const f = createFixture()
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.deepEqual(f.calls.orders.map(order => order.type), ['market', 'STOP_MARKET'])
  assert.equal(f.calls.committed, 1)
  assert.equal(f.positions.size, 1)
  assert.equal(f.instance.totalTrades, 1)
  assert.deepEqual(f.calls.released, [])
})

test('同策略与跨策略连续亏损超过 5 笔，低于各自 maxDailyLoss 时仍可开仓', async () => {
  const f = createFixture()
  const other = addStrategy(f, 'strategy-b', 15)
  const closer = createCloser(f)
  for (let i = 0; i < 6; i++) await closer.updateRiskStateAfterClose('strategy-a', -1, f.clock.now)
  for (let i = 0; i < 6; i++) await closer.updateRiskStateAfterClose('strategy-b', -1, f.clock.now)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -6)
  assert.equal(f.state.strategyDailyRisk['strategy-b'].dailyPnL, -6)
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  await f.engine.executeSignal(other, { ...f.signal, strategyId: 'strategy-b', symbol: 'SOLUSDT' }, new Map())
  assert.equal(f.calls.committed, 2)
})

test('多策略自动扫描和强制开仓仅维护策略风控数据', async () => {
  const f = createFixture()
  addStrategy(f, 'strategy-b', 10)
  f.engine.analyzeSymbol = async (instance, symbol) => {
    await f.engine.executeSignal(instance, { ...f.signal, strategyId: instance.strategy.id, symbol }, new Map())
  }
  await f.engine.globalStrategyLoop()
  assert.equal(f.calls.committed, 3)
  assert.equal(Object.keys(f.state).sort().join(','), 'riskDayKey,strategyDailyRisk')
  const result = await f.engine.forceOpenPosition('strategy-a', 'XRPUSDT', 'short')
  assert.equal(result.success, true)
  assert.equal(f.calls.committed, 4)
})

test('平仓持久化仅保留各策略每日风控，不生成全局状态或连续亏损计数', async () => {
  const f = createFixture()
  f.positions.set('BTCUSDT', { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} })
  await createCloser(f, { netPnl: -10 }).closePosition('BTCUSDT', '止损')
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断/)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  const persisted = f.calls.persisted.at(-1)
  assert.equal(Object.keys(persisted).sort().join(','), 'riskDayKey,strategyDailyRisk')
  assert.equal(Object.keys(persisted.strategyDailyRisk['strategy-a'].circuitBreaker).sort().join(','), 'dailyLoss,isTriggered,reason,timestamp')
})

test('未熔断仍需遵守每日开仓次数上限', async () => {
  const f = createFixture()
  f.hooks.dailyLimitReached = true
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.equal(f.calls.reserved, 1)
  assert.deepEqual(f.calls.orders, [])
  assert.deepEqual(f.calls.locked, [])
})

test('决策归档等待期间熔断，下单前拦截并释放每日名额与交易对锁', async () => {
  const f = createFixture()
  f.signal.decisionSnapshot = { requestedAt: Date.now() }
  f.hooks.afterDecisionSaved = f.trigger
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  assert.deepEqual(f.calls.orders, [])
  assert.equal(f.calls.committed, 0)
  assert.deepEqual(f.calls.released, ['reservation'])
  assert.deepEqual(f.calls.unlocked, ['BTCUSDT'])
})

test('订单进入交易所限流队列后熔断，实际发送前再次拦截', async () => {
  const f = createFixture()
  f.hooks.beforeDispatch = f.trigger
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  assert.deepEqual(f.calls.orders, [])
  assert.equal(f.calls.committed, 0)
  assert.deepEqual(f.calls.released, ['reservation'])
  assert.deepEqual(f.calls.unlocked, ['BTCUSDT'])
})

test('市价单已提交后触发熔断，仍完成止损设置和持仓记录', async () => {
  const f = createFixture()
  f.hooks.onMarketOrder = f.trigger
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.deepEqual(f.calls.orders.map(order => order.type), ['market', 'STOP_MARKET'])
  assert.equal(f.calls.committed, 1)
  assert.equal(f.positions.size, 1)
})

test('熔断期间止损设置失败，保护性反向平仓仍可提交', async () => {
  const f = createFixture()
  f.hooks.onMarketOrder = f.trigger
  f.hooks.onStopLoss = () => { throw new Error('模拟止损失败') }
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /模拟止损失败/)
  assert.deepEqual(f.calls.orders.map(order => [order.type, order.side]), [
    ['market', 'buy'], ['STOP_MARKET', 'sell'], ['market', 'sell']
  ])
  assert.equal(f.calls.committed, 1)
  assert.deepEqual(f.calls.released, [])
})

test('手动强制开仓和手动分析返回明确熔断原因，不构建市场快照', async () => {
  const f = createFixture()
  f.trigger()
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断.*当日亏损达到上限/)
  await assert.rejects(f.engine.analyzeSymbolForTest('strategy-a', 'BTCUSDT'), /策略熔断.*当日亏损达到上限/)
  assert.equal(f.calls.snapshots, 0)
  assert.deepEqual(f.calls.orders, [])
})

test('强制开仓获取快照期间熔断，不能返回开仓成功', async () => {
  const f = createFixture()
  f.hooks.onSnapshot = f.trigger
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断/)
  assert.deepEqual(f.calls.orders, [])
  assert.equal(f.calls.reserved, 0)
})

test('策略熔断暂停该策略扫描，已开始的一轮跳过该策略后续交易对', async () => {
  const f = createFixture()
  f.trigger()
  await f.engine.globalStrategyLoop()
  assert.equal(f.calls.snapshots, 0)
  assert.equal(f.engine.loopStats.scanCount, 1)
  f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered = false
  f.engine.analyzeSymbol = async () => f.trigger()
  await f.engine.globalStrategyLoop()
  assert.equal(f.calls.snapshots, 1)
  assert.equal(f.engine.loopStats.scanCount, 2)
  assert.equal(f.engine.isGlobalLoopRunning, false)
})

test('AI 分析返回前触发熔断，已有信号也不能开仓', async () => {
  const f = createFixture()
  f.engine.hydrateIndicatorsForStrategy = async () => {}
  f.engine.callAI = async () => { f.trigger(); return f.signal }
  await assert.rejects(f.engine.analyzeSymbol(f.instance, 'BTCUSDT', f.snapshot), /策略熔断/)
  assert.equal(f.calls.reserved, 0)
  assert.deepEqual(f.calls.orders, [])
})

test('平仓达到策略每日亏损上限后立即阻止该策略开仓，已有仓位仍能平仓', async () => {
  const f = createFixture()
  const closer = createCloser(f, { netPnl: -10 })
  const position = { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} }
  f.positions.set('BTCUSDT', position)
  await closer.closePosition('BTCUSDT', '止损')
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  f.positions.set('BTCUSDT', position)
  await closer.closePosition('BTCUSDT', '熔断后平仓')
  assert.deepEqual(f.calls.orders.map(order => order.side), ['sell', 'sell'])
  assert.equal(f.positions.size, 0)
  assert.equal(f.calls.reserved, 0)
})

const beforeMidnight = Date.parse('2026-10-31T23:59:59.999+08:00')
const midnight = beforeMidnight + 1

test('北京时间零点解除熔断并清空风险统计，同一天不会重复清空', () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  f.state.strategyDailyRisk['strategy-a'].dailyPnL = -200
  assert.match(f.engine.getOpeningBlockReason('strategy-a'), /策略熔断/)
  assert.equal(f.state.riskDayKey, '2026-10-31')
  f.clock.now = midnight
  assert.equal(f.engine.getOpeningBlockReason('strategy-a'), null)
  assert.equal(f.state.riskDayKey, '2026-11-01')
  assert.equal(f.state.strategyDailyRisk['strategy-a'], undefined)
  assert.equal(f.calls.persisted.length, 1)
  assert.equal(f.calls.persisted[0].riskDayKey, '2026-11-01')
  f.dailyRiskState.getStrategyDailyRiskState(f.state, 'strategy-a').dailyPnL = -2
  assert.equal(f.engine.getOpeningBlockReason('strategy-a'), null)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -2)
  assert.equal(f.calls.persisted.length, 1)
})

test('次日自动扫描恢复并能开仓，无需重新启动策略', async () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  f.engine.analyzeSymbol = async (instance, symbol) => {
    await f.engine.executeSignal(instance, { ...f.signal, symbol }, new Map())
  }
  await f.engine.globalStrategyLoop()
  assert.equal(f.calls.snapshots, 0)
  f.clock.now = midnight
  await f.engine.globalStrategyLoop()
  assert.equal(f.calls.snapshots, 2)
  assert.equal(f.instance.totalTrades, 2)
  assert.equal(f.instance.isRunning, true)
})

test('次日手动开仓可直接恢复，手动停止的策略不会自动启动', async () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  f.clock.now = midnight
  const result = await f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long')
  assert.equal(result.success, true)
  assert.equal(f.calls.committed, 1)
  const stopped = createFixture(beforeMidnight)
  stopped.trigger()
  stopped.instance.isRunning = false
  stopped.engine.runningStrategies.clear()
  stopped.clock.now = midnight
  await stopped.engine.globalStrategyLoop()
  assert.equal(stopped.engine.runningStrategies.size, 0)
  assert.equal(stopped.instance.isRunning, false)
  assert.equal(stopped.calls.snapshots, 0)
})

test('无日期字段的旧状态根据时间戳跨日，缺少时间戳时保留当天熔断', () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  delete f.state.riskDayKey
  assert.equal(dailyRisk.resetDailyRiskState(f.state, beforeMidnight), false)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  assert.equal(dailyRisk.resetDailyRiskState(f.state, midnight), true)
  assert.equal(f.state.strategyDailyRisk['strategy-a'], undefined)
  f.clock.now = midnight
  f.trigger()
  delete f.state.riskDayKey
  f.state.strategyDailyRisk['strategy-a'].circuitBreaker.timestamp = 0
  assert.equal(dailyRisk.resetDailyRiskState(f.state, midnight), false)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
})

test('配置查询跨过零点时，昨天的平仓结算不污染今天的风险统计', async () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  const closer = createCloser(f, { netPnl: -200 })
  f.positions.set('BTCUSDT', { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} })
  f.hooks.onGetStrategy = () => { f.clock.now = midnight }
  await closer.closePosition('BTCUSDT', '跨日止损')
  assert.equal(f.state.riskDayKey, '2026-11-01')
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, 0)
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.equal(f.calls.committed, 1)
})

test('次日首次平仓先重置昨天的风险统计，当天新亏损仍能再次触发熔断', async () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  f.clock.now = midnight
  const closer = createCloser(f, { netPnl: -2.5 })
  const position = { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} }
  f.positions.set('BTCUSDT', position)
  await closer.closePosition('BTCUSDT', '次日止损')
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -2.5)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, false)
  for (let i = 0; i < 3; i++) {
    f.positions.set('BTCUSDT', position)
    await closer.closePosition('BTCUSDT', '次日止损')
  }
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
})

test('手动与补偿平仓都使用新日统计，昨日成交的迟到记录不会重新熔断', async t => {
  for (const mode of ['manual', 'compensated']) {
    for (const historical of [false, true]) {
      await t.test(`${mode} ${historical ? '昨日成交' : '今日成交'}`, async () => {
        const f = createFixture(beforeMidnight)
        f.trigger()
        f.clock.now = midnight
        const closeTime = historical ? beforeMidnight : midnight
        const closer = createCloser(f, { netPnl: historical ? -200 : -1, closeTime })
        const position = { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} }
        f.positions.set('BTCUSDT', position)
        if (mode === 'manual') await closer.handleManualClose(position, { exitPrice: 100, closeTime })
        else await closer.handleCompensatedClose(position, '补偿止损')
        assert.equal(f.state.riskDayKey, '2026-11-01')
        assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, historical ? 0 : -1)
        assert.equal(f.positions.size, 0)
      })
    }
  }
})

test('当天熔断不会因其他持仓盈利平仓提前解除，时钟回拨也不清空统计', async () => {
  const f = createFixture(beforeMidnight)
  f.trigger()
  f.state.strategyDailyRisk['strategy-a'].dailyPnL = -1
  const closer = createCloser(f, { netPnl: 10 })
  f.positions.set('BTCUSDT', { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} })
  await closer.closePosition('BTCUSDT', '止盈')
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, 9)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  assert.equal(dailyRisk.resetDailyRiskState(f.state, beforeMidnight - 86400000), false)
  f.clock.now = midnight
  assert.equal(f.engine.getOpeningBlockReason('strategy-a'), null)
})

test('配置查询失败仍保留已经确认的策略盈亏，后续开仓按固定金额检查', async () => {
  const f = createFixture(midnight)
  const closer = createCloser(f)
  f.hooks.onGetStrategy = () => { throw new Error('模拟配置查询失败') }
  await assert.rejects(closer.updateRiskStateAfterClose('strategy-a', -10, midnight), /模拟配置查询失败/)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -10)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断.*上限 10 USDT/)
  assert.equal(f.calls.balanceFetches, 0)
})

test('订单排队跨日后仍检查当天新熔断，不因昨日窗口重置而放行', async () => {
  const f = createFixture(beforeMidnight)
  f.hooks.beforeDispatch = async () => {
    f.clock.now = midnight
    const closer = createCloser(f)
    await closer.updateRiskStateAfterClose('strategy-a', -200, midnight)
  }
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  assert.equal(f.state.riskDayKey, '2026-11-01')
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  assert.deepEqual(f.calls.orders, [])
  assert.deepEqual(f.calls.released, ['reservation'])
})

test('maxDailyLoss 使用各策略自己的阈值与盈亏，触发后其他策略仍可开仓', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  const other = addStrategy(f, 'strategy-b', 15)
  const closer = createCloser(f)
  await closer.updateRiskStateAfterClose('strategy-a', -3, midnight)
  await closer.updateRiskStateAfterClose('strategy-b', -3, midnight)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -3)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  assert.equal(f.state.strategyDailyRisk['strategy-b'].circuitBreaker.isTriggered, false)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断.*上限 3 USDT/)
  assert.equal(f.calls.reserved, 0)
  await f.engine.executeSignal(other, { ...f.signal, strategyId: 'strategy-b', symbol: 'SOLUSDT' }, new Map())
  assert.equal(f.calls.committed, 1)
})

test('固定亏损金额允许超过 100 USDT，并按配置金额生效', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 150
  const closer = createCloser(f)
  await closer.updateRiskStateAfterClose('strategy-a', -110, midnight)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, false)
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.equal(f.calls.committed, 1)
})

test('账户余额波动不改变 10 USDT 固定上限，达到金额后才禁止开仓', async () => {
  for (const balance of [500, 1000, 10000]) {
    const f = createFixture(midnight)
    f.hooks.accountBalance = balance
    const closer = createCloser(f)
    await closer.updateRiskStateAfterClose('strategy-a', -9.99, midnight)
    assert.equal(f.calls.balanceFetches, 0)
    assert.equal(f.engine.getDailyLossStatus('strategy-a', 10).dailyLossLimitReached, false)
    await f.engine.executeSignal(f.instance, f.signal, new Map())
    assert.equal(f.calls.committed, 1)
    await closer.updateRiskStateAfterClose('strategy-a', -0.01, midnight)
    const status = f.engine.getDailyLossStatus('strategy-a', 10)
    assert.equal(status.todayLossAmount, 10)
    assert.equal(status.limit, 10)
    assert.equal(status.dailyLossLimitReached, true)
    await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'ETHUSDT', 'long'), /上限 10 USDT/)
    assert.equal(f.calls.balanceFetches, 1)
  }
})

test('账户查询不可用时平仓仍按固定金额触发每日门禁', async () => {
  const f = createFixture(midnight)
  f.hooks.onFetchBalance = () => { throw new Error('模拟账户接口不可用') }
  await createCloser(f).updateRiskStateAfterClose('strategy-a', -10, midnight)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /上限 10 USDT/)
  assert.equal(f.calls.balanceFetches, 0)
})

test('等待开仓余额期间达到亏损金额上限，释放已预占的每日开仓名额', async () => {
  const f = createFixture(midnight)
  f.hooks.onFetchBalance = async () => {
    delete f.hooks.onFetchBalance
    await createCloser(f).updateRiskStateAfterClose('strategy-a', -10, midnight)
  }
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /上限 10 USDT/)
  assert.equal(f.calls.reserved, 1)
  assert.deepEqual(f.calls.released, ['reservation'])
  assert.deepEqual(f.calls.orders, [])
  assert.deepEqual(f.calls.locked, [])
})

test('策略列表使用与开仓门禁相同的亏损金额，盈利不提前解除，次日同步清零', async () => {
  const f = createFixture(beforeMidnight)
  const closer = createCloser(f)
  await closer.updateRiskStateAfterClose('strategy-a', -3.2, beforeMidnight)
  const partial = f.engine.getDailyLossStatus('strategy-a', 10)
  assert.equal(partial.todayLossAmount, 3.2)
  assert.equal(partial.limit, 10)
  assert.equal(partial.dailyLossLimitReached, false)
  await closer.updateRiskStateAfterClose('strategy-a', -6.8, beforeMidnight)
  const reached = f.engine.getDailyLossStatus('strategy-a', 10)
  assert.equal(reached.todayLossAmount, 10)
  assert.equal(reached.dailyLossLimitReached, true)
  await closer.updateRiskStateAfterClose('strategy-a', 15, beforeMidnight)
  const recovered = f.engine.getDailyLossStatus('strategy-a', 10)
  assert.equal(recovered.todayLossAmount, 0)
  assert.equal(recovered.dailyLossLimitReached, true)
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断/)
  f.clock.now = midnight
  const reset = f.engine.getDailyLossStatus('strategy-a', 10)
  assert.equal(reset.todayLossAmount, 0)
  assert.equal(reset.dailyLossLimitReached, false)
  assert.equal(reset.reason, '')
  await f.engine.executeSignal(f.instance, f.signal, new Map())
  assert.equal(f.calls.committed, 1)
})

test('策略列表接口同时返回每日开仓次数和各策略的亏损金额，不把运行数据写入配置', async () => {
  const f = createFixture(midnight)
  addStrategy(f, 'strategy-b', 20)
  await createCloser(f).updateRiskStateAfterClose('strategy-a', -10, midnight)
  await createCloser(f).updateRiskStateAfterClose('strategy-b', -2.5, midnight)
  f.engine.getDailyTradeStatus = async () => ({ todayOpenedCount: 2, dailyTradeLimitReached: false })
  const strategyManager = {
    async getAllStrategies() { return [...f.strategies.values()] },
    async getAllStrategiesStatus() { return [] },
    getEngine() { return f.engine }
  }
  const { default: handler } = loadModule('../server/api/strategies/index.get.ts', {
    '../../modules/strategy-manager': { getStrategyManager: () => strategyManager },
    '../../utils/mask-strategy': { maskStrategyData: value => structuredClone(value) }
  }, { ...f.globals, defineEventHandler: handler => handler })
  const originalConfig = JSON.stringify([...f.strategies.values()])
  const result = await handler({})
  assert.equal(result.success, true)
  assert.equal(result.dailyTradeStatuses['strategy-a'].todayOpenedCount, 2)
  assert.equal(result.dailyLossStatuses['strategy-a'].todayLossAmount, 10)
  assert.equal(result.dailyLossStatuses['strategy-a'].limit, 10)
  assert.equal(result.dailyLossStatuses['strategy-a'].dailyLossLimitReached, true)
  assert.equal(result.dailyLossStatuses['strategy-b'].todayLossAmount, 2.5)
  assert.equal(result.dailyLossStatuses['strategy-b'].limit, 20)
  assert.equal(result.dailyLossStatuses['strategy-b'].dailyLossLimitReached, false)
  assert.equal(JSON.stringify([...f.strategies.values()]), originalConfig)
})

test('其他策略盈利不能抵消本策略的亏损，策略内盈利参与每日净盈亏计算', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  addStrategy(f, 'strategy-b', 10)
  const closer = createCloser(f)
  await closer.updateRiskStateAfterClose('strategy-b', 10, midnight)
  await closer.updateRiskStateAfterClose('strategy-a', 1, midnight)
  await closer.updateRiskStateAfterClose('strategy-a', -3, midnight)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -2)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, false)
  await closer.updateRiskStateAfterClose('strategy-a', -1, midnight)
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
})

test('自动、手动和补偿平仓均读取持久化的 maxDailyLoss 并限制对应策略', async t => {
  for (const mode of ['automatic', 'manual', 'compensated']) {
    await t.test(mode, async () => {
      const f = createFixture(midnight)
      // 平仓配置取自存储，即使该策略已停止运行也要正确结算风控。
      f.strategies.set('strategy-a', { ...f.instance.strategy, riskManagement: { ...f.instance.strategy.riskManagement, maxDailyLoss: 3 } })
      f.engine.runningStrategies.clear()
      const closer = createCloser(f, { netPnl: -3 })
      const position = { strategyId: 'strategy-a', symbol: 'BTCUSDT', direction: 'long', quantity: 1, position: {} }
      f.positions.set('BTCUSDT', position)
      if (mode === 'automatic') await closer.closePosition('BTCUSDT', '止损')
      else if (mode === 'manual') await closer.handleManualClose(position, { exitPrice: 100, closeTime: midnight })
      else await closer.handleCompensatedClose(position, '补偿止损')
      assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -3)
      assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
      assert.equal(f.positions.size, 0)
      assert.equal(f.calls.persisted.at(-1).strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
    })
  }
})

test('策略每日熔断停止该策略扫描和手动开仓，其他策略继续扫描', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  addStrategy(f, 'strategy-b', 10)
  await createCloser(f).updateRiskStateAfterClose('strategy-a', -3, midnight)
  const analyzed = []
  f.engine.analyzeSymbol = async instance => { analyzed.push(instance.strategy.id) }
  await f.engine.globalStrategyLoop()
  assert.deepEqual(analyzed, ['strategy-b'])
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断/)
  await assert.rejects(f.engine.analyzeSymbolForTest('strategy-a', 'BTCUSDT'), /策略熔断/)
  assert.equal(f.calls.snapshots, 1)
})

test('降低 maxDailyLoss 后下一次开仓立即检查新上限，不预占开仓名额', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 5
  await createCloser(f).updateRiskStateAfterClose('strategy-a', -3, midnight)
  assert.equal(f.engine.getOpeningBlockReason('strategy-a'), null)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断.*上限 3 USDT/)
  assert.deepEqual(f.calls.orders, [])
  assert.equal(f.calls.reserved, 0)
  assert.deepEqual(f.calls.released, [])
  assert.deepEqual(f.calls.locked, [])
})

test('排队期间触发策略亏损上限，只拦截该策略的订单', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  const other = addStrategy(f, 'strategy-b', 10)
  f.hooks.beforeDispatch = async () => {
    delete f.hooks.beforeDispatch
    await createCloser(f).updateRiskStateAfterClose('strategy-a', -3, midnight)
  }
  await assert.rejects(f.engine.executeSignal(f.instance, f.signal, new Map()), /策略熔断/)
  assert.deepEqual(f.calls.orders, [])
  assert.deepEqual(f.calls.released, ['reservation'])
  assert.deepEqual(f.calls.unlocked, ['BTCUSDT'])
  await f.engine.executeSignal(other, { ...f.signal, strategyId: 'strategy-b', symbol: 'SOLUSDT' }, new Map())
  assert.equal(f.calls.committed, 1)
})

test('并发平仓正确合计同一策略当日亏损，达到边界即触发', async () => {
  const f = createFixture(midnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  const closer = createCloser(f)
  await Promise.all([
    closer.updateRiskStateAfterClose('strategy-a', -1.5, midnight),
    closer.updateRiskStateAfterClose('strategy-a', -1.5, midnight)
  ])
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, -3)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, true)
})

test('策略熔断当日保持，次日与其余策略的盈亏统计一并清零并恢复开仓', async () => {
  const f = createFixture(beforeMidnight)
  f.instance.strategy.riskManagement.maxDailyLoss = 3
  addStrategy(f, 'strategy-b', 10)
  const closer = createCloser(f)
  await closer.updateRiskStateAfterClose('strategy-b', -7, beforeMidnight)
  await closer.updateRiskStateAfterClose('strategy-a', -3, beforeMidnight)
  await closer.updateRiskStateAfterClose('strategy-a', 4, beforeMidnight)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, 1)
  await assert.rejects(f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long'), /策略熔断/)
  f.clock.now = midnight
  const result = await f.engine.forceOpenPosition('strategy-a', 'BTCUSDT', 'long')
  assert.equal(result.success, true)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].dailyPnL, 0)
  assert.equal(f.state.strategyDailyRisk['strategy-a'].circuitBreaker.isTriggered, false)
  assert.equal(f.state.strategyDailyRisk['strategy-b'], undefined)
})

test('旧配置缺失或非法时回退 10 USDT，有效的小数金额按实际数值判断', () => {
  for (const limit of [undefined, null, 0, -1, NaN, Infinity, '3']) {
    const f = createFixture(midnight)
    f.dailyRiskState.getStrategyDailyRiskState(f.state, 'strategy-a').dailyPnL = -9.99
    assert.equal(f.dailyRiskState.checkStrategyDailyLoss(f.state, 'strategy-a', limit).isTriggered, false)
    f.state.strategyDailyRisk['strategy-a'].dailyPnL = -10
    assert.equal(f.dailyRiskState.checkStrategyDailyLoss(f.state, 'strategy-a', limit).isTriggered, true)
  }
  const f = createFixture(midnight)
  f.dailyRiskState.getStrategyDailyRiskState(f.state, 'strategy-a').dailyPnL = -2.5
  assert.equal(f.dailyRiskState.checkStrategyDailyLoss(f.state, 'strategy-a', 2.5).isTriggered, true)
})
