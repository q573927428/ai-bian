// ==================== 北京时间日期与自然日边界 ====================
export const BEIJING_TIME_ZONE = 'Asia/Shanghai'
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 不依赖浏览器或服务器所在时区，返回北京时间的日历日期。 */
export function beijingDate(timestampMs = Date.now()): string {
  return new Date(timestampMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/** 返回北京时间当天00:00的真实Unix毫秒时间戳，不修改行情原始时间。 */
export function beijingDayStart(timestampMs = Date.now()): number {
  return Math.floor((timestampMs + BEIJING_OFFSET_MS) / 86400000) * 86400000 - BEIJING_OFFSET_MS
}

/** 完整提示时间使用固定数字年月日，避免不同平台出现“2026年/11/15”等混合格式。 */
export function formatBeijingDateTime(timestampMs: number): string {
  const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: BEIJING_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${beijingDate(timestampMs).replaceAll('-', '/')} ${clock.format(timestampMs)}`
}
