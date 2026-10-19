// ==================== AI 建连重试回归测试 ====================

import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAIWithConnectionRetry } from '../server/utils/ai-connection-retry.ts'

test('建连重试与超时边界', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const connectionError = new TypeError('fetch failed', {
    cause: new AggregateError([
      Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT', syscall: 'connect' }),
      Object.assign(new Error('IPv6 unreachable'), { code: 'ENETUNREACH' })
    ])
  })
  let calls = 0
  const retries = []
  globalThis.fetch = async () => {
    if (++calls < 3) throw connectionError
    return new Response('{}')
  }
  await fetchAIWithConnectionRetry('https://example.com', { signal: new AbortController().signal }, (n) => retries.push(n))
  assert.equal(calls, 3)
  assert.deepEqual(retries, [1, 2])

  calls = 0
  globalThis.fetch = async () => { calls++; throw connectionError }
  await assert.rejects(fetchAIWithConnectionRetry('https://example.com', { signal: new AbortController().signal }, () => {}))
  assert.equal(calls, 3)

  // 响应丢失时无法确定服务端是否已生成，不能自动重复提交。
  calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }) }
  await assert.rejects(fetchAIWithConnectionRetry('https://example.com', { signal: new AbortController().signal }, () => {}))
  assert.equal(calls, 1)

  calls = 0
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }) }
  assert.equal((await fetchAIWithConnectionRetry('https://example.com', { signal: new AbortController().signal }, () => {})).status, 429)
  assert.equal(calls, 1)

  calls = 0
  const controller = new AbortController()
  globalThis.fetch = async () => { calls++; throw connectionError }
  await assert.rejects(fetchAIWithConnectionRetry('https://example.com', { signal: controller.signal }, () => controller.abort()))
  assert.equal(calls, 1)
})
