// ==================== 完整指标只读诊断接口 ====================

import type { IndicatorData, Timeframe } from '../../../types/strategy'
import { getStrategyManagerIfAvailable } from '../../modules/strategy-manager'
import { getMaxOIChangePeriod } from '../../utils/strategy-indicators-normalizer'
import { getSimpleKLineLastUpdatedAt } from '../../utils/kline-simple-storage'
import { getCachedSquareHeat } from '../../utils/square-heat'
import { loadEnvironmentContext } from '../../utils/environment-context'
import { getMarketBreadth } from '../../utils/market-breadth'
import { getBotConfig } from '../../utils/storage'
import { getCandleVolume } from '../../utils/candle-volume'
import { formatEnvironmentConfidence } from '../../../app/utils/environment-confidence'
import { normalizeERPeriod } from '../../../app/utils/efficiency-ratio'
import { normalizeSupportResistanceConfig } from '../../../types/support-resistance'
import { latestCvdDivergence } from '../../../app/utils/cvd-divergence'
import { normalizeSquareHeatWindows, SQUARE_HEAT_MAX_WINDOW_MINUTES } from '../../../types/square-heat-config'

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

/**
 * 将带斜杠和不带斜杠的交易对统一为比较键，兼容配置中的 BTC/USDT 与接口中的 BTCUSDT。
 */
function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('/', '')
}

