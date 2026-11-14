// ==================== 趋势与宏观北京时间边界回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { beijingDate, beijingDayStart, BEIJING_TIME_ZONE, formatBeijingDateTime } from '../app/utils/beijing-time.ts'
import { calculateMarketBreadth } from '../app/utils/trend-market-breadth.ts'
import { parseTrendSeries } from '../server/utils/crypto-trends.ts'
import { parseOptionSkew } from '../server/utils/crypto-sentiment.ts'
import { trendDisplayPoints, relativePriceChanges } from '../app/utils/crypto-trend-calculations.ts'
import { ratioDisplayPoints } from '../app/utils/relative-market-calculations.ts'

test('北京时间00:40与首页小时线对应同一真实时间，不受宿主时区影响', () => {
  const instant = Date.parse('2026-11-14T16:40:00Z')
  assert.equal(beijingDate(instant), '2026-11-15')
  assert.equal(beijingDate(instant - 41 * 60000), '2026-11-14')
  assert.equal(beijingDayStart(instant), Date.parse('2026-11-14T16:00:00Z'))
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: BEIJING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  assert.equal(formatter.format(instant), '15/11/2026, 00:40')
  assert.equal(formatBeijingDateTime(instant), '2026/11/15 00:40')
})

test('日线比值跨日追加当前北京时间快照，周期起点与历史保持不变', () => {
  const now = Date.parse('2026-11-14T16:40:00Z') / 1000
  const points = [{ t: Date.parse('2026-11-13T00:00:00Z') / 1000, value: .028 }, { t: Date.parse('2026-11-14T00:00:00Z') / 1000, value: .02795811 }]
  const display = ratioDisplayPoints(points, 86400, now)
  assert.deepEqual(display.slice(0, -1), points)
  assert.equal(display.at(-1).t, now)
  assert.equal(display.at(-1).periodStart, points.at(-1).t)
  assert.equal(display.at(-1).value, .02795811)
  assert.equal(formatBeijingDateTime(display.at(-1).t * 1000), '2026/11/15 00:40')
  assert.equal(points.length, 2)
  assert.equal(ratioDisplayPoints(points, 86400, now + 86400).length, 2)
  assert.equal(ratioDisplayPoints(points, 86400, points[0].t - 1).length, 2)
  const hourly = [{ t: Date.parse('2026-11-14T16:00:00Z') / 1000, value: .02795811 }]
  assert.deepEqual(ratioDisplayPoints(hourly, 3600, now), hourly)
})

test('跨年、跨月都按北京时间归日', () => {
  assert.equal(beijingDate(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01')
  assert.equal(beijingDate(Date.parse('2026-10-31T16:00:00Z')), '2026-11-01')
})

test('凌晨今日列显示真实盘中快照，历史不改写，涨跌幅保留盘中标记', () => {
  const now = Date.parse('2026-11-14T16:40:00Z')
  const rows = [{ date: '2026-11-13', value: 100 }, { date: '2026-11-14', value: 110, provisional: true }]
  const display = trendDisplayPoints(rows, now)
  assert.deepEqual(display.slice(0, -1), rows)
  assert.deepEqual(display.at(-1), { date: '2026-11-15', value: 110, provisional: true })
  assert.equal(rows.length, 2)
  const [changes] = relativePriceChanges(rows, rows, 7, '2026-11-15')
  assert.equal(changes.at(-1).provisional, true)
  assert.ok(Math.abs(trendDisplayPoints(changes, now).at(-1).value - 10) < 1e-8)
  assert.deepEqual(trendDisplayPoints(rows.map(p => ({ ...p, provisional: false })), now), rows.map(p => ({ ...p, provisional: false })))
  assert.equal(trendDisplayPoints([{ date: '2026-11-13', value: 110, provisional: true }], now).length, 1)
})

test('外部指标当天只展示已披露值，明确标记披露日，不生成假新数据', () => {
  const now = Date.parse('2026-11-14T16:40:00Z')
  const rows = [{ date: '2026-11-14', value: 13 }]
  assert.deepEqual(trendDisplayPoints(rows, now), rows)
  assert.deepEqual(trendDisplayPoints(rows, now, true).at(-1), { date: '2026-11-15', value: 13, disclosedDate: '2026-11-14' })
})

test('来源实际时间戳转换为北京时间；ETF的交易日期保持来源口径', () => {
  const Timestamp = Date.parse('2026-11-13T16:00:00Z') / 1000
  const input = { Description: 'Liquidations', Frequency: 'Daily', Series: { A: { Data: [{ Timestamp, Result: 5 }] } } }
  assert.equal(parseTrendSeries(input, 'Liquidations', true).points[0].date, '2026-11-14')
  const etf = { Description: 'ETF', Frequency: 'Daily', Series: { 'Total Net Flow': { Data: [{ Timestamp, Result: -5 }] } } }
  assert.equal(parseTrendSeries(etf, 'ETF', false, true).points[0].date, '2026-11-13')
  const skew = { Description: 'BTC Twenty Five Delta Option Skew', Frequency: 'Daily', Series: { '30 Day Exp': { Data: [{ Timestamp, Result: -5 }] } } }
  assert.equal(parseOptionSkew(skew, 'btc', 30).at(-1).date, '2026-11-14')
})

test('凌晨回看范围按北京时间今天计算，币安盘中日线与首页保留相同起点', () => {
  const now = Date.parse('2026-11-14T16:40:00Z')
  const start = Date.parse('2026-08-01T00:00:00Z') / 1000
  const end = Date.parse('2026-11-14T00:00:00Z') / 1000
  const rows = Array.from({ length: (end - start) / 86400 + 1 }, (_, i) => ({ symbol: 'BTCUSDT', t: start + i * 86400, c: 100 + i }))
  const result = calculateMarketBreadth(rows, 7, now)
  assert.equal(result.ma60[0].date, '2026-11-09')
  assert.equal(result.ma60.at(-1).date, '2026-11-14')
  assert.equal(result.ma60.at(-1).provisional, true)
  assert.equal(result.ma60.length, 6)
})

test('宏观本地与TradingView视图均显式使用上海时区', () => {
  const drawer = fs.readFileSync(new URL('../app/components/MacroDataDrawer.vue', import.meta.url), 'utf8')
  const chart = fs.readFileSync(new URL('../app/components/macro-data/MacroKLineChart.vue', import.meta.url), 'utf8')
  assert.match(drawer, /timezone: 'Asia\/Shanghai'/)
  assert.match(chart, /timeZone: 'Asia\/Shanghai'/)
  assert.doesNotMatch(drawer, /timezone: 'Etc\/UTC'/)
})
