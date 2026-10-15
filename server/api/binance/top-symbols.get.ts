// ==================== 热门交易对 API（支持 24h 热门 / 持续放量 两种模式） ====================
//
// 查询参数：
//   mode=hot（默认）：按 24h 成交额排序取前 100
//   mode=stable：按"最近 N 天持续稳定放量"筛选（排除短期热点）
//     附加参数：days / pool / top / minDaily / minRatio / cvMax / segmentRatio
//
// 持续放量判定：
//   1. 24h 成交额前 pool 名作为候选池
//   2. 拉最近 days 天日线，用 close × volume 折算每日成交额
//   3. avgDaily ≥ minDaily；最低/最高比 ≥ minRatio；CV ≤ cvMax；分段稳定性达标
//   4. 按 score = avgDaily × (1 - min(CV, 1)) 降序取 top

import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { getBotConfig } from '../../utils/storage'
import { getBinanceExchangeInfo } from '../../utils/binance-exchange-info'

interface TopSymbol {
  symbol: string
  volume: number          // 24h 成交额 (USDT)
  price: number           // 当前价格
  priceChangePercent: number // 24小时涨跌幅 (%)
  fundingRate: number     // 资金费率 (%)
  klineCount4h: number    // 4H K线可用根数
  onboardDate: number     // 上线时间戳 (ms)
  // 持续放量筛选模式下的附加字段
  avgDailyVolume?: number  // 窗口期日均成交额 (USDT)
  volumeCv?: number        // 变异系数（越小越稳定）
  minMaxRatio?: number     // 最低/最高日成交额比
  activeDays?: string      // 活跃天数，如 "21/21"
  contractType?: string    // 合约类型（PERPETUAL / TRADIFI_PERPETUAL）
  score?: number           // 综合得分 = avgDaily × (1 - min(CV, 1))
}

/** 持续放量筛选参数（与脚本 scripts/find-stable-volume-symbols.mjs 保持一致） */
interface StableFilterOptions {
  days: number      // 统计窗口天数
  pool: number      // 候选池数量（24h 成交额前 N 名）
  top: number       // 最终输出数量
  minDaily: number  // 日均成交额下限 (USDT)
  minRatio: number  // 最低/最高成交额比阈值
  cvMax: number     // 最大变异系数
  segmentRatio: number // 分段稳定性阈值
}

/** 持续放量筛选参数默认值 */
const FILTER_DEFAULTS: StableFilterOptions = {
  days: 21,
  pool: 100,
  top: 30,
  minDaily: 50_000_000,
  minRatio: 0.02,
  cvMax: 1.0,
  segmentRatio: 0.2,
}

/** 4H K线的毫秒数 */
const KLINE_4H_MS = 4 * 60 * 60 * 1000
/** 返回的热门交易对数量上限 */
const TOP_SYMBOLS_LIMIT = 100
/** 24h 热门、持续放量榜单及日线共用的缓存时长（30 分钟） */
const TOP_SYMBOLS_CACHE_TTL = 30 * 60 * 1000
// 按参数缓存榜单，按交易对和统计窗口缓存日线。
const stableCache = new Map<string, { data: TopSymbol[]; timestamp: number }>()
const stableRequests = new Map<string, Promise<TopSymbol[]>>()
const dailyVolumeCache = new Map<string, { data: number[]; timestamp: number }>()
const dailyVolumeRequests = new Map<string, Promise<number[]>>()
// 24h 热门结果缓存（无参数依赖）
let hotCache: { data: TopSymbol[]; timestamp: number } | null = null
let hotRequest: ReturnType<typeof fallbackHotMode> | null = null

/** 解析查询参数为数字，非法时回退默认值 */
function parseNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
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

/**
 * 拉取单个交易对最近 days 天日线，折算为每日成交额序列（USDT）。
 * klines 每根形如 [openTime, open, high, low, close, volume, ...]
 */
async function fetchDailyVolumes(symbol: string, days: number): Promise<number[]> {
  const key = `${symbol}:${days}`
  const cached = dailyVolumeCache.get(key)
  if (cached && Date.now() - cached.timestamp < TOP_SYMBOLS_CACHE_TTL) return cached.data

  const pending = dailyVolumeRequests.get(key)
  if (pending) return pending

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
    dailyVolumeCache.set(key, { data: volumes, timestamp: Date.now() })
    return volumes
  }).finally(() => dailyVolumeRequests.delete(key))
  dailyVolumeRequests.set(key, request)
  return request
}

/**
 * 分析单个交易对的"持续放量"指标。
 *
 * 核心逻辑：
 * 1. 数据根数校验：klines 返回根数不足 days×90% 视为上市时间过短，标记无效。
 * 2. 基础统计：avgDaily / cv / minRatio / activeDays。
 * 3. 分段稳定性：时间三等分，每段平均成交额须 ≥ 全期均值的 segmentRatio 倍，
 *    从根源上排除"某段时期没量、突然几天爆发"的短期热点。
 */
