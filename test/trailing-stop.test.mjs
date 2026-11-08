// ==================== 移动止损换单与保护性平仓回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const logger = { info() {}, warn() {}, error() {}, success() {} }

/** 运行真实业务源码，仅替换外部依赖，不连接交易所或写入仓位数据。 */
function loadModule(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = { exports: {}, setTimeout, clearTimeout, require: id => dependencies[id] ?? {} }
  vm.runInNewContext(compiled.outputText, context, { filename: path })
  return context.exports
}

const { StrategyPositionMonitor } = loadModule('../server/modules/strategy-engine/StrategyPositionMonitor.ts', {
  '../../utils/logger': { logger }
})

/** 使用可控的下单结果，复现撤单、下单和平仓之间的异步失败。 */
function fixture(direction = 'short') {
  const calls = []
  const position = {
    symbol: 'ENA/USDT', strategyId: 'strategy_001', openTime: 1, direction,
    entryPrice: 100, quantity: 1, leverage: 10,
    stopLoss: direction === 'short' ? 110 : 90,
    lowestPrice: 80, highestPrice: 120, entryIndicators: { ATR: 5 },
    stopLossOrderId: 'old', position: { stopLossOrderId: 'old', trailingStopData: { trailingStopCount: 2 } }
  }
  const binance = {
    async cancelOrder(id) { calls.push(['cancel', id]) },
    async stopLossOrder(...args) { calls.push(['stop', ...args]); return { orderId: 'new' } }
  }
  const manager = { updatePosition(symbol, updates) { Object.assign(position, updates) } }
  const closer = {
    async closePosition(symbol, reason) {
      calls.push(['close', reason, position.stopLossOrderId, position.position.stopLossOrderId])
    }
  }
  const monitor = new StrategyPositionMonitor(binance, manager, closer, {}, {})
  const key = `${position.strategyId}:${position.symbol}:${position.openTime}`
  monitor.trailingStopActivated.set(key, true)
  const strategy = { riskManagement: { trailingStop: { activationRatio: 2, trailDistance: 1, minMoveDistance: 0.1 } } }
  return { monitor, position, binance, calls, key, strategy, run: price => monitor.checkTrailingStop(position, strategy, price) }
}

for (const direction of ['short', 'long']) {
  test(`${direction}: 不足最小移动距离时不按理论止损平仓，累计达标才换单`, async () => {
    const f = fixture(direction)
    const sign = direction === 'short' ? -1 : 1
    const oldStop = 10000 + sign * 200
    f.position.entryPrice = 10000
    f.position.entryIndicators.ATR = 100
    f.position.stopLoss = oldStop
    f.position.position.stopLoss = oldStop
    f.strategy.riskManagement.trailingStop.minMoveDistance = 0.28
    // 理论线只改善20元，不足28元；价格已越过理论线，但仍未触及原止损。
    f.position.lowestPrice = 9680
    f.position.highestPrice = 10320
    assert.equal(await f.run(oldStop + sign * 10), false)
    assert.deepEqual(f.calls, [])
    assert.equal(f.position.stopLoss, oldStop)
    assert.equal(f.position.position.trailingStopData.trailingStopCount, 2)

    // 从原止损累计改善28元即达标，不以每轮新增的8元比较门槛。
    f.position.lowestPrice = 9672
    f.position.highestPrice = 10328
    const newStop = oldStop + sign * 28
    assert.equal(await f.run(newStop + sign * 10), false)
    assert.deepEqual(f.calls.map(c => c[0]), ['cancel', 'stop'])
    assert.equal(f.position.stopLoss, newStop)
    assert.equal(f.position.position.stopLoss, newStop)
    assert.equal(f.position.position.trailingStopData.trailingStopCount, 3)
  })

  test(`${direction}: 不足移动门槛时原止损仍能触发平仓`, async () => {
    const f = fixture(direction)
    const oldStop = direction === 'short' ? 86 : 114
    f.position.stopLoss = oldStop
    f.position.position.stopLoss = oldStop
    f.strategy.riskManagement.trailingStop.minMoveDistance = 2
    // 理论线只收紧1元，门槛为2元，仍需保护已触及的原止损。
    assert.equal(await f.run(oldStop), true)
    assert.deepEqual(f.calls, [['close', '移动止损', 'old', 'old']])
  })
}

