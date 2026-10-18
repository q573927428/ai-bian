// ==================== ETF 公开数据解析回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEtfFlow, ETF_FLOW_SOURCES } from '../server/utils/etf-flow.ts'

/** 构造来源结构，覆盖多指标、日期、单位和空值校验。 */
function row(value, date = '2026-10-15T12:00:00.000Z', unit = 'USD', name = ETF_FLOW_SOURCES.btc.name) {
  return { '@type': 'DataFeedItem', dateModified: date, item: { name, variableMeasured: [{ name: 'Total Net Flow', value, unitText: unit }] } }
}
const html = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

test('只读取目标美元单日合计，并选择最新来源日期', () => {
  const source = html({ '@graph': [row(10, '2026-10-14'), row(-60300000), row(99, '2026-10-16', 'ETH'), row(88, '2026-10-16', 'USD', 'Cumulative Net Flow')] })
  assert.deepEqual(parseEtfFlow(source, ETF_FLOW_SOURCES.btc.name), { usd: -60300000, date: '2026-10-15' })
})

test('有效零值可以展示，缺失及错误页不得冒充零流入', () => {
  assert.equal(parseEtfFlow(html(row(0)), ETF_FLOW_SOURCES.btc.name).usd, 0)
  for (const source of ['<html>Access denied</html>', html(row(null)), html(row('53')), html(row(10, 'invalid')), html(row(10, '2099-01-01'))]) {
    assert.throws(() => parseEtfFlow(source, ETF_FLOW_SOURCES.btc.name), /缺少有效净流入数据/)
  }
})

test('无关损坏 JSON 不影响 ETH 指标解析', () => {
  const source = '<script type="application/ld+json">invalid</script>' + html(row(12300000, '2026-10-15', 'USD', ETF_FLOW_SOURCES.eth.name))
  assert.deepEqual(parseEtfFlow(source, ETF_FLOW_SOURCES.eth.name), { usd: 12300000, date: '2026-10-15' })
})