function analyzeSymbol(
  symbol: string,
  dailyVolumes: number[],
  days: number,
  segmentRatio: number,
  contractType: string
): { valid: boolean; reason?: string; analysis?: any } {
  const valid = dailyVolumes.filter(v => v > 0)
  const total = dailyVolumes.length

  // 数据根数不足（如上市不足 days 天）时标记无效
  if (total < Math.ceil(days * 0.9)) {
    return { valid: false, reason: '上市时间不足，数据根数不够' }
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
      activeDays: valid.length,
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

/**
 * 执行"持续放量"筛选模式。
 */
async function fetchStableTopSymbols(options: StableFilterOptions): Promise<TopSymbol[]> {
  // 1. 获取全市场合约信息（含上线时间与合约类型）
  let onboardMap = new Map<string, { onboardDate: number; contractType: string }>()
  try {
    const exchangeInfo = await getBinanceExchangeInfo()
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
        })
      }
    }
  } catch {
    // 忽略 exchangeInfo 错误，后续不进行上线时间过滤
  }

  // 2. 24hr Ticker 全量，按成交额取候选池
  const tickers = await binanceApiGateway.fetchJson<any[]>(
    'marketData',
    'stableTicker24hr:all',
    'https://fapi.binance.com/fapi/v1/ticker/24hr'
  )
  const candidatePool = tickers
    .filter((t: any) => onboardMap.has(t.symbol))
    .map((t: any) => ({
      symbol: t.symbol,
      quoteVolume: parseFloat(t.quoteVolume || '0'),
      lastPrice: parseFloat(t.lastPrice || '0'),
      priceChangePercent: parseFloat(t.priceChangePercent || '0'),
      contractType: onboardMap.get(t.symbol)?.contractType || 'PERPETUAL',
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, options.pool)

  // 3. 并行拉取每个候选的日线并分析稳定性（限流器自动排队，应用层限制并发 5）
  const analysisResults = await runPool(candidatePool, 5, async (ticker) => {
    const dailyVolumes = await fetchDailyVolumes(ticker.symbol, options.days)
    const result = analyzeSymbol(ticker.symbol, dailyVolumes, options.days, options.segmentRatio, ticker.contractType)
    if (!result.valid) {
      return { symbol: ticker.symbol, error: result.reason || 'invalid' }
    }
    return { symbol: ticker.symbol, ...result.analysis, quoteVolume: ticker.quoteVolume, lastPrice: ticker.lastPrice, priceChangePercent: ticker.priceChangePercent }
  })

  // 4. 过滤 + 排序 + 取前 top
  const valid = analysisResults.filter((r: any) => r && !r.error && r.avgDaily !== undefined && r.avgDaily !== null)
  const qualified = valid
    .filter((r: any) => r.avgDaily >= options.minDaily)
    .filter((r: any) => r.activeDays >= Math.ceil(options.days * 0.9)) // 至少 90% 天数有量
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
  let fundingMap = new Map<string, number>()
  try {
    const allPremium: any[] = await binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'stablePremiumIndex:all',
      'https://fapi.binance.com/fapi/v1/premiumIndex'
    )
    for (const item of allPremium) {
      fundingMap.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100)
    }
  } catch {
    // 忽略全量资金费率错误
  }

  return qualified.map((item: any) => ({
    symbol: item.symbol,
    volume: item.quoteVolume,
    price: item.lastPrice,
    priceChangePercent: item.priceChangePercent,
    fundingRate: fundingMap.get(item.symbol) || 0,
    klineCount4h: 0,
    onboardDate: onboardMap.get(item.symbol)?.onboardDate || 0,
    avgDailyVolume: Math.round(item.avgDaily),
    volumeCv: Number(item.cv.toFixed(4)),
    minMaxRatio: Number(item.minRatio.toFixed(4)),
    activeDays: `${item.activeDays}/${item.totalDays}`,
    contractType: item.contractType,
    score: Number(item.score.toFixed(2)),
  }))
}

/** 同参数只计算一次；过期榜单可以在后台刷新期间继续提供结果。 */
function refreshStableTopSymbols(key: string, options: StableFilterOptions): Promise<TopSymbol[]> {
  const pending = stableRequests.get(key)
  if (pending) return pending

  const request = fetchStableTopSymbols(options).then(data => {
    if (stableCache.size >= 20 && !stableCache.has(key)) {
      const oldestKey = stableCache.keys().next().value
      if (oldestKey) stableCache.delete(oldestKey)
    }
    stableCache.set(key, { data, timestamp: Date.now() })
    return data
  }).finally(() => stableRequests.delete(key))
  stableRequests.set(key, request)
  return request
}