for (const direction of ['short', 'long']) {
  test(`${direction}: 按初始风险激活，当轮移动并在重启后继续跟踪`, async () => {
    const f = fixture(direction)
    const short = direction === 'short'
    f.monitor.trailingStopActivated.clear()
    f.position.position.trailingStopData.trailingStopCount = 0
    f.position.initialStopLoss = short ? 110 : 90
    // 当前止损已与初始止损不同，1.2R仍应基于初始10元风险。
    f.position.stopLoss = short ? 120 : 80
    f.position.position.stopLoss = f.position.stopLoss
    f.position.lowestPrice = 88
    f.position.highestPrice = 112
    f.strategy.riskManagement.trailingStop.activationRatio = 1.2
    assert.equal(await f.run(short ? 88 : 112), false)
    assert.deepEqual(f.calls.map(c => c[0]), ['cancel', 'stop'])
    assert.equal(f.position.trailingStopActivated, true)
    assert.equal(f.position.stopLoss, short ? 93 : 107)

    // 模拟磁盘序列化后冷启动，清空内存激活Map；浮盈已不足重新激活仍须跟踪。
    Object.assign(f.position, JSON.parse(JSON.stringify(f.position)))
    f.monitor.trailingStopActivated.clear()
    f.calls.length = 0
    assert.equal(await f.run(short ? 94 : 106), true)
    assert.equal(f.calls[0][0], 'close')
  })
}

test('旧仓位已移动过止损时自动恢复激活状态并持久化', async () => {
  const f = fixture()
  f.monitor.trailingStopActivated.clear()
  assert.equal(await f.run(82), false)
  assert.equal(f.position.trailingStopActivated, true)
  assert.equal(f.position.position.trailingStopData.trailingStopCount, 3)
})

test('已激活但尚未换单的仓位重启后不需要再次满足激活门槛', async () => {
  const f = fixture()
  f.monitor.trailingStopActivated.clear()
  f.position.trailingStopActivated = true
  f.position.position.trailingStopData.trailingStopCount = 0
  f.position.initialStopLoss = 110
  assert.equal(await f.run(85), true)
  assert.equal(f.calls[0][0], 'close')
})

test('未激活时缺失初始风险不能用移动后的止损代替', async () => {
  const f = fixture()
  f.monitor.trailingStopActivated.clear()
  f.position.position.trailingStopData.trailingStopCount = 0
  assert.equal(await f.run(80), false)
  assert.deepEqual(f.calls, [])
  assert.equal(f.position.trailingStopActivated, undefined)
})

for (const [direction, hitPrice, safePrice, stopPrice] of [['short', 85, 82, 85], ['long', 115, 118, 115]]) {
  test(`${direction}: 已触发时直接平仓，不先换止损单`, async () => {
    const f = fixture(direction)
    assert.equal(await f.run(hitPrice), true)
    assert.deepEqual(f.calls, [['close', '移动止损', 'old', 'old']])
    assert.equal(f.monitor.trailingStopActivated.has(f.key), false)
  })

  test(`${direction}: 未触发时换单并同步两处订单 ID`, async () => {
    const f = fixture(direction)
    assert.equal(await f.run(safePrice), false)
    assert.deepEqual(f.calls.map(c => c[0]), ['cancel', 'stop'])
    assert.equal(f.position.stopLoss, stopPrice)
    assert.equal(f.position.position.stopLoss, stopPrice)
    assert.equal(f.position.stopLossOrderId, 'new')
    assert.equal(f.position.position.stopLossOrderId, 'new')
    assert.equal(f.position.position.trailingStopData.trailingStopCount, 3)
  })
}

for (const message of ['binance {"code":-2021,"msg":"Order would immediately trigger."}', 'Network timeout']) {
  test(`新单失败后清理旧 ID 并保护性平仓：${message}`, async () => {
    const f = fixture()
    f.binance.stopLossOrder = async () => {
      assert.equal(f.position.stopLossOrderId, undefined)
      assert.equal(f.position.position.stopLossOrderId, undefined)
      throw new Error(message)
    }
    assert.equal(await f.run(82), true)
    assert.deepEqual(f.calls.map(c => c[0]), ['cancel', 'close'])
    assert.equal(f.calls[1][2], undefined)
    assert.equal(f.calls[1][3], undefined)
    assert.equal(f.position.stopLoss, 110)
  })
}

test('撤销旧单失败时保留原保护及 ID，不继续下新单', async () => {
  const f = fixture()
  f.binance.cancelOrder = async () => { throw new Error('Network timeout') }
  assert.equal(await f.run(82), false)
  assert.deepEqual(f.calls, [])
  assert.equal(f.position.stopLossOrderId, 'old')
  assert.equal(f.position.position.stopLossOrderId, 'old')
})

test('保护性平仓失败时保留激活状态，下轮继续保护仓位', async () => {
  const f = fixture()
  f.binance.stopLossOrder = async () => { throw new Error('Network timeout') }
  f.monitor.positionCloser.closePosition = async () => { throw new Error('Network timeout') }
  assert.equal(await f.run(82), false)
  assert.equal(f.monitor.trailingStopActivated.has(f.key), true)
  assert.equal(f.position.stopLossOrderId, undefined)
  f.binance.stopLossOrder = async () => ({ orderId: 'retry' })
  assert.equal(await f.run(82), false)
  assert.equal(f.position.stopLossOrderId, 'retry')
})

