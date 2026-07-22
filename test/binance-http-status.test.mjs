// ==================== Binance HTTP 状态识别回归测试 ====================

import assert from 'node:assert/strict'
import test from 'node:test'
import { detectBinanceRateLimitHttpStatus } from '../server/utils/binance-http-status.ts'

const falsePositiveSignatures = [
  'a5db1c9c0a39d088885ca3cd57fbf4f97e05f8d72534e16c529a5cf9d9418ada',
  'f6f41e9c83767e3396ccf43a97418ed5578db9349d00c8d04c2b31d950990a33',
  '631b0ed2147aa752ac103e506e10a4edd576755e047418863bc2a13c09328292',
  'd861b53b00b00d6a1e538398ed496e181a680e65c6ba4291ec344f9966829052',
  'd1b7751adb4c82f245e1c25af47912976cbaf694bf1ff2d78f64292c9f6baac5',
  '93fd292791ca26068934296db5fda9b3209a647cb67ff55b0fe4fa7e8c4f6a3d',
]

test('签名中的 418 和 429 不会被识别为 HTTP 状态', () => {
  for (const signature of falsePositiveSignatures) {
    const error = new Error(`binance GET https://fapi.binance.com/fapi/v3/positionRisk?signature=${signature} fetch failed`)
    assert.equal(detectBinanceRateLimitHttpStatus(error), undefined)
  }
})

test('识别结构化 HTTP 状态字段及错误原因链', () => {
  assert.equal(detectBinanceRateLimitHttpStatus({ status: 418 }), 418)
  assert.equal(detectBinanceRateLimitHttpStatus({ statusCode: 429 }), 429)
  assert.equal(detectBinanceRateLimitHttpStatus({ response: { status: 429 } }), 429)
  assert.equal(detectBinanceRateLimitHttpStatus({ cause: { status: 418 } }), 418)
})

test('兼容 CCXT 标准 HTTP 状态文本', () => {
  assert.equal(detectBinanceRateLimitHttpStatus(new Error("binance GET /fapi 418 I'm a teapot")), 418)
  assert.equal(detectBinanceRateLimitHttpStatus(new Error('binance GET /fapi 429 Too Many Requests')), 429)
  assert.equal(detectBinanceRateLimitHttpStatus(new Error('request id 429 failed')), undefined)
})
