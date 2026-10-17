// ==================== K线后台同步串行调度回归测试 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// 隔离数据库和交易所依赖，仅运行真实调度方法。
const source = readFileSync(new URL('../server/modules/kline-simple-sync/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const isolated = compiled.outputText.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
const { KLineSimpleSyncService } = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`)

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