for (const [direction, stopLoss, price] of [['short', 83, 82], ['long', 117, 118]]) {
  test(`${direction}: 不放宽已收紧的止损`, async () => {
    const f = fixture(direction)
    f.position.stopLoss = stopLoss
    assert.equal(await f.run(price), false)
    assert.deepEqual(f.calls, [])
  })
}

test('市价平仓将 reduceOnly 传给交易所，开仓仍执行提交门禁', async () => {
  const { BinanceService } = loadModule('../server/utils/binance.ts', {
    './binance-api-gateway': { binanceApiGateway: { trade: async (_, submit) => submit() } }
  })
  const calls = []
  const binance = Object.assign(Object.create(BinanceService.prototype), {
    privateExchange: { async createOrder(...args) { calls.push(args); return { id: 'close', side: 'buy' } } }
  })
  await binance.marketOrder('ENA/USDT', 'buy', 1, undefined, { reduceOnly: true })
  assert.equal(calls[0][5].reduceOnly, true)
  await assert.rejects(binance.marketOrder('ENA/USDT', 'buy', 1, () => { throw new Error('开仓已禁止') }), /开仓已禁止/)
  assert.equal(calls.length, 1)
})

for (const rejected of [false, true]) {
  test(`真实平仓流程只撤销旧单一次并提交只减仓订单（新单拒绝：${rejected}）`, async () => {
    const f = fixture()
    const { StrategyPositionCloser } = loadModule('../server/modules/strategy-engine/StrategyPositionCloser.ts', {
      '../../utils/logger': { logger },
      '../../utils/storage': { async saveBotState() {} },
      './helpers/trade-recorder': { async recordTrade() {} }
    })
    const marketOrders = []
    let cleared = false
    f.binance.marketOrder = async (...args) => {
      marketOrders.push(args)
      return { orderId: 'exit', average: 85 }
    }
    const closer = new StrategyPositionCloser(f.binance, {
      getPosition: () => f.position,
      updatePosition: (symbol, updates) => Object.assign(f.position, updates),
      clearPosition: () => { cleared = true }
    }, {}, {}, {})
    // 结算与风控另有测试；这里保留真实撤单和市价平仓路径。
    closer.resolveSettlement = async () => ({
      exitPrice: 85, totalCommission: 0, netPnl: 1, netPnlPercentage: 1,
      settlement: { grossRealizedPnl: 1, entryCommission: 0, exitCommission: 0 }
    })
    closer.updateRiskStateAfterClose = async () => {}
    f.monitor.positionCloser = closer
    if (rejected) {
      f.binance.stopLossOrder = async () => { throw new Error('binance {"code":-2021}') }
    }
    assert.equal(await f.run(rejected ? 82 : 85), true)
    assert.deepEqual(f.calls, [['cancel', 'old']])
    assert.equal(marketOrders.length, 1)
    assert.equal(marketOrders[0][4].reduceOnly, true)
    assert.equal(cleared, true)
  })
}

/** 构造真实平仓器，单独替换交易所、结算和落库，验证故障时的保护顺序。 */
function closeFixture() {
  const f = fixture()
  const { StrategyPositionCloser } = loadModule('../server/modules/strategy-engine/StrategyPositionCloser.ts', {
    '../../utils/logger': { logger },
    '../../utils/storage': { async saveBotState() {} },
    './helpers/trade-recorder': { async recordTrade() {} }
  })
  const closer = new StrategyPositionCloser(f.binance, {
    getPosition: () => f.position,
    updatePosition: (symbol, updates) => Object.assign(f.position, updates),
    clearPosition: () => f.calls.push(['clear'])
  }, {}, {}, {})
  closer.resolveSettlement = async () => ({
    exitPrice: 85, totalCommission: 0, netPnl: 1, netPnlPercentage: 1,
    settlement: { grossRealizedPnl: 1, entryCommission: 0, exitCommission: 0 }
  })
  closer.updateRiskStateAfterClose = async () => {}
  f.binance.marketOrder = async () => { f.calls.push(['market']); return { orderId: 'exit', average: 85 } }
  f.binance.fetchPositions = async () => [{ symbol: 'ENA/USDT:USDT', direction: 'SHORT', quantity: 0.5 }]
  return { ...f, closer }
}

