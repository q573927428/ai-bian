// ==================== 月度交易历史文件存储 ====================
import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { TradeHistory } from '../../types'

const writeQueues = new Map<string, Promise<void>>()

/** 只识别交易数据文件，排除分析结果、备份等；兼容尚未迁移的旧文件。 */
export function listTradeHistoryFiles(dataDir = join(process.cwd(), 'data')): string[] {
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir)
    .filter(name => /^trade-history(?:-\d{8}|-\d{4}-(?:0[1-9]|1[0-2]))?\.json$/.test(name))
    // 月度文件最后读取，同 ID 优先采用整理后的版本。
    .sort((a, b) => Number(/-\d{4}-\d{2}\.json$/.test(a)) - Number(/-\d{4}-\d{2}\.json$/.test(b)) || a.localeCompare(b))
    .map(name => join(dataDir, name))
}

/** 根据北京时间平仓月份选文件，不依赖服务器本地时区。 */
export function getTradeHistoryFile(closeTime: number, dataDir = join(process.cwd(), 'data')): string {
  if (!Number.isFinite(closeTime)) throw new Error('交易平仓时间无效')
  const month = new Date(closeTime + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)
  return join(dataDir, `trade-history-${month}.json`)
}

/** 验证数组结构；损坏文件必须报错，避免被当作空历史覆盖。 */
function parseHistory(raw: string, file: string): TradeHistory[] {
  const records = JSON.parse(raw.replace(/^\uFEFF/, ''))
  if (!Array.isArray(records)) throw new Error(`交易历史文件必须是数组: ${file}`)
  return records
}

/** 聚合全部月份并按 ID 去重，保留旧记录独有字段，最新交易排在前面。 */
export function readTradeHistoryFiles(files = listTradeHistoryFiles()): TradeHistory[] {
  const records = new Map<string, TradeHistory>()
  const withoutId: TradeHistory[] = []
  for (const file of files) {
    for (const record of parseHistory(readFileSync(file, 'utf8'), file)) {
      if (record.id) records.set(record.id, { ...records.get(record.id), ...record })
      else withoutId.push(record)
    }
  }
  return [...records.values(), ...withoutId].sort((a, b) => b.closeTime - a.closeTime)
}

/** 文件集合和内容元信息共同参与缓存失效，包含新增月份、修改和删除。 */
export function getTradeHistorySignature(files: string[]): string {
  return files.map(file => {
    const stat = statSync(file)
    return `${file}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
  }).join('|')
}

/** 串行执行同一月份的完整读改写，避免同时平仓覆盖；临时文件原子替换防止读到半份 JSON。 */
export async function writeMonthlyTradeHistory(trade: TradeHistory, dataDir = join(process.cwd(), 'data')): Promise<void> {
  const file = getTradeHistoryFile(trade.closeTime, dataDir)
  const previous = writeQueues.get(file) || Promise.resolve()
  const pending = previous.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true })
    const records = existsSync(file) ? parseHistory(await readFile(file, 'utf8'), file) : []
    const index = records.findIndex(record => record.id === trade.id)
    if (index >= 0) records[index] = { ...records[index], ...trade }
    else records.push(trade)
    records.sort((a, b) => b.closeTime - a.closeTime)
    const temporaryFile = `${file}.tmp`
    await writeFile(temporaryFile, JSON.stringify(records, null, 2) + '\n', 'utf8')
    await rename(temporaryFile, file)
  })
  writeQueues.set(file, pending)
  try {
    await pending
  } finally {
    if (writeQueues.get(file) === pending) writeQueues.delete(file)
  }
}
