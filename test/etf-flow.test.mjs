// ==================== ETF 公开 JSON 解析回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
// Node 原生测试补全 Nuxt 支持的无扩展名导入。
registerHooks({ resolve(specifier, context, next) { return next(specifier === './crypto-trends' ? './crypto-trends.ts' : specifier, context) } })
const { parseEtfFlow, ETF_FLOW_SOURCES } = await import('../server/utils/etf-flow.ts')

const timestamp = Date.parse('2026-10-15T12:00:00Z') / 1000
const name = ETF_FLOW_SOURCES.btc.name
/** 构造目标序列，避免混淆成交量和累计净流入。 */
const sample = rows => ({ Description: name, Frequency: 'Daily', Series: { 'Total Net Flow': { Data: rows } } })

test('JSON 选最新时间点，保留负流入及零值，忽略无关序列', () => {
  const data = sample([{ Timestamp: timestamp, Result: -60300000 }, { Timestamp: timestamp - 86400, Result: 10 }])
  data.Series.Volume = { Data: [{ Timestamp: timestamp + 86400, Result: 999 }] }
  assert.deepEqual(parseEtfFlow(data, name), { usd: -60300000, date: '2026-10-15' })
  assert.equal(parseEtfFlow(sample([{ Timestamp: timestamp, Result: 0 }]), name).usd, 0)
})

test('最新空值不冒充零、不回退旧日期，错误数据拒绝解析', () => {
  assert.throws(() => parseEtfFlow(sample([{ Timestamp: timestamp - 86400, Result: 5 }, { Timestamp: timestamp, Result: null }]), name), /缺少有效/)
  for (const data of [null, '<html>Access denied</html>', { ...sample([]), Description: 'Cumulative Flow' }, { ...sample([]), Frequency: 'Monthly' }]) assert.throws(() => parseEtfFlow(data, name), /格式异常/)
  assert.throws(() => parseEtfFlow(sample([{ Timestamp: timestamp, Result: '53' }]), name), /缺少有效/)
})
