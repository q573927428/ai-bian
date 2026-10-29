// ==================== 宏观十字光标时间匹配 ====================
import type { InjectionKey, Ref } from 'vue'
import type { MacroPeriod } from '../../../types/macro-market'

/** 光标广播按周期和交易日期匹配，source 用于防止回传至来源图。 */
export interface MacroCrosshairPosition {
  source: string
  period: MacroPeriod
  key: number
}

/** 固定日期下单市场的真实 K 线比较，不依赖光标是否在当前可视区域内。 */
export interface MacroPinnedSummary {
  marketId: string
  key: number
  period: MacroPeriod
  status: string
  from?: string
  to?: string
  percent?: string
  changeClass?: string
  duration?: string
  selectedTime?: number
  latestTime?: number
  /** 原始区间收益率、结束交易日期及收盘价最大回撤，避免从展示字符串反推。 */
  returnPercent?: number
  latestKey?: number
  maxDrawdown?: number
}

/** 每个抽屉独享同步通道，避免不同页面实例间互相影响。 */
export interface MacroCrosshairChannel {
  pinned: Ref<MacroCrosshairPosition | null>
  publish: (position: MacroCrosshairPosition | null) => void
  subscribe: (listener: (position: MacroCrosshairPosition | null) => void) => () => void
}

export const macroCrosshairKey: InjectionKey<MacroCrosshairChannel> = Symbol('macro-crosshair')

/** 日周线用当地交易日期对齐，分钟线严格匹配时间戳，不吸附到休市前的柱。 */
export function crosshairTimeKey(timestamp: number, period: MacroPeriod, marketId: string): number {
  if (period !== '1d' && period !== '1w') return timestamp
  // 日经周线起点在东京午夜（UTC 仍为周日），必须先转换为交易所日期。
  const timezone = marketId === 'nikkei' ? 'Asia/Tokyo'
    : ['dxy', 'tnx', 'cqqq'].includes(marketId) ? 'America/New_York' : 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp * 1000))
  const value = (type: string) => Number(parts.find(part => part.type === type)!.value)
  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day')))
  if (period === '1w') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.getTime() / 1000
}