test('平仓先提交只减仓市价单，成功后才撤销原止损', async () => {
  const f = closeFixture()
  await f.closer.closePosition(f.position.symbol, '移动止损')
  assert.deepEqual(f.calls.map(c => c[0]), ['market', 'cancel', 'clear'])
})

test('市价请求失败保留原止损和退出意图，不立即重复下市价单', async () => {
  const f = closeFixture()
  f.binance.marketOrder = async () => { f.calls.push(['market']); throw new Error('Network timeout') }
  await assert.rejects(f.closer.closePosition(f.position.symbol, '移动止损'), /Network timeout/)
  assert.deepEqual(f.calls, [['market']])
  assert.equal(f.position.stopLossOrderId, 'old')
  assert.equal(f.position.pendingCloseReason, '移动止损')
  assert.equal(f.position.quantity, 0.5)
})

for (const outcome of ['remaining', 'flat', 'restore-failed', 'snapshot-failed']) {
  test(`无挂单且市价平仓失败后的保护恢复：${outcome}`, async () => {
    const f = closeFixture()
    f.position.stopLossOrderId = undefined
    f.position.position.stopLossOrderId = undefined
    f.binance.marketOrder = async () => { f.calls.push(['market']); throw new Error('Network timeout') }
    if (outcome === 'flat') f.binance.fetchPositions = async () => []
    if (outcome === 'snapshot-failed') f.binance.fetchPositions = async () => { throw new Error('Snapshot timeout') }
    if (outcome === 'restore-failed') f.binance.stopLossOrder = async () => { f.calls.push(['stop-failed']); throw new Error('-2021') }
    await assert.rejects(f.closer.closePosition(f.position.symbol, '保护性平仓'), /Network timeout/)
    assert.equal(f.position.pendingCloseReason, '保护性平仓')
    if (outcome === 'remaining') {
      assert.deepEqual(f.calls.map(c => c[0]), ['market', 'stop'])
      assert.equal(f.calls[1][3], 0.5)
      assert.equal(f.position.stopLossOrderId, 'new')
      assert.equal(f.position.position.stopLossOrderId, 'new')
    } else {
      assert.deepEqual(f.calls.map(c => c[0]), outcome === 'restore-failed' ? ['market', 'stop-failed'] : ['market'])
    }
  })
}

test('重启后优先继续未完成平仓，采用交易所剩余数量且不依赖行情或止盈指标', async () => {
  const f = fixture()
  Object.assign(f.position, JSON.parse(JSON.stringify({ ...f.position, pendingCloseReason: '移动止损' })))
  f.monitor.positionCloser.checkPositionConsistency = async () => true
  f.monitor.positionCloser.closePosition = async (symbol, reason) => {
    assert.equal(f.position.quantity, 0.5)
    f.calls.push(['retry', reason])
  }
  await f.monitor.monitorSinglePosition(f.position, [{ symbol: 'ENA/USDT:USDT', direction: 'SHORT', quantity: 0.5 }])
  assert.deepEqual(f.calls, [['retry', '移动止损']])
})

test('真实仓位管理器保存并重新加载激活状态及待平仓原因', async () => {
  let stored = [JSON.parse(JSON.stringify(fixture().position))]
  let persisted
  const saved = new Promise(resolve => { persisted = resolve })
  const { PositionManager } = loadModule('../server/modules/position-manager/PositionManager.ts', {
    '../../utils/logger': { logger },
    '../../utils/storage': {
      async loadActivePositions() { return JSON.parse(JSON.stringify(stored)) },
      async loadSymbolLocks() { return {} },
      async saveActivePositions(positions) { stored = JSON.parse(JSON.stringify(positions)); persisted() },
      async saveSymbolLocks() {}
    }
  })
  const manager = new PositionManager()
  await manager.init()
  manager.updatePosition('ENA/USDT', { trailingStopActivated: true, pendingCloseReason: '移动止损' })
  await saved
  const restarted = new PositionManager()
  await restarted.init()
  assert.equal(restarted.getPosition('ENA/USDT').trailingStopActivated, true)
  assert.equal(restarted.getPosition('ENA/USDT').pendingCloseReason, '移动止损')
})

test('止盈平仓失败后本轮不继续移动止损或再次平仓', async () => {
  const f = fixture()
  f.monitor.positionCloser.checkPositionConsistency = async () => true
  f.monitor.strategyStore = { async getStrategy() { return f.strategy } }
  f.monitor.checkTakeProfit = async () => {
    f.position.pendingCloseReason = 'TP1'
    return false
  }
  f.monitor.checkTrailingStop = async () => { assert.fail('不应继续移动止损') }
  f.monitor.checkTimeout = async () => { assert.fail('不应再次平仓') }
  await f.monitor.monitorSinglePosition(f.position, [], 82)
  assert.deepEqual(f.calls, [])
})