/** 缓存未命中时复用同一轮热门榜计算，失败后允许下一次请求重试。 */
function getHotTopSymbols(): ReturnType<typeof fallbackHotMode> {
  if (hotCache && Date.now() - hotCache.timestamp < TOP_SYMBOLS_CACHE_TTL) {
    return Promise.resolve({ success: true, data: hotCache.data })
  }
  if (hotRequest) return hotRequest

  hotRequest = fallbackHotMode().then(result => {
    if (result.success) hotCache = { data: result.data, timestamp: Date.now() }
    return result
  }).finally(() => { hotRequest = null })
  return hotRequest
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const mode = query.mode === 'stable' ? 'stable' : 'hot'

  // ============ 持续放量模式 ============
  if (mode === 'stable') {
    const options: StableFilterOptions = {
      days: Math.max(5, Math.min(90, parseNumber(query.days, FILTER_DEFAULTS.days))),
      pool: Math.max(30, Math.min(500, parseNumber(query.pool, FILTER_DEFAULTS.pool))),
      top: Math.max(5, Math.min(100, parseNumber(query.top, FILTER_DEFAULTS.top))),
      minDaily: parseNumber(query.minDaily, FILTER_DEFAULTS.minDaily),
      minRatio: parseNumber(query.minRatio, FILTER_DEFAULTS.minRatio),
      cvMax: parseNumber(query.cvMax, FILTER_DEFAULTS.cvMax),
      segmentRatio: parseNumber(query.segmentRatio, FILTER_DEFAULTS.segmentRatio),
    }

    // 过期时先返回上次结果，后台合并同参数刷新；冷缓存才等待完整计算。
    const cacheKey = JSON.stringify(options)
    const cached = stableCache.get(cacheKey)
    if (cached) {
      if (Date.now() - cached.timestamp >= TOP_SYMBOLS_CACHE_TTL) {
        void refreshStableTopSymbols(cacheKey, options).catch(error => {
          console.error('后台刷新持续放量榜单失败:', error)
        })
      }
      return { success: true, mode, params: options, data: cached.data, updatedAt: cached.timestamp }
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
 * 原有 24h 热门逻辑：按 24h 成交额排序取前 TOP_SYMBOLS_LIMIT。
 * 抽成独立函数，供持续放量模式失败时降级复用。
 */
async function fallbackHotMode() {
  // 0. 从 bot-config.json 读取 requiredCandles 作为最少需要的4H K线根数
  const botConfig = await getBotConfig()
  const minKlineCount = botConfig.indicatorsConfig?.requiredCandles || 493

  // 1. 获取所有合约的 exchangeInfo（含上线时间和合约类型）
  const onboardMap = new Map<string, { onboardDate: number; contractType: string }>()
  try {
    const exchangeInfo = await getBinanceExchangeInfo()
    for (const s of (exchangeInfo.symbols || [])) {
      // PERPETUAL = 普通永续合约, TRADIFI_PERPETUAL = TradFi 永续合约（如 SNDKUSDT）
      if ((s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.symbol.endsWith('USDT') && !s.symbol.endsWith('USDCUSDT')) {
        const onboardDate = s.onboardDate ? Number(s.onboardDate) : 0
        onboardMap.set(s.symbol, { onboardDate, contractType: s.contractType })
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

  // 3. 筛选符合 K 线要求的 USDT 永续合约，再按成交额取前 TOP_SYMBOLS_LIMIT 个
  const symbols = tickers
    .filter((t: any) => onboardMap.has(t.symbol)) // 只保留 exchangeInfo 中存在的永久合约
    // 先排除上线时间不足的交易对，避免截取后榜单数量不足 100
    .filter((t: any) => {
      const onboardDate = onboardMap.get(t.symbol)?.onboardDate || 0
      return onboardDate > 0 && Math.floor((Date.now() - onboardDate) / KLINE_4H_MS) >= minKlineCount
    })
    .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
    .slice(0, TOP_SYMBOLS_LIMIT)
    .map((t: any) => {
      const { onboardDate = 0, contractType } = onboardMap.get(t.symbol) || {}
      const klineCount4h = onboardDate > 0
        ? Math.floor((Date.now() - onboardDate) / KLINE_4H_MS)
        : 0
      return {
        symbol: t.symbol,
        volume: parseFloat(t.quoteVolume || '0'),
        price: parseFloat(t.lastPrice || '0'),
        priceChangePercent: parseFloat(t.priceChangePercent || '0'),
        fundingRate: 0,
        klineCount4h,
        onboardDate,
        contractType,
      }
    })

  // 3a. 全量获取 premiumIndex（权重 10），一次性获取所有资金费率
  let fundingMap = new Map<string, number>()
  try {
    const allPremium: any[] = await binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'premiumIndex:all',
      'https://fapi.binance.com/fapi/v1/premiumIndex'
    )
    for (const item of allPremium) {
      fundingMap.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100)
    }
  } catch {
    // 忽略全量资金费率错误
  }

  // 4. 组装最终结果
  const result: TopSymbol[] = symbols.map(item => ({
    ...item,
    fundingRate: fundingMap.get(item.symbol) || 0,
  }))

  return { success: true, data: result }
}
