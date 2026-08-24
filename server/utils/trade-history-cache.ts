// ==================== 交易历史缓存与查询 ====================
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

let cachedRecords: any[] = []
let cachedMtimeMs = 0
let cachedSize = 0

/** 读取并缓存交易历史；文件未变化时避免重复 JSON.parse。 */
export function getCachedTradeHistory(): any[] {
  const filePath = join(process.cwd(), 'data', 'trade-history.json')
  if (!existsSync(filePath)) return []
  const fileStat = statSync(filePath)
  if (cachedMtimeMs !== fileStat.mtimeMs || cachedSize !== fileStat.size) {
    const rawData = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(rawData)
    cachedRecords = Array.isArray(parsed) ? parsed : []
    cachedRecords.sort((a, b) => Number(b.closeTime || 0) - Number(a.closeTime || 0))
    cachedMtimeMs = fileStat.mtimeMs
    cachedSize = fileStat.size
  }
  return cachedRecords
}

/** 将订单压缩为 K 线标记和点击详情所需的最小字段。 */
export function toTradeMarker(record: any) {
  return {
    id: record.id,
    symbol: record.symbol,
    strategyId: record.strategyId,
    direction: record.direction,
    mainTimeframe: record.mainTimeframe,
    openTime: record.openTime,
    closeTime: record.closeTime,
    leverage: record.leverage,
    entryPrice: record.entryPrice,
    exitPrice: record.exitPrice,
    reason: record.reason,
    holdingMinutes: record.holdingMinutes,
    closeCategory: record.closeCategory,
    pnl: record.pnl,
    pnlPercentage: record.pnlPercentage,
  }
}
