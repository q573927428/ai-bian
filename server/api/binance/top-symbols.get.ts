// ==================== 热门、持续放量及已配置交易对 API ====================
//
// 查询参数：
//   mode=hot（默认）：展示全部在交易的 USDT 永续合约，按 24h 成交额排序
//   mode=configured：展示配置文件中的全部交易对，不限制数量和上线时长
//   mode=stable：按"最近 N 天持续稳定放量"筛选（排除短期热点）
//     附加参数：days / minDataRatio / pool / top / minDaily / activeDaysRatio / minRatio / cvMax / segmentRatio
//
// 持续放量判定：
//   1. 24h 成交额前 pool 名作为候选池
//   2. 拉最近 days 天日线，用 close × volume 折算每日成交额
//   3. avgDaily ≥ minDaily；最低/最高比 ≥ minRatio；CV ≤ cvMax；分段稳定性达标
//   4. 按 score = avgDaily × (1 - min(CV, 1)) 降序取 top

import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { getBotConfig } from '../../utils/storage'
import { getBinanceExchangeInfo } from '../../utils/binance-exchange-info'
import { getSimpleKLineData, getSimpleKLineLastUpdatedAt, initKLineDb } from '../../utils/kline-simple-storage'
import type { MarketOverviewSymbol } from '../../../types/market-overview'

/** 榜单行情及持续放量统计，涨跌幅均以百分数返回。 */
interface TopSymbol extends MarketOverviewSymbol {
  symbol: string
  volume: number          // 24h 成交额 (USDT)
  price: number           // 当前价格
  priceChangePercent: number // 24小时涨跌幅 (%)
  priceChangePercent1h?: number
  priceChangePercent4h?: number
  priceChangePercentDays?: number
  fundingRate: number     // 资金费率 (%)
  klineCount4h: number    // 4H K线可用根数
  onboardDate: number     // 上线时间戳 (ms)
  // 持续放量筛选模式下的附加字段
  avgDailyVolume?: number  // 窗口期日均成交额 (USDT)
  volumeCv?: number        // 变异系数（越小越稳定）
  minMaxRatio?: number     // 最低/最高日成交额比
  activeDays?: string      // 达到成交额下限的天数 / 实际日线根数，如 "30/30"
  contractType?: string    // 合约类型（PERPETUAL / TRADIFI_PERPETUAL）
  score?: number           // 综合得分 = avgDaily × (1 - min(CV, 1))
}

/** 持续放量筛选参数（与脚本 scripts/find-stable-volume-symbols.mjs 保持一致） */
interface StableFilterOptions {
  days: number      // 统计窗口天数
  minDataRatio: number // 最低日线根数占统计窗口的比例（0–1）
  pool: number      // 候选池数量（24h 成交额前 N 名）
  top: number       // 最终输出数量
  minDaily: number  // 日均成交额及单日活跃判定下限 (USDT)
  activeDaysRatio: number // 窗口内达到单日成交额下限的最低天数比例（0–1）
  minRatio: number  // 最低/最高成交额比阈值
  cvMax: number     // 最大变异系数
  segmentRatio: number // 分段稳定性阈值
}

/** 持续放量筛选参数默认值 */
const FILTER_DEFAULTS: StableFilterOptions = {
  days: 30,
  minDataRatio: 0.6,
  pool: 200,
  top: 100,
  minDaily: 10_000_000,
  activeDaysRatio: 0.6,
  minRatio: 0.02,
  cvMax: 1.0,
  segmentRatio: 0.2,
}

/** 4H K线的毫秒数 */
const KLINE_4H_MS = 4 * 60 * 60 * 1000
/** 24h 热门、持续放量榜单及日线共用的缓存时长（30 分钟） */
const TOP_SYMBOLS_CACHE_TTL = 30 * 60 * 1000
// 按参数缓存榜单，按交易对和统计窗口缓存日线。
const stableCache = new Map<string, { data: TopSymbol[]; timestamp: number }>()
const stableRequests = new Map<string, Promise<TopSymbol[]>>()
/** 同参数计算任务的真实进度；完成计数包含分析失败的候选，避免进度停滞。 */
interface StableProgress {
  stage: 'preparing' | 'analyzing' | 'funding' | 'completed' | 'failed'
  completed: number
  total: number
}
const stableProgress = new Map<string, StableProgress>()
/** 同一份日线同时提供成交额与窗口起始价格，避免为天数涨跌幅重复请求。 */
interface DailyWindow {
  volumes: number[]
  open?: number
}
const dailyVolumeCache = new Map<string, { data: DailyWindow; timestamp: number }>()
const dailyVolumeRequests = new Map<string, Promise<DailyWindow>>()
// 24h 热门结果缓存（无参数依赖）
let hotCache: { data: TopSymbol[]; hotSymbols: Set<string>; timestamp: number } | null = null
let hotRequest: ReturnType<typeof fallbackHotMode> | null = null

