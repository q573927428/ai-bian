// ==================== 稳定序列化与缓存摘要 ====================
import { createHash } from 'node:crypto'

function normalizeValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Array.from(value.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, mapValue]) => [key, normalizeValue(mapValue)])
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item))
  }

  // 保留原始数值精度，小价格交易对的盘中更新可能小于1e-8，不能被舍入吞掉。
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeValue(record[key])
        return acc
      }, {})
  }

  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

export function shortHash(value: unknown, length = 32): string {
  // 必须对完整内容求摘要；截取 Base64 前缀会忽略后部的行情、周期参数和提示词变化。
  return createHash('sha256').update(stableStringify(value)).digest('hex').substring(0, length)
}
