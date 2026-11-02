// ==================== 加密市场趋势口径回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTrendSeries, recordTrendHistory, getTrendHistories, markTrendStale } from '../server/utils/crypto-trends.ts'
import { rollingDisclosedFlows, changeOver30Days, relativePriceChanges, latestDayChange } from '../app/utils/crypto-trend-calculations.ts'

test('主流币涨跌幅使用区间内共同基准日，保留缺失日期', () => {
  const btc = [{ date: '2026-09-01', value: 10 }, { date: '2026-10-01', value: 100 }, { date: '2026-10-02', value: 200 }, { date: '2026-10-04', value: 220 }]
  const eth = [{ date: '2026-10-02', value: 20 }, { date: '2026-10-03', value: 18 }, { date: '2026-10-04', value: 22 }]
  const [left, right] = relativePriceChanges(btc, eth, 4, '2026-10-04')
  assert.deepEqual(left.map(p => p.date), ['2026-10-02', '2026-10-04'])
  assert.equal(left[0].value, 0)
  assert.equal(right[0].value, 0)
  assert.ok(Math.abs(left[1].value - 10) < 1e-8)
  assert.ok(Math.abs(right[1].value + 10) < 1e-8)
  assert.deepEqual(relativePriceChanges(btc, [], 4, '2026-10-04'), [[], []])
  assert.deepEqual(relativePriceChanges([{ date: '2026-10-02', value: 0 }], eth, 4, '2026-10-04'), [[], []])
})

test('主导指数涨跌幅相对最新数据日，基准缺失或无效不生成涨跌幅', () => {
  const rows = [{ date: '2026-10-01', value: 100 }, { date: '2026-10-24', value: 125 }, { date: '2026-10-31', value: 150 }]
  assert.ok(Math.abs(latestDayChange(rows, 7) - 20) < 1e-8)
  assert.equal(latestDayChange(rows, 30), 50)
  assert.equal(latestDayChange(rows, 14), null)
  assert.equal(latestDayChange([], 7), null)
  assert.equal(latestDayChange([{ date: '2026-10-24', value: 0 }, rows[2]], 7), null)
})

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
