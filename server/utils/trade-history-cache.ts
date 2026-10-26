// ==================== 交易历史缓存与查询 ====================
import { listTradeHistoryFiles, getTradeHistorySignature, readTradeHistoryFiles } from './trade-history-files'

let cachedRecords: any[] = []
let cachedSignature: string | undefined

/** 读取并缓存交易历史；文件未变化时避免重复 JSON.parse。 */
export function getCachedTradeHistory(): any[] {
  const files = listTradeHistoryFiles()
  const signature = getTradeHistorySignature(files)
  if (cachedSignature !== signature) {
    cachedRecords = readTradeHistoryFiles(files)
    cachedSignature = signature
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
