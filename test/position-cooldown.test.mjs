// ==================== 平仓冷却、跨策略门禁与重启恢复回归 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const hour = 60 * 60 * 1000

/** 执行真实源码；以临时目录隔离磁盘状态，以固定时钟验证冷却边界。 */
function loadModule(path, dependencies, globals) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = {
    exports: {}, console,
    require: id => dependencies[id] ?? (['fs', 'fs/promises', 'path'].includes(id) ? require(id) : {}),
    ...globals
  }
  vm.runInNewContext(compiled.outputText, context, { filename: path })
  return context.exports
}

/** 使用真实持久化文件，禁用与本测试无关的持仓防抖写入。 */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'position-cooldown-'))
  const clock = { now: 1800000000000 }
  /** 控制业务时钟而不修改测试进程的 Date。 */
  class ClockDate extends Date {
    static now() { return clock.now }
  }
  const globals = { Date: ClockDate, process: { cwd: () => directory }, setTimeout: () => 1, clearTimeout() {} }
  const storage = loadModule('../server/utils/storage.ts', {}, globals)
  const { PositionManager } = loadModule('../server/modules/position-manager/PositionManager.ts', {
    '../../utils/storage': storage,
    '../../utils/logger': { logger: { info() {}, success() {}, error() {} } }
  }, globals)
  const manager = new PositionManager()
  await manager.init()
  return { directory, clock, storage, manager, PositionManager }
}

test('完整平仓释放仓位与锁，但一小时内所有策略禁止开仓，到期自动恢复', async () => {
  const f = await fixture()
  try {
    const symbol = 'BTC/USDT'
    f.manager.recordPosition(symbol, { symbol, strategyId: 'a', direction: 'long', quantity: 1 })
    // 减仓和更新持仓不会提前进入冷却。
    f.manager.updatePosition(symbol, { quantity: 0.5 })
    assert.equal(f.manager.getCooldownRemainingMs(symbol), 0)
    await f.manager.clearPosition(symbol)
    assert.equal(f.manager.hasPosition(symbol), false)
    assert.equal(f.manager.getLockHolder(symbol), undefined)
    assert.equal(f.manager.getStrategyPositionCount('a'), 0)
    assert.equal(f.manager.getCooldownRemainingMs(symbol), hour)
    for (const strategy of ['a', 'b']) assert.equal(await f.manager.canOpenPosition(symbol, strategy), false)
    assert.equal(await f.manager.canOpenPosition('ETH/USDT', 'a'), true)
    assert.equal(f.manager.getCooldownRemainingMs(symbol, 'other-account'), 0)
    assert.equal(f.manager.getCooldownRemainingMs('BTC/USDT:USDT'), hour)
    assert.throws(() => f.manager.assertNotCoolingDown(symbol), /冷却.*60 分钟/)
    f.clock.now += hour - 1
    assert.equal(await f.manager.hasConflict(symbol, 'b'), true)
    f.clock.now++
    assert.equal(await f.manager.canOpenPosition(symbol, 'a'), true)
    assert.doesNotThrow(() => f.manager.assertNotCoolingDown(symbol))
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('冷却持久化后重启恢复，清空持仓文件不清除冷却，过期记录不再加载', async () => {
  const f = await fixture()
  try {
    await f.manager.startCloseCooldown('BTC/USDT')
    await f.storage.clearActiveState()
    assert.deepEqual((await readdir(join(f.directory, 'data'))).sort(), ['active-positions.json', 'symbol-locks.json'])
    f.clock.now += 10 * 60000
    const restarted = new f.PositionManager()
    await restarted.init()
    assert.equal(restarted.getCooldownRemainingMs('BTC/USDT'), 50 * 60000)
    // 重复清理空仓和开仓失败解锁都不能重置冷却时间。
    await restarted.clearPosition('BTC/USDT')
    restarted.unlockSymbol('BTC/USDT')
    assert.equal(restarted.getCooldownRemainingMs('BTC/USDT'), 50 * 60000)
    f.clock.now += 50 * 60000
    const expired = new f.PositionManager()
    await expired.init()
    assert.equal(await expired.canOpenPosition('BTC/USDT', 'a'), true)
    assert.equal(expired.getAllLocks().size, 0)
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('兼容旧版字符串锁，冷却时间不会被恢复成持仓锁', async () => {
  const f = await fixture()
  try {
    await f.storage.saveSymbolLocks({ 'BTC/USDT': 'legacy-strategy', 'default:ETH/USDT': f.clock.now + hour })
    const restarted = new f.PositionManager()
    await restarted.init()
    assert.equal(restarted.getLockHolder('BTC/USDT'), 'legacy-strategy')
    assert.equal(restarted.getLockHolder('ETH/USDT'), undefined)
    assert.equal(restarted.getStrategyPositionCount('legacy-strategy'), 1)
    assert.equal(await restarted.canOpenPosition('ETH/USDT', 'other'), false)
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('保存冷却失败时保留仓位和锁，内存门禁仍生效', async () => {
  const f = await fixture()
  try {
    const symbol = 'BTC/USDT'
    f.manager.recordPosition(symbol, { symbol, strategyId: 'a', direction: 'long', quantity: 1 })
    f.storage.saveSymbolLocks = async () => { throw new Error('模拟磁盘写入失败') }
    await assert.rejects(f.manager.clearPosition(symbol), /磁盘写入失败/)
    assert.equal(f.manager.hasPosition(symbol), true)
    assert.equal(f.manager.getLockHolder(symbol), 'a')
    assert.equal(f.manager.getCooldownRemainingMs(symbol), hour)
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
