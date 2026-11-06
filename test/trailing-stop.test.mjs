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
  const context = { exports: {}, require: id => dependencies[id] ?? {} }
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
  return { monitor, position, binance, calls, key, run: price => monitor.checkTrailingStop(position, strategy, price) }
}

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
