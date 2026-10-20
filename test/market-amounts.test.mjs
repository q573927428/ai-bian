// ==================== 市场规模与清算数据口径回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
// Node 原生测试补全 Nuxt 支持的无扩展名导入。
registerHooks({ resolve(specifier, context, next) { return next(specifier === './crypto-trends' ? './crypto-trends.ts' : specifier, context) } })
const { parseAmountSeries, parseDisclosedOi } = await import('../server/utils/market-data.ts')

const timestamp = Date.parse('2026-10-17') / 1000
const series = (points) => ({ Data: points.map(([Timestamp, Result]) => ({ Timestamp, Result })) })

test('完整供应序列只汇总最新同日值，不混合旧日期或仅取前十币种', () => {
  const Series = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`coin${index}`, series([[timestamp, index + 1]])]))
  Series.expired = series([[timestamp - 86400, 1000]])
  const value = parseAmountSeries({ Description: 'Supply', Frequency: 'Daily', Series }, 'Supply')
  assert.equal(value.usd, 78)
  assert.equal(value.coverage.length, 12)
  assert.equal(value.date, '2026-10-17')
})

test('空头清算图表负数转换为金额绝对值，持仓不接受负数', () => {
  const input = { Description: 'Liquidations', Frequency: 'Daily', Series: { exchange: series([[timestamp, -1200]]) } }
  assert.equal(parseAmountSeries(input, 'Liquidations', true).usd, 1200)
  assert.throws(() => parseAmountSeries(input, 'Liquidations'), /为空/)
  assert.throws(() => parseAmountSeries({ ...input, Frequency: 'Monthly' }, 'Liquidations', true), /格式异常/)
})

test('持仓保留公开覆盖范围，零值有效，错误页不能当成零', () => {
  const item = { '@type': 'DataFeedItem', dateModified: '2026-10-17', item: { name: 'OI', variableMeasured: [{ name: 'A', value: 20 }, { name: 'B', value: 0 }] } }
  const html = `<script type="application/ld+json">${JSON.stringify(item)}</script>`
  assert.deepEqual(parseDisclosedOi(html, 'OI'), { usd: 20, date: '2026-10-17', coverage: ['A', 'B'] })
  assert.throws(() => parseDisclosedOi('<html>Access denied</html>', 'OI'), /为空/)
  assert.throws(() => parseDisclosedOi(html, 'Unrelated'), /为空/)
})
