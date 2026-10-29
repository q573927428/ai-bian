// ==================== 宏观横向视区跨市场日期换算测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { logicalToCalendar, calendarToLogical } from '../app/components/macro-data/viewport-sync.ts'

const day = 86400

test('连续交易与周末休市的图表按日期同步，而不是复制柱索引', () => {
  const crypto = [0, day, 2 * day, 3 * day, 4 * day]
  const stocks = [0, 3 * day, 4 * day]
  const date = logicalToCalendar(crypto, 3, day)
  assert.equal(calendarToLogical(stocks, date, day), 1)
  assert.equal(logicalToCalendar(stocks, 1, day), date)
})

test('休市之间的窗口边界插值可逆，不吸附到其他日期', () => {
  const keys = [0, 3 * day, 4 * day]
  const logical = calendarToLogical(keys, day, day)
  assert.equal(logical, 1 / 3)
  assert.equal(logicalToCalendar(keys, logical, day), day)
})

test('右侧留白与历史不足保留窗口边界，单根数据也可以换算', () => {
  for (const keys of [[3 * day], [3 * day, 4 * day]]) {
    for (const time of [-day, 0, 3 * day, 8 * day]) {
      assert.equal(logicalToCalendar(keys, calendarToLogical(keys, time, day), day), time)
    }
  }
})
