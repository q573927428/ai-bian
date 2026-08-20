// ==================== 完整指标只读诊断接口 ====================

import type { IndicatorData, Timeframe } from '../../../types/strategy'
import { getStrategyManager } from '../../modules/strategy-manager'
import { getMaxOIChangePeriod } from '../../utils/strategy-indicators-normalizer'

const VALID_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']
const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440
}

/**
 * 单项指标诊断结果
 *
 * dataAgeMs 表示指标结果时间戳距请求时刻的毫秒数，values 保留指标中心的完整原始字段。
 */
interface IndicatorDiagnosticResult {
  timestamp: number
  dataAgeMs: number
  values: Record<string, any>
}

/**
 * 将查询参数解析为有边界的整数，防止诊断请求传入无效或过大的计算窗口。
 */
function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

/**
 * 将指标中心结果补充为便于排查数据新鲜度的诊断结构。
 */
function toDiagnosticResult(data: IndicatorData, requestedAt: number): IndicatorDiagnosticResult {
  return {
    timestamp: data.timestamp,
    dataAgeMs: Math.max(0, requestedAt - data.timestamp),
    values: data.values
  }
}

export default defineEventHandler(async (event) => {
  const requestedAt = Date.now()
  const query = getQuery(event)
  const symbol = String(query.symbol || '').trim().toUpperCase()
  const timeframe = String(query.timeframe || '1h') as Timeframe

  if (!symbol) {
    throw createError({ statusCode: 400, statusMessage: '缺少必需参数: symbol' })
  }
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    throw createError({ statusCode: 400, statusMessage: `无效的 timeframe: ${timeframe}` })
  }

  const manager = getStrategyManager()
  const indicatorsHub = manager.getIndicatorsHub()
  const configuredSymbols = indicatorsHub.getCacheStatus().symbols
  if (!configuredSymbols.includes(symbol)) {
    throw createError({
      statusCode: 400,
      statusMessage: `交易对未配置或指标中心尚未初始化: ${symbol}`
    })
  }

  const maxChangePeriod = getMaxOIChangePeriod(timeframe)
  const changePeriod = parseBoundedInteger(query.changePeriod, 1, 1, maxChangePeriod)
  const lookbackMinutes = TIMEFRAME_MINUTES[timeframe] * changePeriod
  const squareHeatWindowMinutes = parseBoundedInteger(query.squareHeatWindowMinutes, 1440, 5, 1440)
  const emaPeriods = String(query.emaPeriods || '14,50')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value >= 2 && value <= 500)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5)
  const effectiveEmaPeriods = emaPeriods.length > 0 ? emaPeriods : [14, 50]

  const indicators: Record<string, IndicatorDiagnosticResult> = {}
  const errors: Record<string, string> = {}

  /**
   * 单项失败只记录错误，确保仍能看到其余已正常计算的指标。
   */
  const collect = async (name: string, loader: () => Promise<IndicatorData>): Promise<void> => {
    try {
      indicators[name] = toDiagnosticResult(await loader(), requestedAt)
    } catch (error: any) {
      errors[name] = error?.message || String(error)
    }
  }

  await Promise.all([
    collect('ema', () => indicatorsHub.getEMAByPeriods(symbol, timeframe, effectiveEmaPeriods)),
    collect('rsi', () => indicatorsHub.getIndicators(symbol, timeframe, 'RSI', { rsiPeriod: 14 })),
    collect('adx', () => indicatorsHub.getIndicators(symbol, timeframe, 'ADX', { adxPeriod: 14 })),
    collect('atr', () => indicatorsHub.getIndicators(symbol, timeframe, 'ATR', { atrPeriod: 14 })),
    collect('macd', () => indicatorsHub.getIndicators(symbol, timeframe, 'MACD', {
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9
    })),
    collect('oi', () => indicatorsHub.getIndicators(symbol, timeframe, 'OI', {
      lookbackMinutes,
      trendThresholdPercent: 0.4
    })),
    collect('volume', () => indicatorsHub.getIndicators(symbol, timeframe, 'Volume')),
    collect('squareHeat', () => indicatorsHub.getIndicators(symbol, timeframe, 'SquareHeat', {
      lookbackMinutes: squareHeatWindowMinutes
    }))
  ])

  const klines = indicatorsHub.getKlines(symbol, timeframe) || []
  const latestKline = klines[klines.length - 1]
  const previousKline = klines[klines.length - 2]
  const oldestKline = klines[0]
  const oiDiagnostics = indicatorsHub.getOIDiagnostics(symbol, lookbackMinutes)
  const completedAt = Date.now()
  const availableIndicators = Object.keys(indicators)
  const failedIndicators = Object.keys(errors)
  const closeChangePercent = latestKline && previousKline && previousKline.close !== 0
    ? ((latestKline.close - previousKline.close) / previousKline.close) * 100
    : undefined
  const rangePercent = latestKline && latestKline.open !== 0
    ? ((latestKline.high - latestKline.low) / latestKline.open) * 100
    : undefined

  return {
    success: true,
    data: {
      symbol,
      timeframe,
      requestedAt,
      completedAt,
      durationMs: completedAt - requestedAt,
      status: {
        complete: failedIndicators.length === 0,
        availableIndicators,
        failedIndicators
      },
      parameters: {
        emaPeriods: effectiveEmaPeriods,
        changePeriod,
        maxChangePeriod,
        oiLookbackMinutes: lookbackMinutes,
        squareHeatWindowMinutes
      },
      kline: {
        count: klines.length,
        oldestTimestamp: oldestKline?.timestamp,
        latestTimestamp: latestKline?.timestamp,
        coverageMs: oldestKline && latestKline
          ? latestKline.timestamp - oldestKline.timestamp
          : 0,
        dataAgeMs: latestKline ? Math.max(0, requestedAt - latestKline.timestamp) : undefined,
        candleDirection: latestKline
          ? latestKline.close > latestKline.open
            ? 'bullish'
            : latestKline.close < latestKline.open
              ? 'bearish'
              : 'flat'
          : undefined,
        closeChangePercent,
        rangePercent,
        latest: latestKline,
        previous: previousKline
      },
      indicators,
      oiMemory: {
        ...oiDiagnostics,
        currentDataAgeMs: oiDiagnostics.current
          ? Math.max(0, requestedAt - oiDiagnostics.current.fetchedAt)
          : undefined,
        historyCoverageMs: oiDiagnostics.oldestHistoryTimestamp && oiDiagnostics.newestHistoryTimestamp
          ? oiDiagnostics.newestHistoryTimestamp - oiDiagnostics.oldestHistoryTimestamp
          : 0
      },
      errors
    }
  }
})
