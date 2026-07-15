function normalizeValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Array.from(value.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, mapValue]) => [key, normalizeValue(mapValue)])
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item))
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value
    return Number(value.toFixed(8))
  }

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
  return Buffer.from(stableStringify(value)).toString('base64url').substring(0, length)
}
