// ==================== 加密市场趋势口径回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTrendSeries, recordTrendHistory, getTrendHistories, markTrendStale } from '../server/utils/crypto-trends.ts'
import { rollingDisclosedFlows, changeOver30Days } from '../app/utils/crypto-trend-calculations.ts'

const timestamp = Date.parse('2026-10-15') / 1000
const series = rows => ({ Data: rows.map(([Timestamp, Result]) => ({ Timestamp, Result })) })
test('按同日汇总完整历史，缺失不补零，空头清算取绝对值', () => {
  const data = { Description: 'Liquidations', Frequency: 'Daily', Series: { A: series([[timestamp, -5], [timestamp + 172800, -7]]), B: series([[timestamp, -3]]) } }
  assert.deepEqual(parseTrendSeries(data, 'Liquidations', true).points, [{ date: '2026-10-15', value: 8 }, { date: '2026-10-17', value: 7 }])
  assert.throws(() => parseTrendSeries({ ...data, Frequency: 'Monthly' }, 'Liquidations', true))
})
test('ETF 只取单日总净流入，保留负值，拒绝重复日', () => {
  const data = { Description: 'ETF', Frequency: 'Daily', Series: { 'Total Net Flow': series([[timestamp, -6]]), Volume: series([[timestamp, 999]]) } }
  assert.equal(parseTrendSeries(data, 'ETF', false, true).points[0].value, -6)
  data.Series['Total Net Flow'] = series([[timestamp, 1], [timestamp, 2]])
  assert.throws(() => parseTrendSeries(data, 'ETF', false, true), /重复/)
})
test('自然日累计不是最近七条，30日变化需要准确基准日', () => {
  const rows = [{ date: '2026-10-01', value: 100 }, { date: '2026-10-07', value: -10 }, { date: '2026-10-08', value: 5 }]
  assert.deepEqual(rollingDisclosedFlows(rows), [{ date: '2026-10-07', value: 90 }, { date: '2026-10-08', value: -5 }])
  const changes = changeOver30Days([{ date: '2026-09-15', value: 100 }, { date: '2026-10-15', value: 110 }, { date: '2026-10-16', value: 120 }])
  assert.equal(changes.length, 1)
  assert.ok(Math.abs(changes[0].value - 10) < 1e-8)
})
test('来源失败保留历史、日期倒退不覆盖，返回对象隔离缓存', () => {
  const data = { Description: 'OI', Frequency: 'Daily', Series: { A: series([[timestamp, 5]]) } }
  recordTrendHistory('btcOi', data, 'OI')
  markTrendStale('btcOi')
  const saved = getTrendHistories()
  assert.equal(saved.btcOi.stale, true)
  assert.equal(saved.btcOi.points[0].value, 5)
  saved.btcOi.points[0].value = 999
  assert.equal(getTrendHistories().btcOi.points[0].value, 5)
  data.Series.A = series([[timestamp - 86400, 4]])
  assert.throws(() => recordTrendHistory('btcOi', data, 'OI'), /倒退/)
})
