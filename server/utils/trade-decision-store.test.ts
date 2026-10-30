// ==================== 决策档案持久化与路径边界验证 ====================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAnalysisMonth, readTradeDecision, saveTradeDecision } from './trade-decision-store.ts'
import type { TradeDecision } from '../../types/trade-decision'

test('完整中文提示词原样持久化，同一分析复用文件，读取不依赖进程缓存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trade-decision-'))
  try {
    const analysisId = randomUUID()
    const messages = [{ role: 'system', content: '历史经验\n保留空格  ' }, { role: 'user', content: '完整提示词\n价格：123.45\n' }]
    // UTC 月末下午16点即北京时间次月零点，不能按服务器时区或实际开仓月份分类。
    const requestedAt = Date.parse('2026-10-31T16:00:00.000Z')
    const month = getAnalysisMonth(requestedAt)
    assert.equal(month, '2026-11')
    assert.equal(getAnalysisMonth(requestedAt - 1), '2026-10')
    const document = { schemaVersion: 1, analysisId, requestedAt, messages, rawResponse: '{"direction":"LONG"}' } as TradeDecision
    assert.equal(await saveTradeDecision(document, directory), analysisId)
    await saveTradeDecision(document, directory)
    assert.deepEqual(await readdir(directory), [month])
    assert.deepEqual(await readdir(join(directory, month)), [`${analysisId}.json`])
    assert.deepEqual(await readTradeDecision(analysisId, directory, month), document)
    await assert.rejects(readTradeDecision(analysisId, directory, '../outside'), /无效/)
    await assert.rejects(readTradeDecision(analysisId, directory, '2026-13'), /无效/)
    await assert.rejects(readTradeDecision(analysisId, directory, '2026-10'), { code: 'ENOENT' })
    assert.throws(() => getAnalysisMonth(NaN), /无效/)
    await assert.rejects(readTradeDecision('../outside', directory), /无效/)
    await assert.rejects(saveTradeDecision({ ...document, analysisId: '../outside' }, directory), /无效/)
    await assert.rejects(readTradeDecision(randomUUID(), directory), { code: 'ENOENT' })
    const legacyId = randomUUID()
    const legacy = { ...document, analysisId: legacyId }
    await writeFile(join(directory, `${legacyId}.json`), JSON.stringify(legacy), 'utf8')
    assert.deepEqual(await readTradeDecision(legacyId, directory), legacy)
    assert.deepEqual(await readTradeDecision(legacyId, directory, month), legacy)
    await writeFile(join(directory, month, `${analysisId}.json`), '{}', 'utf8')
    await assert.rejects(readTradeDecision(analysisId, directory, month), /格式无效/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