export default defineEventHandler(async (event) => {
  const requestedAt = Date.now()
  const query = getQuery(event)
  const symbol = String(query.symbol || '').trim().toUpperCase()
  const timeframe = String(query.timeframe || '1h') as Timeframe
  // 看板首屏先跳过外部慢统计，等表格可见后再单独补齐。
  const includeSlowStats = String(query.includeSlowStats ?? 'true') !== 'false'
  // 五周期标记只依赖 ADX 和 MACD，跳过其他指标以减少计算和外部请求。
  const signalOnly = String(query.signalOnly ?? 'false') === 'true'
  // 看板自动更新结构时仅做本地计算，避免反复请求 OI、社区情绪等慢统计。
  const structureOnly = String(query.structureOnly ?? 'false') === 'true'

  if (!symbol) {
    throw createError({ statusCode: 400, message: '缺少必需参数: symbol' })
  }
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    throw createError({ statusCode: 400, message: `无效的 timeframe: ${timeframe}` })
  }

  const manager = getStrategyManagerIfAvailable()
  // K线首次同步尚未完成属于正常启动状态，不应抛出未处理的服务端异常。
  if (!manager) return { success: false, initializing: true, message: '行情初始化中，请稍候', data: null }
  const indicatorsHub = manager.getIndicatorsHub()
  const configuredSymbols = indicatorsHub.getCacheStatus().symbols
  // 指标中心沿用配置文件中的交易对格式，后续读取必须使用匹配到的真实缓存键。
  const indicatorSymbol = configuredSymbols.find(item => normalizeSymbol(item) === normalizeSymbol(symbol))
  if (!indicatorSymbol) {
    throw createError({
      statusCode: 400,
      message: `交易对未配置或指标中心尚未初始化: ${symbol}`
    })
  }

  const maxChangePeriod = getMaxOIChangePeriod(timeframe)
  const changePeriod = parseBoundedInteger(query.changePeriod, 1, 1, maxChangePeriod)
  const lookbackMinutes = TIMEFRAME_MINUTES[timeframe] * changePeriod
  const emaPeriods = String(query.emaPeriods || '14,50')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value >= 2 && value <= 500)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5)
  const effectiveEmaPeriods = emaPeriods.length > 0 ? emaPeriods : [14, 50]
  const erPeriod = normalizeERPeriod(query.erPeriod)
  const botConfig = await getBotConfig()
  // 看板窗口按当前 K 线周期读取；显式诊断参数仍可覆盖，但不影响策略配置。
  const squareHeatWindowMinutes = parseBoundedInteger(query.squareHeatWindowMinutes,
    normalizeSquareHeatWindows(botConfig.squareHeatWindows)[timeframe], 5, SQUARE_HEAT_MAX_WINDOW_MINUTES)
  const structureDefaults = normalizeSupportResistanceConfig(botConfig.supportResistanceConfig)
  // 参数参与指标中心的缓存键，页面试算不会覆盖策略或默认区域缓存。
  const structureParams = {
    pivotLeft: parseBoundedInteger(query.pivotLeft, structureDefaults.pivotLeft, 1, 10),
    pivotRight: parseBoundedInteger(query.pivotRight, structureDefaults.pivotRight, 1, 10)
  }

  const indicators: Record<string, IndicatorDiagnosticResult> = {}
  const errors: Record<string, string> = {}
  // 复用策略分析的服务端评分口径；方向标记请求无需重复计算五周期环境。
  // 环境计算失败仅清空评分，不影响其他指标展示。
  const environmentContext = !signalOnly
    ? await Promise.resolve().then(async () => getMarketBreadth(botConfig, false, indicatorsHub))
      .then(breadth => loadEnvironmentContext(indicatorsHub, indicatorSymbol, breadth, timeframe))
      .catch(() => undefined)
    : undefined

  /**
   * 单项失败只记录错误，确保仍能看到其余已正常计算的指标。
   */
  const collect = async (name: string, loader: () => Promise<IndicatorData>): Promise<void> => {
    if (structureOnly && name !== 'supportResistance') return
    if (signalOnly && name !== 'adx' && name !== 'macd') return
    try {
      indicators[name] = toDiagnosticResult(await loader(), requestedAt)
    } catch (error: any) {
      errors[name] = error?.message || String(error)
    }
  }

  await Promise.all([
    collect('ema', () => indicatorsHub.getEMAByPeriods(indicatorSymbol, timeframe, effectiveEmaPeriods)),
    collect('rsi', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'RSI', { rsiPeriod: 14 })),
    collect('adx', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'ADX', { adxPeriod: 14 })),
    collect('atr', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'ATR', { atrPeriod: 14 })),
    collect('er', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'ER', { erPeriod, snapshotTimestamp: requestedAt })),
    collect('macd', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'MACD', {
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9
    })),
    ...(includeSlowStats ? [collect('oi', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'OI', {
      lookbackMinutes,
      trendThresholdPercent: 0.4
    }))] : []),
    collect('moneyFlow', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'MoneyFlow')),
    collect('volume', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'Volume')),
    collect('supportResistance', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'SupportResistance', structureParams)),
    ...(includeSlowStats ? [collect('squareHeat', () => indicatorsHub.getIndicators(indicatorSymbol, timeframe, 'SquareHeat', {
      lookbackMinutes: squareHeatWindowMinutes
    }))] : [])
  ])

  // 首屏跳过外部慢请求，但仍展示同一统计窗口的有效情绪缓存。
  // 五周期方向请求不依赖情绪；无缓存时留给后台补齐，避免阻塞技术指标。
  if (!includeSlowStats && !signalOnly && !structureOnly) {
    const cachedHeat = getCachedSquareHeat(indicatorSymbol, squareHeatWindowMinutes)
    if (cachedHeat) {
      indicators.squareHeat = toDiagnosticResult({
        symbol: indicatorSymbol,
        timeframe,
        timestamp: cachedHeat.lastUpdated,
        values: { ...cachedHeat, dataUpdatedAt: cachedHeat.lastUpdated }
      }, requestedAt)
    }
  }

  const klines = indicatorsHub.getKlines(indicatorSymbol, timeframe) || []
  const latestKline = klines[klines.length - 1]
  const previousKline = klines[klines.length - 2]
  const oldestKline = klines[0]
  const oiDiagnostics = indicatorsHub.getOIDiagnostics(indicatorSymbol, lookbackMinutes)
  const completedAt = Date.now()
  // 使用本地 K 线最近写入时间，而不是 K 线开盘时间；未收盘的 4H K 线也会被高频更新。
  const lastUpdatedAt = getSimpleKLineLastUpdatedAt(indicatorSymbol, timeframe)
  const availableIndicators = Object.keys(indicators)
  const failedIndicators = Object.keys(errors)
  const closeChangePercent = latestKline && previousKline && previousKline.close !== 0
    ? ((latestKline.close - previousKline.close) / previousKline.close) * 100
    : undefined
  // K线时间戳是开盘时间，进度按当前请求时刻计算并限制在 0-100% 内。
  const candleProgressPercent = latestKline
    ? Math.min(100, Math.max(0, (requestedAt - latestKline.timestamp) / (TIMEFRAME_MINUTES[timeframe] * 60 * 1000) * 100))
    : undefined
  // 看板预量比复用交易与 AI 的整根预估公式，原始 ratio 仍保留累计量口径。
  if (indicators.volume && candleProgressPercent != null) {
    const volume = indicators.volume.values
    const { estimatedVolume } = getCandleVolume({ volumeCurrent: volume.current }, volume.current, candleProgressPercent / 100)
    const estimatedRatio = Number.isFinite(estimatedVolume) && volume.emaAverage > 0
      ? estimatedVolume / volume.emaAverage
      : undefined
    // 请求进度只属于本次响应，不能回写指标中心的共享缓存。
    indicators.volume.values = { ...volume, estimatedRatio }
  }
  const rangePercent = latestKline && latestKline.open !== 0
    ? ((latestKline.high - latestKline.low) / latestKline.open) * 100
    : undefined

  return {
    success: true,
    data: {
      symbol,
      timeframe,
      requestedAt,
      environmentContext,
      environmentDescription: formatEnvironmentConfidence(environmentContext),
      completedAt,
      durationMs: completedAt - requestedAt,
      // 复用本地行情缓存和图表规则，轮询时同步更新，方向标记请求无需重复检测。
      latestDivergence: signalOnly ? undefined : latestCvdDivergence(klines.map(bar => ({
        t: bar.timestamp / 1000, o: bar.open, h: bar.high, l: bar.low, c: bar.close,
        v: bar.volume, q: bar.quoteVolume, bq: bar.takerBuyQuoteVolume
      })), TIMEFRAME_MINUTES[timeframe] * 60, requestedAt / 1000),
      status: {
        complete: failedIndicators.length === 0,
        availableIndicators,
        failedIndicators
      },
      parameters: {
        emaPeriods: effectiveEmaPeriods,
        erPeriod,
        ...structureParams,
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
        dataAgeMs: lastUpdatedAt
          ? Math.max(0, requestedAt - lastUpdatedAt)
          : latestKline
            ? Math.max(0, requestedAt - latestKline.timestamp)
            : undefined,
        lastUpdatedAt,
        candleDirection: latestKline
          ? latestKline.close > latestKline.open
            ? 'bullish'
            : latestKline.close < latestKline.open
              ? 'bearish'
              : 'flat'
          : undefined,
        candleProgressPercent,
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
