// ==================== 加密趋势历史缓存与磁盘持久化 ====================
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { CryptoTrendKey, TrendHistory, TrendPoint } from '../../types/crypto-trends'

export const CRYPTO_TREND_KEYS: CryptoTrendKey[] = ['btcEtf', 'ethEtf', 'btcOi', 'ethOi', 'longLiquidations', 'shortLiquidations', 'stablecoinSupply']
const empty = (): TrendHistory => ({ points: [], updatedAt: null, stale: true, coverage: [] })
const cache = Object.fromEntries(CRYPTO_TREND_KEYS.map(key => [key, empty()])) as Record<CryptoTrendKey, TrendHistory>
const file = join(process.cwd(), 'data', 'crypto-trends.json')

/** 按同一 UTC 日期汇总有效分项；不延用已停用的历史系列，也不把空值补成零。 */
export function parseTrendSeries(data: any, name: string, absolute = false, totalOnly = false): { points: TrendPoint[]; coverage: string[] } {
  if (data?.Description !== name || data.Frequency !== 'Daily' || !data.Series) throw new Error('趋势历史数据格式异常')
  const series = totalOnly ? { 'Total Net Flow': data.Series['Total Net Flow'] } : data.Series
  const days = new Map<string, Map<string, number>>()
  for (const [label, entry] of Object.entries(series) as Array<[string, any]>) {
    if (!Array.isArray(entry?.Data)) throw new Error('趋势序列缺失')
    for (const row of entry.Data) {
      if (typeof row?.Timestamp !== 'number' || !Number.isFinite(row.Timestamp) || row.Timestamp <= 0 || row.Timestamp * 1000 > Date.now() + 86400000) continue
      if (typeof row.Result !== 'number' || !Number.isFinite(row.Result) || (!absolute && !totalOnly && row.Result < 0)) continue
      const date = new Date(row.Timestamp * 1000).toISOString().slice(0, 10)
      if (!days.has(date)) days.set(date, new Map())
      const values = days.get(date)!
      if (values.has(label)) throw new Error('同日趋势数据重复')
      values.set(label, absolute ? Math.abs(row.Result) : row.Result)
    }
  }
  const sorted = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-400)
  if (!sorted.length) throw new Error('趋势历史为空')
  return {
    points: sorted.map(([date, values]) => ({ date, value: [...values.values()].reduce((a, b) => a + b, 0) })),
    coverage: [...sorted.at(-1)![1].keys()],
  }
}

/** 与底部行情同步共享同一次下载，避免新增看板重复请求上游。 */
export function recordTrendHistory(key: CryptoTrendKey, data: any, name: string) {
  const parsed = parseTrendSeries(data, name, key.endsWith('Liquidations'), key.endsWith('Etf'))
  const previous = cache[key].points.at(-1)?.date
  if (previous && parsed.points.at(-1)!.date < previous) throw new Error('趋势来源日期倒退')
  cache[key] = { ...parsed, updatedAt: new Date().toISOString(), stale: false }
}

export function markTrendStale(key: CryptoTrendKey) { cache[key].stale = true }
export function getTrendHistories() { return structuredClone(cache) }

/** 重启先恢复旧数据并标记待同步，只有成功下载才清除过期标记。 */
export async function restoreTrendHistories() {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    for (const key of CRYPTO_TREND_KEYS) {
      const row = saved[key]
      if (row && Array.isArray(row.points) && row.points.every((p: any) => typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value)) && Array.isArray(row.coverage)) {
        cache[key] = { points: row.points.slice(-400), coverage: row.coverage.filter((x: unknown) => typeof x === 'string'), updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null, stale: true }
      }
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[CryptoTrends] 历史缓存恢复失败:', error.message)
  }
}

/** 单次市场同步结束后原子落盘，写入失败不清空内存里的可用数据。 */
export async function persistTrendHistories() {
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(cache), 'utf8')
    await rename(`${file}.tmp`, file)
  } catch (error: any) { console.warn('[CryptoTrends] 历史缓存保存失败:', error.message) }
}
