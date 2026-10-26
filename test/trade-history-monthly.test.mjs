// ==================== 月度交易历史归档与并发读写回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import * as historyFiles from '../server/utils/trade-history-files.ts'

/** 为每个场景提供独立目录，保证测试不触碰真实交易数据。 */
async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'trade-history-test-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('按北京时间平仓月份归档，跨月持仓及回补旧交易不受当前月份影响', async () => {
  await withDirectory(async directory => {
    const before = { id: 'before', openTime: Date.parse('2026-06-29T00:00:00Z'), closeTime: Date.parse('2026-06-30T15:59:59Z') }
    const after = { ...before, id: 'after', closeTime: Date.parse('2026-06-30T16:00:00Z') }
    await historyFiles.writeMonthlyTradeHistory(before, directory)
    await historyFiles.writeMonthlyTradeHistory(after, directory)
    assert.equal(JSON.parse(await readFile(join(directory, 'trade-history-2026-06.json'), 'utf8'))[0].id, 'before')
    assert.equal(JSON.parse(await readFile(join(directory, 'trade-history-2026-07.json'), 'utf8'))[0].id, 'after')
    assert.deepEqual(historyFiles.readTradeHistoryFiles(historyFiles.listTradeHistoryFiles(directory)).map(r => r.id), ['after', 'before'])
  })
})

test('同月多笔并发写入不丢记录，重试覆盖原 ID 并保留旧字段', async () => {
  await withDirectory(async directory => {
    const trades = Array.from({ length: 30 }, (_, index) => ({ id: String(index), closeTime: Date.parse('2026-10-01T00:00:00Z') + index, pnl: index, oldField: '保留' }))
    await Promise.all(trades.map(trade => historyFiles.writeMonthlyTradeHistory(trade, directory)))
    await historyFiles.writeMonthlyTradeHistory({ id: '0', closeTime: trades[0].closeTime, pnl: 99 }, directory)
    const records = historyFiles.readTradeHistoryFiles(historyFiles.listTradeHistoryFiles(directory))
    assert.equal(records.length, 30)
    assert.equal(records.find(r => r.id === '0').pnl, 99)
    assert.equal(records.find(r => r.id === '0').oldField, '保留')
    assert.equal(records[0].id, '29')
  })
})

test('损坏历史不能被覆盖，失败后写队列可以继续恢复', async () => {
  await withDirectory(async directory => {
    const trade = { id: 'test', closeTime: Date.parse('2026-10-01T00:00:00Z') }
    const file = historyFiles.getTradeHistoryFile(trade.closeTime, directory)
    await writeFile(file, '{broken', 'utf8')
    await assert.rejects(historyFiles.writeMonthlyTradeHistory(trade, directory))
    assert.equal(await readFile(file, 'utf8'), '{broken')
    await writeFile(file, '[]', 'utf8')
    await historyFiles.writeMonthlyTradeHistory(trade, directory)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1)
  })
})

test('识别月度和旧格式文件，排除备份与分析结果，同 ID 优先采用月度版本', async () => {
  await withDirectory(async directory => {
    const old = { id: 'same', closeTime: 1, oldField: 42, pnl: 1 }
    await writeFile(join(directory, 'trade-history.json'), JSON.stringify([old]))
    await writeFile(join(directory, 'trade-history-20261001.json'), JSON.stringify([old]))
    await writeFile(join(directory, 'trade-history-2026-10.json'), JSON.stringify([{ id: 'same', closeTime: 1, pnl: 2 }]))
    for (const name of ['trade-history-analysis.json', 'trade-history-2026-10.json.backup', 'trade-history-2026-10.json.tmp', 'trade-history-2026-13.json']) await writeFile(join(directory, name), '{}')
    const files = historyFiles.listTradeHistoryFiles(directory)
    assert.equal(files.length, 3)
    assert.deepEqual(historyFiles.readTradeHistoryFiles(files), [{ ...old, pnl: 2 }])
  })
})

test('查询缓存识别月份新增、内容更新和删除，全部删除后返回空记录', async () => {
  await withDirectory(async root => {
    const directory = join(root, 'data')
    await mkdir(directory)
    const source = await readFile(new URL('../server/utils/trade-history-cache.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    const require = createRequire(import.meta.url)
    const isolatedFiles = { ...historyFiles, listTradeHistoryFiles: () => historyFiles.listTradeHistoryFiles(directory) }
    vm.runInNewContext(compiled, { module, exports: module.exports, require: name => name === './trade-history-files' ? isolatedFiles : require(name) })
    const { getCachedTradeHistory } = module.exports
    assert.equal(getCachedTradeHistory().length, 0)
    const first = { id: 'first', closeTime: Date.parse('2026-09-01T00:00:00Z'), pnl: 1 }
    await historyFiles.writeMonthlyTradeHistory(first, directory)
    assert.equal(getCachedTradeHistory().length, 1)
    await historyFiles.writeMonthlyTradeHistory({ ...first, pnl: 2 }, directory)
    assert.equal(getCachedTradeHistory()[0].pnl, 2)
    await historyFiles.writeMonthlyTradeHistory({ id: 'second', closeTime: Date.parse('2026-10-01T00:00:00Z') }, directory)
    assert.equal(getCachedTradeHistory().length, 2)
    for (const file of historyFiles.listTradeHistoryFiles(directory)) await rm(file)
    assert.equal(getCachedTradeHistory().length, 0)
  })
})
