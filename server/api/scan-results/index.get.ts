// ==================== 历史扫描结果 API ====================

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import dayjs from 'dayjs'
import type { StrategyScanResult } from '../../../types/scan-result'

const STRATEGY_BY_TIMEFRAME: Record<string, string> = {
  '5m': 'strategy_001',
  '15m': 'strategy_002',
  '1h': 'strategy_003',
  '4h': 'strategy_004'
}

const TIMEFRAME_SECONDS: Record<string, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60
}

/**
 * 读取指定交易对和周期的历史扫描日志，并映射到 K 线开盘时间。
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const symbol = normalizeSymbol(String(query.symbol || ''))
  const timeframe = String(query.timeframe || '')
  const from = Number(query.from)
  const to = Number(query.to)
  const strategyId = STRATEGY_BY_TIMEFRAME[timeframe]
  const timeframeSeconds = TIMEFRAME_SECONDS[timeframe]

  if (!symbol || !strategyId || !timeframeSeconds || !Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw createError({
      statusCode: 400,
      statusMessage: '参数无效，需要 symbol、5m/15m/1h/4h timeframe 以及有效的 from/to 时间戳'
    })
  }

  // 日志按自然日分文件，只读取 K 线范围覆盖的日期，避免扫描整个 logs 目录。
  const dates = enumerateDates(from, to)
  const results = dates.flatMap(date => readScanResultsForDate(date, {
    symbol,
    timeframe,
    strategyId,
    timeframeSeconds,
    from,
    to
  }))

  results.sort((a, b) => a.timestamp - b.timestamp)

  return {
    success: true,
    data: {
      symbol,
      timeframe,
      strategyId,
      results,
      count: results.length
    }
  }
})

/**
 * 统一 BTCUSDT 与日志中的 BTC/USDT 表示，保证按交易对精确过滤。
 */
function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * 枚举时间范围内涉及的本地自然日。
 */
function enumerateDates(from: number, to: number): string[] {
  const dates: string[] = []
  let cursor = dayjs(from * 1000).startOf('day')
  const end = dayjs(to * 1000).startOf('day')

  while (cursor.valueOf() <= end.valueOf()) {
    dates.push(cursor.format('YYYY-MM-DD'))
    cursor = cursor.add(1, 'day')
  }

  return dates
}

interface ScanFileFilter {
  symbol: string
  timeframe: string
  strategyId: string
  timeframeSeconds: number
  from: number
  to: number
}

/**
 * 解析单日日志；格式异常的行会被忽略，不影响其他有效扫描结果。
 */
function readScanResultsForDate(date: string, filter: ScanFileFilter): StrategyScanResult[] {
  const logFile = join(process.cwd(), 'logs', `${date}.log`)
  if (!existsSync(logFile)) return []

  const results: StrategyScanResult[] = []
  const lines = readFileSync(logFile, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    // 兼容旧日志 `[扫描结果]` 和当前日志 `[🔍扫描结果]` 两种标签格式。
    if (!/\[(?:🔍)?扫描结果\]/u.test(line) || !line.includes(`[${filter.strategyId}]`)) continue

    const parsed = parseScanLine(date, line, filter)
    if (parsed) results.push(parsed)
  }

  return results
}

/**
 * 将一行扫描日志拆解为可展示的结构化数据。
 */
function parseScanLine(date: string, line: string, filter: ScanFileFilter): StrategyScanResult | null {
  // 日志标签可能带有用于区分扫描事件的 🔍 前缀，前缀不影响结果解析。
  const lineMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]+)\] \[(?:🔍)?扫描结果\]\s*(.*)$/u)
  if (!lineMatch?.[1] || !lineMatch[2] || !lineMatch[3]) return null

  const timestamp = Math.floor(dayjs(`${date} ${lineMatch[1]}`).valueOf() / 1000)
  if (timestamp < filter.from || timestamp > filter.to) return null

  const strategySuffix = new RegExp(`\\s*\\[${filter.strategyId}\\]`)
  const withoutStrategy = lineMatch[3].replace(strategySuffix, '')
  const [summaryPart = '', detailPart = ''] = withoutStrategy.split(/\s*===详细AI日志===\s*/, 2)
  const symbolMatch = summaryPart.match(/^([^\s]+)\s+/)
  if (!symbolMatch?.[1] || normalizeSymbol(symbolMatch[1]) !== filter.symbol) return null

  const signalMatch = summaryPart.match(/@([\d.]+)\s+(LONG|SHORT|IDLE)/)
  const confidenceMatch = summaryPart.match(/置信度（([\d.]+)\s*(?:<|>=)\s*([\d.]+)）/)
  const scoreMatch = summaryPart.match(/评分（([\d.]+)/)
  const riskMatch = `${summaryPart} ${detailPart}`.match(/风险等级[：:]?（?([A-Z]+)\)?/)
  const klineTime = Math.floor(timestamp / filter.timeframeSeconds) * filter.timeframeSeconds

  return {
    timestamp,
    klineTime,
    strategyId: filter.strategyId,
    timeframe: filter.timeframe,
    symbol: symbolMatch[1],
    level: lineMatch[2],
    summary: summaryPart.trim(),
    detail: detailPart.trim(),
    skipped: summaryPart.includes('预筛跳过'),
    direction: (signalMatch?.[2] as StrategyScanResult['direction']) || null,
    price: signalMatch?.[1] ? Number(signalMatch[1]) : null,
    confidence: confidenceMatch?.[1] ? Number(confidenceMatch[1]) : null,
    minConfidence: confidenceMatch?.[2] ? Number(confidenceMatch[2]) : null,
    score: scoreMatch?.[1] ? Number(scoreMatch[1]) : null,
    riskLevel: riskMatch?.[1] || null
  }
}
