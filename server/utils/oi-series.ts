// ==================== OI 内存时间序列工具 ====================

/**
 * 单个 5m OI 序列点
 *
 * symbol 由外层 Map 维护，避免在每条历史记录中重复保存字符串。
 */
export interface OISeriesPoint {
  timestamp: number
  openInterest: number
}

/**
 * 将历史 OI 时间点归属到其刚结束的 K 线开始时间。
 *
 * Binance openInterestHist 的 07:05 快照描述 07:00~07:05 这段结束时的 OI，
 * 而 K 线 timestamp 使用区间开始时间，因此需要映射到 07:00，而不是 07:05。
 */
export function mapOIHistoryTimestampToKlineBucket(timestamp: number, intervalSeconds: number): number {
  if (!Number.isFinite(timestamp) || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return NaN
  return Math.floor((timestamp - 1) / intervalSeconds) * intervalSeconds
}

/**
 * 按时间戳去重并升序整理 OI 序列。
 */
export function normalizeOISeries(points: OISeriesPoint[]): OISeriesPoint[] {
  const byTimestamp = new Map<number, OISeriesPoint>()
  for (const point of points) byTimestamp.set(point.timestamp, point)
  return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * 将最新 OI 写入对应 5m 桶，同一桶只保留最后一次采集值。
 */
export function upsertOISeriesPoint(points: OISeriesPoint[], point: OISeriesPoint): void {
  const last = points[points.length - 1]
  if (last?.timestamp === point.timestamp) {
    points[points.length - 1] = point
    return
  }
  if (!last || last.timestamp < point.timestamp) {
    points.push(point)
    return
  }

  const index = points.findIndex(item => item.timestamp === point.timestamp)
  if (index >= 0) points[index] = point
  else points.push(point)
  points.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * 在升序 OI 序列中查找不晚于目标时间的最近快照。
 */
export function findOIInSeriesAtOrBefore(
  points: OISeriesPoint[],
  targetTimestamp: number
): OISeriesPoint | undefined {
  let low = 0
  let high = points.length - 1
  let result: OISeriesPoint | undefined
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = points[middle]!
    if (candidate.timestamp <= targetTimestamp) {
      result = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}
