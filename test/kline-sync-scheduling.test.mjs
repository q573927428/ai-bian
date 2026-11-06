// ==================== K线后台同步串行调度回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// 隔离数据库和交易所依赖，仅运行真实调度方法。
const source = readFileSync(new URL('../server/modules/kline-simple-sync/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const isolated = compiled.outputText.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
// 后台限流保持畅通，轮次内请求间隔立即完成，不连接交易所或真实定时器。
const dependencies = `const binanceApiGateway = { shouldPauseBackgroundWork: () => false };
const nodeSetTimeout = (callback) => { callback(); return 1 };\n`
const { KLineSimpleSyncService } = await import(`data:text/javascript;base64,${Buffer.from(dependencies + isolated).toString('base64')}`)

/** 创建不连接数据库的调度对象，保留真实队列行为。 */
function createScheduler() {
  return Object.assign(Object.create(KLineSimpleSyncService.prototype), {
    autoSyncRunning: true,
    autoSyncGeneration: 1,
    scheduledSyncTail: Promise.resolve()
  })
}

test('多周期与高频任务串行，上一轮未结束不会执行下一轮', async () => {
  const scheduler = createScheduler()
  const events = []
  let release
  const first = scheduler.enqueueScheduledSync(async () => {
    events.push('5m:start')
    await new Promise(resolve => { release = resolve })
    events.push('5m:end')
  })
  const second = scheduler.enqueueScheduledSync(async () => { events.push('high-frequency') })
  await Promise.resolve()
  assert.deepEqual(events, ['5m:start'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(events, ['5m:start', '5m:end', 'high-frequency'])
})

test('失败不阻塞后续任务，重启后跳过旧队列', async () => {
  const scheduler = createScheduler()
  const failed = scheduler.enqueueScheduledSync(async () => { throw new Error('模拟失败') })
  await assert.rejects(failed, /模拟失败/)
  let executed = false
  await scheduler.enqueueScheduledSync(async () => { executed = true })
  assert.equal(executed, true)
  const stale = scheduler.enqueueScheduledSync(async () => { assert.fail('旧任务不能执行') })
  scheduler.autoSyncGeneration++
  await stale
})

/** 模拟已有交易对与等待初始化的新交易对，保留真实后台同步循环。 */
function createBackfillScheduler() {
  return Object.assign(createScheduler(), {
    config: { symbols: ['BTCUSDT', 'NEWUSDT'], timeframes: ['5m'] },
    timeframeConfigs: new Map([['5m', { enabled: true }]]),
    initialSyncSymbols: new Set(['NEWUSDT']),
    initialSyncQueue: ['NEWUSDT'],
    isInitialSyncRunning: false,
    isHighFrequencySyncing: false,
    isSyncing: new Map(),
    lastSyncTimes: new Map(),
    syncStatus: new Map(),
    sleep: async () => {}
  })
}

test('新增历史初始化进行中，固定和高频同步继续更新已有交易对，完成后接纳新交易对', async () => {
  const scheduler = createBackfillScheduler()
  let releaseHistory
  let signalStarted
  const started = new Promise(resolve => { signalStarted = resolve })
  const calls = []
  scheduler.syncSymbolKLine = async (symbol, timeframe, options) => {
    calls.push(`${options.force ? 'history' : 'fixed'}:${symbol}`)
    if (options.force) {
      signalStarted()
      await new Promise(resolve => { releaseHistory = resolve })
    }
    return { success: true, count: 9 }
  }
  scheduler.syncLastBarOnly = async symbol => { calls.push(`high:${symbol}`) }
  const initial = scheduler.processInitialSyncQueue()
  await started
  await scheduler.syncTimeframe('5m')
  await scheduler.highFrequencySync()
  assert.deepEqual(calls, ['history:NEWUSDT', 'fixed:BTCUSDT', 'high:BTCUSDT'])
  assert.equal(scheduler.initialSyncSymbols.has('NEWUSDT'), true)
  releaseHistory()
  await initial
  assert.equal(scheduler.initialSyncSymbols.size, 0)
  calls.length = 0
  await scheduler.syncTimeframe('5m')
  await scheduler.highFrequencySync()
  assert.deepEqual(calls, ['fixed:BTCUSDT', 'fixed:NEWUSDT', 'high:BTCUSDT', 'high:NEWUSDT'])
})

test('初始化仅等待同一交易对同一周期，其他交易对的周期任务不阻塞', async () => {
  const scheduler = createBackfillScheduler()
  scheduler.isSyncing.set('5m', true)
  let waits = 0
  scheduler.sleep = async () => {
    waits++
    scheduler.syncStatus.set('NEWUSDT-5m', { status: 'idle' })
  }
  await scheduler.waitForSymbolIdle('NEWUSDT', '5m')
  assert.equal(waits, 0)
  scheduler.syncStatus.set('NEWUSDT-5m', { status: 'syncing' })
  await scheduler.waitForSymbolIdle('NEWUSDT', '5m')
  assert.equal(waits, 1)
})

test('初始化单个周期失败后释放交易对，其他交易对仍可自动同步', async () => {
  const scheduler = createBackfillScheduler()
  scheduler.syncSymbolKLine = async () => { throw new Error('模拟初始化失败') }
  await scheduler.processInitialSyncQueue()
  assert.equal(scheduler.initialSyncSymbols.size, 0)
  assert.equal(scheduler.isInitialSyncRunning, false)
  const symbols = []
  scheduler.syncLastBarOnly = async symbol => { symbols.push(symbol) }
  await scheduler.highFrequencySync()
  assert.deepEqual(symbols, ['BTCUSDT', 'NEWUSDT'])
})
