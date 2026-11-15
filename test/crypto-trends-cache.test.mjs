// ==================== 清算旧缓存升级与重启恢复回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'

test('旧清算缓存重新下载校准，其他指标保留，新缓存重启后继续防止日期倒退', async () => {
  const originalCwd = process.cwd()
  const temporary = await mkdtemp(join(tmpdir(), 'crypto-trends-cache-'))
  const moduleUrl = new URL('../server/utils/crypto-trends.ts', import.meta.url)
  try {
    process.chdir(temporary)
    await mkdir('data')
    // 同时覆盖迁移前和已被错误加一天的文件，禁止依赖旧版北京时间标记判断是否可信。
    for (const beijingDates of [false, true]) {
      const metric = { points: [{ date: '2026-11-15', value: 100 }], coverage: ['A'], updatedAt: '2026-11-14T16:34:37Z', stale: false }
      await writeFile(join('data', 'crypto-trends.json'), JSON.stringify({
        _beijingDates: beijingDates, longLiquidations: metric, shortLiquidations: metric,
        btcOi: { ...metric, points: [{ date: '2026-11-13', value: 200 }] },
      }), 'utf8')
      const cache = await import(`${moduleUrl.href}?legacy=${beijingDates}`)
      await cache.restoreTrendHistories()
      assert.deepEqual(cache.getTrendHistories().longLiquidations.points, [])
      assert.deepEqual(cache.getTrendHistories().shortLiquidations.points, [])
      assert.equal(cache.getTrendHistories().btcOi.points.at(-1).date, '2026-11-13')
      const input = { Description: 'Liquidations', Frequency: 'Daily', Series: { A: { Data: [{ Timestamp: Date.parse('2026-11-14T00:00:00Z') / 1000, Result: -100 }] } } }
      cache.recordTrendHistory('shortLiquidations', input, 'Liquidations')
      cache.recordTrendHistory('longLiquidations', input, 'Liquidations')
      assert.equal(cache.getTrendHistories().shortLiquidations.points.at(-1).date, '2026-11-14')
      await cache.persistTrendHistories()
      const saved = JSON.parse(await readFile(join('data', 'crypto-trends.json'), 'utf8'))
      assert.equal(saved._liquidationDateVersion, 2)
      // 新进程模块重新加载，验证不会再次偏移，也不会每次重启丢弃校准后的历史。
      const restored = await import(`${moduleUrl.href}?restored=${beijingDates}`)
      await restored.restoreTrendHistories()
      assert.equal(restored.getTrendHistories().shortLiquidations.points.at(-1).date, '2026-11-14')
      assert.equal(restored.getTrendHistories().shortLiquidations.stale, true)
      input.Series.A.Data[0].Timestamp -= 86400
      assert.throws(() => restored.recordTrendHistory('shortLiquidations', input, 'Liquidations'), /日期倒退/)
    }
  } finally {
    process.chdir(originalCwd)
    // 只递归清理本测试通过 mkdtemp 创建的系统临时目录。
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
    await rm(temporary, { recursive: true, force: true })
  }
})