/** 解析查询参数为数字，非法时回退默认值 */
function parseNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 仅保留交易所提供的有效数值，避免把缺失字段转换成零。 */
function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

/** 复用已获取的 24h 行情，为侧栏提供价格区间和成交活跃度。 */
function tickerDetails(ticker: any) {
  return {
    high24h: optionalNumber(ticker.highPrice), low24h: optionalNumber(ticker.lowPrice),
    open24h: optionalNumber(ticker.openPrice), tradeCount24h: optionalNumber(ticker.count),
  }
}

/** 资金费接口同时包含标记价、指数价和下次结算时间，无需增加外部请求。 */
function premiumDetails(premium: any) {
  return {
    markPrice: optionalNumber(premium?.markPrice), indexPrice: optionalNumber(premium?.indexPrice),
    nextFundingTime: optionalNumber(premium?.nextFundingTime),
  }
}

/** 统计工具：平均值 */
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

/** 统计工具：标准差 */
function stddev(arr: number[]): number {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

/** 仅复用新鲜且覆盖完整 UTC 日线窗口的本地数据，缺失、断档或陈旧时回退币安。 */
function getLocalDailyWindow(symbol: string, days: number): { data: DailyWindow; timestamp: number } | undefined {
  const now = Date.now()
  const updatedAt = getSimpleKLineLastUpdatedAt(symbol, '1d')
  if (!updatedAt || updatedAt > now || now - updatedAt >= TOP_SYMBOLS_CACHE_TTL) return
  const today = Math.floor(now / 86400000) * 86400
  // 跨 UTC 零点后必须等新日线同步，不能把昨天的末根当成今天的数据。
  if (updatedAt < today * 1000) return
  try {
    const from = today - (days - 1) * 86400
    const candles = getSimpleKLineData(symbol, '1d', { from, to: today, limit: days })
    if (candles.length !== days || candles.some((candle, index) =>
      candle.t !== from + index * 86400 || !Number.isFinite(candle.c) || candle.c <= 0 ||
      !Number.isFinite(candle.v) || candle.v < 0
    )) return
    const open = candles[0]?.o
    if (typeof open !== 'number' || !Number.isFinite(open) || open <= 0) return
    return {
      data: { volumes: candles.map(candle => candle.c * candle.v), open },
      // 沿用原始同步时间，不能因读取缓存延长当前未收盘日线的新鲜期。
      timestamp: updatedAt,
    }
  } catch {
    // 本地数据库不可用时仍可正常执行远端筛选。
  }
}

/**
 * 拉取单个交易对最近 days 天日线，折算为每日成交额序列（USDT）。
 * klines 每根形如 [openTime, open, high, low, close, volume, ...]
 */
async function fetchDailyVolumes(symbol: string, days: number): Promise<DailyWindow> {
  const key = `${symbol}:${days}`
  const cached = dailyVolumeCache.get(key)
  if (cached && Date.now() - cached.timestamp < TOP_SYMBOLS_CACHE_TTL) return cached.data

  const pending = dailyVolumeRequests.get(key)
  if (pending) return pending

  const local = getLocalDailyWindow(symbol, days)
  if (local) {
    if (dailyVolumeCache.size >= 1000) {
      const oldestKey = dailyVolumeCache.keys().next().value
      if (oldestKey) dailyVolumeCache.delete(oldestKey)
    }
    dailyVolumeCache.set(key, local)
    return local.data
  }

  const request = binanceApiGateway.fetchJson<any[]>(
    'marketData',
    `stableKlines:${symbol}:1d:${days}`,
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${days}`
  ).then(data => {
    const volumes = data.map(k => parseFloat(k[4]) * parseFloat(k[5]))
    if (dailyVolumeCache.size >= 1000) {
      const oldestKey = dailyVolumeCache.keys().next().value
      if (oldestKey) dailyVolumeCache.delete(oldestKey)
    }
    const open = Number(data[0]?.[1])
    const window: DailyWindow = { volumes, open: data.length >= days && Number.isFinite(open) && open > 0 ? open : undefined }
    dailyVolumeCache.set(key, { data: window, timestamp: Date.now() })
    return window
  }).finally(() => dailyVolumeRequests.delete(key))
  dailyVolumeRequests.set(key, request)
  return request
}

/**
 * 分析单个交易对的"持续放量"指标。
 *
 * 核心逻辑：
 * 1. 数据根数校验：klines 返回根数不足 days×minDataRatio 视为上市时间过短，标记无效。
 * 2. 基础统计：avgDaily / cv / minRatio / activeDays。
 * 3. 分段稳定性：时间三等分，每段平均成交额须 ≥ 全期均值的 segmentRatio 倍，
 *    从根源上排除"某段时期没量、突然几天爆发"的短期热点。
 */
function analyzeSymbol(
  symbol: string,
  dailyVolumes: number[],
  days: number,
  segmentRatio: number,
  contractType: string,
  activeVolumeThreshold: number,
  minDataRatio: number
): { valid: boolean; reason?: string; analysis?: any } {
  const valid = dailyVolumes.filter(v => v > 0)
  const total = dailyVolumes.length

  // 按用户设置判断数据覆盖程度，向上取整以确保达到最低比例。
  if (total < Math.ceil(days * minDataRatio)) {
    return { valid: false, reason: '上市时间不足，数据根数不够' }
  }

  // 即使覆盖比例设为 0，也必须有有效成交数据才能计算统计指标。
  if (valid.length === 0) {
    return { valid: false, reason: '无有效成交数据' }
  }

  const avgDaily = mean(valid)
  const maxDaily = Math.max(...valid)
  const minDaily = Math.min(...valid)
  const cv = avgDaily > 0 ? stddev(valid) / avgDaily : Infinity
  const totalVolume = valid.reduce((s, v) => s + v, 0)
  const minRatio = maxDaily > 0 ? minDaily / maxDaily : 0

  // 分段稳定性检查：时间三等分，每段平均成交额须 ≥ 全期均值的 segmentRatio 倍
  const segmentCount = 3
  const segLen = Math.floor(valid.length / segmentCount)
  let segmentOk = true
  if (segLen >= 2) {
    for (let i = 0; i < segmentCount; i++) {
      const segSlice = valid.slice(i * segLen, i === segmentCount - 1 ? valid.length : (i + 1) * segLen)
      if (segSlice.length === 0) continue
      if (mean(segSlice) < avgDaily * segmentRatio) {
        segmentOk = false
      }
    }
  }

  return {
    valid: true,
    analysis: {
      symbol,
      avgDaily,
      minDaily,
      maxDaily,
      minRatio,
      cv,
      totalVolume,
      // 活跃必须达到用户设置的成交额门槛，避免微量成交也被计为持续放量。
      activeDays: dailyVolumes.filter(v => v > 0 && v >= activeVolumeThreshold).length,
      totalDays: total,
      segmentOk,
      contractType,
    },
  }
}

/**
 * 通用简单并发池：限制同时执行的任务数（应用层兜底，实际请求仍走 binance 限流队列）。
 */
async function runPool<T>(items: any[], limit: number, worker: (item: any, index: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(items.length)
  let cursor = 0

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await worker(items[index], index)
      } catch (error: any) {
        results[index] = { symbol: items[index]?.symbol, error: error.message } as T
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner())
  await Promise.all(workers)
  return results
}

/** 只读取本地历史价格：优先使用 5m K线，缺失时使用 1h K线，不触发补数或外部请求。 */
function getLocalPeriodChanges(symbol: string, price: number, referenceTime: number): Pick<TopSymbol, 'priceChangePercent1h' | 'priceChangePercent4h'> {
  const change = (hours: number): number | undefined => {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(referenceTime)) return undefined
    try {
      for (const [timeframe, seconds] of [['5m', 300], ['1h', 3600]] as const) {
        // 本地时间戳单位为秒；精确匹配目标周期，避免用陈旧或缺口附近的 K线冒充历史价格。
        const timestamp = Math.floor((referenceTime / 1000 - hours * 3600) / seconds) * seconds
        const candle = getSimpleKLineData(symbol, timeframe, { from: timestamp, to: timestamp, limit: 1 })[0]
        if (candle && Number.isFinite(candle.o) && candle.o > 0) return (price / candle.o - 1) * 100
      }
    } catch {
      // 本地数据库不可用时仍返回榜单，附加涨跌幅留空。
    }
    return undefined
  }
  return { priceChangePercent1h: change(1), priceChangePercent4h: change(4) }
}

/** 热门榜固定 30 天涨跌幅，只使用本地历史；按 1h、4h、日线依次尝试。 */
function getLocal30DayChange(symbol: string, price: number, referenceTime: number): number | undefined {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(referenceTime)) return undefined
  try {
    for (const [timeframe, seconds] of [['1h', 3600], ['4h', 14400], ['1d', 86400]] as const) {
      // 不同周期保留的历史长度不同；只匹配 30 天前所在 K线，缺失时不使用更早或更新的价格替代。
      const timestamp = Math.floor((referenceTime / 1000 - 30 * 86400) / seconds) * seconds
      const candle = getSimpleKLineData(symbol, timeframe, { from: timestamp, to: timestamp, limit: 1 })[0]
      if (candle && Number.isFinite(candle.o) && candle.o > 0) return (price / candle.o - 1) * 100
    }
  } catch {
    // 附加行情读取失败不影响热门榜返回，也不触发币安补数。
  }
  return undefined
}

/**
 * 执行"持续放量"筛选模式。
 */
async function fetchStableTopSymbols(options: StableFilterOptions, progress: StableProgress): Promise<TopSymbol[]> {
  // 元数据与行情互不依赖；使用热门榜相同的网关键，合并同时发生的全市场请求。
  const [exchangeInfo, tickers] = await Promise.all([
    getBinanceExchangeInfo().catch(() => ({ symbols: [] })),
    binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'ticker24hr:all',
      'https://fapi.binance.com/fapi/v1/ticker/24hr'
    ),
    initKLineDb().catch(() => {}),
  ])
  // 1. 获取全市场合约信息（含上线时间与合约类型）
  let onboardMap = new Map<string, { onboardDate: number; contractType: string; underlyingType?: string; underlyingSubType?: string[] }>()
  try {
    for (const s of (exchangeInfo.symbols || [])) {
      if (
        (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') &&
        s.symbol.endsWith('USDT') &&
        !s.symbol.endsWith('USDCUSDT') &&
        s.status === 'TRADING'
      ) {
        onboardMap.set(s.symbol, {
          onboardDate: s.onboardDate ? Number(s.onboardDate) : 0,
          contractType: s.contractType,
          underlyingType: s.underlyingType,
          underlyingSubType: s.underlyingSubType,
        })
      }
    }
  } catch {
    // 忽略 exchangeInfo 错误，后续不进行上线时间过滤
  }

  // 2. 24hr Ticker 全量，按成交额取候选池
  const candidatePool = tickers
    .filter((t: any) => onboardMap.has(t.symbol))
    .map((t: any) => ({
      symbol: t.symbol,
      ...tickerDetails(t),
      quoteVolume: parseFloat(t.quoteVolume || '0'),
      lastPrice: parseFloat(t.lastPrice || '0'),
      priceChangePercent: parseFloat(t.priceChangePercent || '0'),
      referenceTime: Number(t.closeTime) || Date.now(),
      contractType: onboardMap.get(t.symbol)?.contractType || 'PERPETUAL',
      underlyingType: onboardMap.get(t.symbol)?.underlyingType,
      underlyingSubType: onboardMap.get(t.symbol)?.underlyingSubType,
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, options.pool)

  // 3. 并行拉取每个候选的日线并分析稳定性（限流器自动排队，应用层限制并发 5）
  progress.stage = 'analyzing'
  progress.total = candidatePool.length
  const analysisResults = await runPool(candidatePool, 5, async (ticker) => {
    try {
      const dailyWindow = await fetchDailyVolumes(ticker.symbol, options.days)
      const dailyVolumes = dailyWindow.volumes
      const result = analyzeSymbol(ticker.symbol, dailyVolumes, options.days, options.segmentRatio, ticker.contractType, options.minDaily, options.minDataRatio)
      if (!result.valid) {
        return { symbol: ticker.symbol, error: result.reason || 'invalid' }
      }
      return { ...ticker, ...result.analysis, windowOpen: dailyWindow.open }
    } finally {
      // 无论通过筛选、历史不足或请求失败，该候选都已处理完毕。
      progress.completed++
    }
  })

  // 4. 过滤 + 排序 + 取前 top
  const valid = analysisResults.filter((r: any) => r && !r.error && r.avgDaily !== undefined && r.avgDaily !== null)
  const qualified = valid
    .filter((r: any) => r.avgDaily >= options.minDaily)
    // 按完整统计窗口计算最低活跃天数，向上取整以确保达到用户设置的比例。
    .filter((r: any) => r.activeDays >= Math.ceil(options.days * options.activeDaysRatio))
    .filter((r: any) => r.minRatio >= options.minRatio)
    .filter((r: any) => r.cv <= options.cvMax)
    .filter((r: any) => r.segmentOk) // 三段区间均有持续放量
    .map((r: any) => ({
      ...r,
      score: r.avgDaily * (1 - Math.min(r.cv, 1)),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, options.top)

  // 5. 组装最终结果（补资金费率）
  progress.stage = 'funding'
  let fundingMap = new Map<string, number>()
  const premiums = new Map<string, any>()
  try {
    const allPremium: any[] = await binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'premiumIndex:all',
      'https://fapi.binance.com/fapi/v1/premiumIndex'
    )
    for (const item of allPremium) {
      premiums.set(item.symbol, item)
      fundingMap.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100)
    }
  } catch {
    // 忽略全量资金费率错误
  }

  // 初始化仅访问本地 SQLite；失败时让附加行情降级为空，不影响榜单。
  await initKLineDb().catch(() => {})
  return qualified.map((item: any) => ({
    symbol: item.symbol,
    high24h: item.high24h, low24h: item.low24h, open24h: item.open24h, tradeCount24h: item.tradeCount24h,
    ...premiumDetails(premiums.get(item.symbol)),
    volume: item.quoteVolume,
    price: item.lastPrice,
    priceChangePercent: item.priceChangePercent,
    ...getLocalPeriodChanges(item.symbol, item.lastPrice, item.referenceTime),
    // days 列采用已拉取日线窗口的首根开盘价；不足完整窗口时不展示。
    priceChangePercentDays: item.windowOpen && Number.isFinite(item.lastPrice) && item.lastPrice > 0
      ? (item.lastPrice / item.windowOpen - 1) * 100 : undefined,
    fundingRate: fundingMap.get(item.symbol) || 0,
    klineCount4h: 0,
    onboardDate: onboardMap.get(item.symbol)?.onboardDate || 0,
    avgDailyVolume: Math.round(item.avgDaily),
    volumeCv: Number(item.cv.toFixed(4)),
    minMaxRatio: Number(item.minRatio.toFixed(4)),
    activeDays: `${item.activeDays}/${item.totalDays}`,
    contractType: item.contractType,
    underlyingType: item.underlyingType,
    underlyingSubType: item.underlyingSubType,
    score: Number(item.score.toFixed(2)),
  }))
}

/** 同参数只计算一次；过期榜单可以在后台刷新期间继续提供结果。 */
function refreshStableTopSymbols(key: string, options: StableFilterOptions): Promise<TopSymbol[]> {
  const pending = stableRequests.get(key)
  if (pending) return pending

  // 仅回收已结束的任务，活跃计算的进度必须对所有复用请求可见。
  for (const [progressKey, value] of stableProgress) {
    if (stableProgress.size < 20) break
    if (value.stage === 'completed' || value.stage === 'failed') stableProgress.delete(progressKey)
  }
  const progress: StableProgress = { stage: 'preparing', completed: 0, total: 0 }
  stableProgress.set(key, progress)
  const request = fetchStableTopSymbols(options, progress).then(data => {
    if (stableCache.size >= 20 && !stableCache.has(key)) {
      const oldestKey = stableCache.keys().next().value
      if (oldestKey) stableCache.delete(oldestKey)
    }
    stableCache.set(key, { data, timestamp: Date.now() })
    progress.stage = 'completed'
    return data
  }).catch(error => {
    progress.stage = 'failed'
    throw error
  }).finally(() => stableRequests.delete(key))
  stableRequests.set(key, request)
  return request
}

/** 缓存未命中时复用同一轮热门榜计算，失败后允许下一次请求重试。 */
function getMarketTopSymbols(): ReturnType<typeof fallbackHotMode> {
  if (hotCache && Date.now() - hotCache.timestamp < TOP_SYMBOLS_CACHE_TTL) {
    return Promise.resolve({ success: true, data: hotCache.data, hotSymbols: hotCache.hotSymbols })
  }
  if (hotRequest) return hotRequest

  hotRequest = fallbackHotMode().then(result => {
    if (result.success) hotCache = { data: result.data, hotSymbols: result.hotSymbols, timestamp: Date.now() }
    return result
  }).finally(() => { hotRequest = null })
  return hotRequest
}

/** 热门和配置列表共享全市场快照；配置实时读取，切换标签不重复请求币安。 */
async function getHotTopSymbols(configuredOnly = false): Promise<{ success: boolean; data: TopSymbol[] }> {
  const botConfig = configuredOnly ? await getBotConfig() : undefined
  const configuredSymbols = [...new Set((botConfig?.symbols || [])
    .map(symbol => symbol.trim().replace(/\//g, '').toUpperCase()).filter(Boolean))]
  if (configuredOnly && configuredSymbols.length === 0) return { success: true, data: [] }

  const snapshot = await getMarketTopSymbols()
  if (!configuredOnly) {
    return { success: snapshot.success, data: snapshot.data.filter(item => snapshot.hotSymbols.has(item.symbol)) }
  }
  const bySymbol = new Map(snapshot.data.map(item => [item.symbol, item]))
  // 缺失行情的配置也保留一行，不能因行情缓存或合约状态把配置项隐藏。
  const data = configuredSymbols.map(symbol => bySymbol.get(symbol) || {
    symbol, volume: 0, price: NaN, priceChangePercent: NaN,
    fundingRate: 0, klineCount4h: 0, onboardDate: 0,
  }).sort((a, b) => b.volume - a.volume)
  return { success: snapshot.success, data }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  // 每次读取当前配置，避免热门榜缓存或筛选条件遗漏已配置交易对。
  if (query.mode === 'configured') {
    return { ...await getHotTopSymbols(true), mode: 'configured' }
  }
  const mode = query.mode === 'stable' ? 'stable' : 'hot'

  // ============ 持续放量模式 ============
  if (mode === 'stable') {
    const options: StableFilterOptions = {
      days: Math.max(5, Math.min(90, parseNumber(query.days, FILTER_DEFAULTS.days))),
      minDataRatio: Math.max(0, Math.min(1, parseNumber(query.minDataRatio, FILTER_DEFAULTS.minDataRatio))),
      pool: Math.max(30, Math.min(500, parseNumber(query.pool, FILTER_DEFAULTS.pool))),
      top: Math.max(5, Math.min(100, parseNumber(query.top, FILTER_DEFAULTS.top))),
      minDaily: parseNumber(query.minDaily, FILTER_DEFAULTS.minDaily),
      activeDaysRatio: Math.max(0, Math.min(1, parseNumber(query.activeDaysRatio, FILTER_DEFAULTS.activeDaysRatio))),
      minRatio: parseNumber(query.minRatio, FILTER_DEFAULTS.minRatio),
      cvMax: parseNumber(query.cvMax, FILTER_DEFAULTS.cvMax),
      segmentRatio: parseNumber(query.segmentRatio, FILTER_DEFAULTS.segmentRatio),
    }

    // 过期时先返回上次结果，后台合并同参数刷新；冷缓存才等待完整计算。
    const cacheKey = JSON.stringify(options)
    // 进度查询只读取内存，不启动计算、不调用币安，避免轮询增加外部请求。
    if (query.progress === '1') {
      const progress = stableProgress.get(cacheKey)
      return { success: true, progress: progress ? { ...progress } : null }
    }
    const cached = stableCache.get(cacheKey)
    if (cached) {
      const stale = Date.now() - cached.timestamp >= TOP_SYMBOLS_CACHE_TTL
      // 页面已展示旧结果时，允许等待同一轮刷新，避免反复读到旧缓存。
      if (stale && query.awaitFresh === '1') {
        try {
          const data = await refreshStableTopSymbols(cacheKey, options)
          return { success: true, mode, params: options, data, updatedAt: stableCache.get(cacheKey)?.timestamp, stale: false }
        } catch {
          return { success: false, mode, data: cached.data, message: '放量数据更新失败，已保留上次结果，请重试' }
        }
      }
      if (stale) {
        void refreshStableTopSymbols(cacheKey, options).catch(error => {
          console.error('后台刷新持续放量榜单失败:', error)
        })
      }
      return { success: true, mode, params: options, data: cached.data, updatedAt: cached.timestamp, stale }
    }

    try {
      const data = await refreshStableTopSymbols(cacheKey, options)
      return { success: true, mode, params: options, data, updatedAt: stableCache.get(cacheKey)?.timestamp }
    } catch (error: any) {
      // 持续放量模式请求失败时，降级返回普通模式结果
      const { success, data } = await getHotTopSymbols()
      return { success, mode: 'hot-fallback', params: options, data, message: `持续放量筛选失败，已降级为 24h 热门: ${error.message}` }
    }
  }

  // ============ 24h 热门模式（原有逻辑） ============
  // 命中缓存直接返回，避免每次打开弹窗都消耗 Binance 权重（ticker 40 + premium 10）
  const hotResult = await getHotTopSymbols()
  return { ...hotResult, mode }
})

/**
 * 全量 24h 热门行情：包含新上线合约，历史不足的周期涨跌幅留空。
 * 缓存完整市场行情，热门榜与配置列表在返回时分别筛选。
 */
async function fallbackHotMode() {
  // 1. 获取所有合约的 exchangeInfo（含上线时间和合约类型）
  const onboardMap = new Map<string, { onboardDate: number; contractType: string; underlyingType?: string; underlyingSubType?: string[] }>()
  const hotSymbols = new Set<string>()
  try {
    const exchangeInfo = await getBinanceExchangeInfo()
    for (const s of (exchangeInfo.symbols || [])) {
      // PERPETUAL = 普通永续合约, TRADIFI_PERPETUAL = TradFi 永续合约（如 SNDKUSDT）
      if ((s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.symbol.endsWith('USDT') && !s.symbol.endsWith('USDCUSDT')) {
        if (s.status === 'TRADING') hotSymbols.add(s.symbol)
        const onboardDate = s.onboardDate ? Number(s.onboardDate) : 0
        onboardMap.set(s.symbol, { onboardDate, contractType: s.contractType,
          underlyingType: s.underlyingType, underlyingSubType: s.underlyingSubType })
      }
    }
  } catch {
    // 忽略 exchangeInfo 获取错误，后续不进行上线时间过滤
  }

  // 2. 调用币安 24hr Ticker 获取所有合约数据（权重 40）
  const tickers = await binanceApiGateway.fetchJson<any[]>(
    'marketData',
    'ticker24hr:all',
    'https://fapi.binance.com/fapi/v1/ticker/24hr'
  )

  // 3. 保留完整快照供配置列表筛选，热门榜返回时再限定在交易的 USDT 永续。
  const symbols = [...tickers]
    .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
    .map((t: any) => {
      const { onboardDate = 0, contractType, underlyingType, underlyingSubType } = onboardMap.get(t.symbol) || {}
      const klineCount4h = onboardDate > 0
        ? Math.floor((Date.now() - onboardDate) / KLINE_4H_MS)
        : 0
      return {
        symbol: t.symbol,
        ...tickerDetails(t),
        volume: parseFloat(t.quoteVolume || '0'),
        price: parseFloat(t.lastPrice || 'NaN'),
        referenceTime: Number(t.closeTime) || Date.now(),
        priceChangePercent: parseFloat(t.priceChangePercent || 'NaN'),
        fundingRate: 0,
        klineCount4h,
        onboardDate,
        contractType,
        underlyingType,
        underlyingSubType,
      }
    })

  // 3a. 全量获取 premiumIndex（权重 10），一次性获取所有资金费率
  let fundingMap = new Map<string, number>()
  const premiums = new Map<string, any>()
  try {
    const allPremium: any[] = await binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'premiumIndex:all',
      'https://fapi.binance.com/fapi/v1/premiumIndex'
    )
    for (const item of allPremium) {
      premiums.set(item.symbol, item)
      fundingMap.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100)
    }
  } catch {
    // 忽略全量资金费率错误
  }

  // 4. 组装最终结果，仅消费本地已有 K线。
  await initKLineDb().catch(() => {})
  const result: TopSymbol[] = symbols.map(item => ({
    ...item,
    ...premiumDetails(premiums.get(item.symbol)),
    ...getLocalPeriodChanges(item.symbol, item.price, item.referenceTime),
    priceChangePercentDays: getLocal30DayChange(item.symbol, item.price, item.referenceTime),
    fundingRate: fundingMap.get(item.symbol) || 0,
  }))

  return { success: true, data: result, hotSymbols }
}
