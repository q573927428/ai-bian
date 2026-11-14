// ==================== 趋势页固定样本市场上涨广度计算 ====================
import type { MarketBreadth } from '../../types/crypto-trends'
import { beijingDate } from './beijing-time.ts'

/** 输入为本地日线开盘时间（秒）及收盘价，由调用方排除非加密资产和指数。 */
export interface BreadthRow { symbol: string; t: number; c: number }

/**
 * 固定所选区间内具有完整日线及60日预热的样本，两个均线共用分母。
 * 历史日线固定样本；当天使用盘中收盘价估算，缺少任何样本当天行情则暂不生成当天值。
 */
export function calculateMarketBreadth(rows: BreadthRow[], days: number, now = Date.now()): MarketBreadth {
  const result: MarketBreadth = { ma20: [], ma60: [], sampleCount: 0, symbols: [], days }
  const today = Math.floor(now / 86400000) * 86400
  // 可视日历跟随北京时间；行情柱仍与首页相同，采用币安原始日线起点。
  const start = Date.parse(beijingDate(now)) / 1000 - (days - 1) * 86400
  const warmup = start - 59 * 86400
  const grouped = new Map<string, Map<number, number>>()
  let end = 0
  for (const row of rows) {
    if (row.t < warmup || row.t > today || row.t % 86400 || !Number.isFinite(row.c) || row.c <= 0) continue
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, new Map())
    grouped.get(row.symbol)!.set(row.t, row.c)
    end = Math.max(end, row.t)
  }
  if (end < start) return result
  // 用已结束的日期选样，避免部分币种盘中数据晚到导致历史分母改变。
  const historyEnd = Math.min(end, today - 86400)
  const times = Array.from({ length: (historyEnd - warmup) / 86400 + 1 }, (_, i) => warmup + i * 86400)
  const samples = [...grouped].filter(([, prices]) => times.every(t => prices.has(t)))
  result.symbols = samples.map(([symbol]) => symbol).sort()
  result.sampleCount = samples.length
  if (!samples.length) return result
  if (end === today && samples.every(([, prices]) => prices.has(today))) times.push(today)
  const above20 = Array(times.length).fill(0), above60 = Array(times.length).fill(0)
  for (const [, prices] of samples) {
    const values = times.map(t => prices.get(t)!)
    let sum20 = 0, sum60 = 0
    for (let i = 0; i < values.length; i++) {
      sum20 += values[i]!
      sum60 += values[i]!
      if (i >= 20) sum20 -= values[i - 20]!
      if (i >= 60) sum60 -= values[i - 60]!
      if (i >= 59) {
        if (values[i]! > sum20 / 20) above20[i]++
        if (values[i]! > sum60 / 60) above60[i]++
      }
    }
  }
  for (let i = 59; i < times.length; i++) {
    const date = beijingDate(times[i]! * 1000)
    const provisional = times[i] === today ? { provisional: true } : {}
    result.ma20.push({ date, value: above20[i] / samples.length * 100, ...provisional })
    result.ma60.push({ date, value: above60[i] / samples.length * 100, ...provisional })
  }
  return result
}
