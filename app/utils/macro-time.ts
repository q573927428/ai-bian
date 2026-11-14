// ==================== 宏观K线盘中快照显示时间 ====================
import { beijingDate } from './beijing-time.ts'

/**
 * 仅将币安当前未结束、且已跨北京时间零点的末柱显示为本次读取时刻。
 * 原始K线时间戳、历史柱及Yahoo交易日均保持原值，避免改变跨市场匹配和收益计算。
 */
export function macroDisplayTime(timestamp: number, latestTimestamp: number | undefined, periodSeconds: number, source: string, nowMs: number): number {
  const now = nowMs / 1000
  if (source !== 'binance' || timestamp !== latestTimestamp || timestamp > now || timestamp + periodSeconds <= now) return timestamp
  return beijingDate(timestamp * 1000) < beijingDate(nowMs) ? Math.floor(now) : timestamp
}
