// ==================== 豆包 Agent 接口诊断脚本 ====================

import 'dotenv/config'
import { readFile } from 'node:fs/promises'

/**
 * 使用当前 .env 配置验证豆包 Agent 的网络、鉴权、模型和思考参数。
 * 脚本不会修改项目配置，也不会输出 API Key。
 */

const apiKey = process.env.DOUBAO_AGENT_API_KEY || ''
const apiUrl = (process.env.DOUBAO_AGENT_API_URL || '').replace(/\/$/, '')
const model = process.env.DOUBAO_AGENT_MODEL || ''
const timeoutMs = Number(process.env.DIAGNOSE_TIMEOUT_MS || 45000)

if (!apiKey || !apiUrl || !model) {
  console.error('配置不完整：请确认 DOUBAO_AGENT_API_KEY、DOUBAO_AGENT_API_URL、DOUBAO_AGENT_MODEL')
  process.exitCode = 1
}

const endpoint = `${apiUrl}/chat/completions`

/**
 * 执行单次诊断请求，并返回是否成功及耗时。
 */
async function runRequest(name, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    const elapsed = Date.now() - startedAt
    console.log(`[${name}] HTTP ${response.status}, ${elapsed}ms`)
    console.log(text.slice(0, 1000))
    return { ok: response.ok, status: response.status, elapsed }
  } catch (error) {
    const elapsed = Date.now() - startedAt
    if (error?.name === 'AbortError') {
      console.error(`[${name}] 请求在 ${elapsed}ms 超时（DIAGNOSE_TIMEOUT_MS=${timeoutMs}）`)
    } else {
      console.error(`[${name}] 网络或 TLS 错误（${elapsed}ms）：${error?.message || error}`)
    }
    return { ok: false, error: error?.name || 'Error', elapsed }
  } finally {
    clearTimeout(timer)
  }
}

const baseBody = {
  model,
  messages: [{ role: 'user', content: '请仅回复 JSON：{"ok":true}' }],
  temperature: 0.1,
  max_tokens: 50,
}

await runRequest('thinking-disabled', {
  ...baseBody,
  thinking: { type: 'disabled' },
})
await runRequest('thinking-omitted', baseBody)

// 使用真实策略提示词和生产配置的 5 并发，验证是否因 Agent 并发配额或排队而失败。
const strategy = JSON.parse(await readFile('data/strategies/strategy_001.json', 'utf8'))
const productionBody = {
  model,
  messages: [
    {
      role: 'system',
      content: '你是专业的量化交易策略执行引擎。所有条件逐条验证，只输出合法 JSON。',
    },
    {
      role: 'user',
      content: `${strategy.aiPrompt.userPrompt}\n当前价格：120000，EMA14：119800，EMA50：119500，RSI：55，ADX：25，OI变化率：0.9%。`,
    },
  ],
  temperature: strategy.aiPrompt.temperature,
  max_tokens: strategy.aiPrompt.maxTokens,
  thinking: { type: 'disabled' },
}

console.log('\n开始模拟生产配置：thinking disabled、max_tokens=2000、并发=5')
const concurrentResults = await Promise.all(
  Array.from({ length: 5 }, (_, index) => runRequest(`production-${index + 1}`, productionBody)),
)
const successfulCount = concurrentResults.filter(result => result.ok).length
console.log(`并发测试结果：${successfulCount}/5 成功`)
