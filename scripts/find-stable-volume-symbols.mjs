// ==================== 持续放量交易对扫描脚本 ====================
//
// 用途：找出币安 USDT 永续合约中，最近 N 天（默认 30 天）成交量
//      一直稳定且较高的交易对（排除"一两天突然热门"的短期热点）。
//
// 实现逻辑：
//   1. 先拉 24hr Ticker 拿全市场 24h 成交额，按成交额取前 pool 个
//      作为候选池（持续热门的当前必然也有量）。
//   2. 对候选池逐个拉最近 N 天日线 klines，用 volume × close 折算
//      每日成交额（USDT），计算 avgDaily / cv / minRatio / activeDays，
//      并按时间三等分做"分段稳定性"检查（每段平均成交额都须达标，
//      从根源上排除"某几天突然爆发"的短期热点）。
//   3. 按"持续高量"标准过滤并排序，输出前 top 个。
//
// 运行方式：
//   node scripts/find-stable-volume-symbols.mjs [--days 30] [--pool 200] \
//     [--top 30] [--min-daily 50000000] [--min-ratio 0.04] [--cv-max 1.0] \
//     [--segment-ratio 0.4] [--output data/stable-volume-symbols.json]

import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'

const PROJECT_ROOT = resolve(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))

// ==================== 命令行参数 ====================

function parseArgs(args) {
  const options = {
    days: 15,                  // 统计窗口天数：拉取最近 N 天日线做成交量分析
    pool: 200,                 // 候选池数量：取 24h 成交额全市场前 N 名进入分析
    top: 30,                   // 最终输出数量：榜单取前 N 个持续放量交易对
    minDaily: 50_000_000,      // 日均成交额下限（USDT）：30 天平均日成交额须 ≥ 此值，过滤无流动性小币
    minRatio: 0.02,            // 最低/最高成交额比：最低量那天 ≥ 最高量那天的 2%，排除"某几天爆发其余没量"的短期热点
    cvMax: 1.0,                // 最大变异系数：CV = 标准差÷均值，CV ≤ 1.0 才纳入，过滤整体波动剧烈的交易对
    segmentRatio: 0.2,         // 分段稳定性阈值：30 天三等分，每段平均成交额须 ≥ 全期均值的 20%，杜绝"某段时期没量"的情况
    output: 'data/stable-volume-symbols.json',  // 结果 JSON 文件输出路径
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) continue
      if (key === 'days') options.days = Number(value)
      if (key === 'pool') options.pool = Number(value)
      if (key === 'top') options.top = Number(value)
      if (key === 'min-daily') options.minDaily = Number(value)
      if (key === 'min-ratio') options.minRatio = Number(value)
      if (key === 'cv-max') options.cvMax = Number(value)
      if (key === 'segment-ratio') options.segmentRatio = Number(value)
      if (key === 'output') options.output = value
      i++
    }
  }
  return options
}

const OPTIONS = parseArgs(process.argv.slice(2))

// ==================== Binance 公共接口（轻量 fetch + 简易重试） ====================

const FAPI_BASE = 'https://fapi.binance.com/fapi/v1'
const CONCURRENCY = 3        // 并发数，保守避免触发限流
const REQUEST_INTERVAL_MS = 120 // 每个请求之间的最小间隔

let lastRequestAt = 0

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 请求 Binance 公共接口，带限速和重试。
 * @param {string} path 接口路径（如 /ticker/24hr）
 * @param {string} key   限速/日志标识
 * @param {number} retries 剩余重试次数
 */
async function binanceFetch(path, key, retries = 3) {
  const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  try {
    const res = await fetch(`${FAPI_BASE}${path}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    return await res.json()
  } catch (error) {
    if (retries > 0) {
      const backoff = 1000 * (4 - retries)
      console.warn(`  ⚠️ 请求失败，${backoff / 1000}s 后重试 (${key}): ${error.message}`)
      await sleep(backoff)
      return binanceFetch(path, key, retries - 1)
    }
    throw error
  }
}

/**
 * 简单并发池：限制同时执行的任务数。
 * @param {Array} items 任务输入
 * @param {number} limit 并发上限
 * @param {(item, index) => Promise<any>} worker 任务函数
 */
async function runPool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        results[index] = { error: error.message, item: items[index] }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner())
  await Promise.all(workers)
  return results
}

// ==================== 核心逻辑 ====================

/**
 * 获取所有 USDT 永续合约的 24h 成交额，按成交额降序。
 * 返回 [{ symbol, quoteVolume }]
 */
async function fetchAllPerpetualTickers() {
  const exchangeInfo = await binanceFetch('/exchangeInfo', 'exchangeInfo')
  const symbolMap = new Map()
  for (const s of (exchangeInfo.symbols || [])) {
    if (
      (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') &&
      s.symbol.endsWith('USDT') &&
      !s.symbol.endsWith('USDCUSDT') &&
      s.status === 'TRADING'
    ) {
      symbolMap.set(s.symbol, s.contractType)
    }
  }

  const tickers = await binanceFetch('/ticker/24hr', 'ticker24hr')
  return tickers
    .filter(t => symbolMap.has(t.symbol))
    .map(t => ({
      symbol: t.symbol,
      quoteVolume: parseFloat(t.quoteVolume || '0'),
      contractType: symbolMap.get(t.symbol) || 'PERPETUAL',
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
}

/**
 * 拉取单个交易对最近 days 天的日线，计算每日成交额序列。
 * @param {string} symbol 如 BTCUSDT
 * @param {number} days  统计天数
 * @returns {number[]} 每日成交额（USDT），按时间正序
 */
async function fetchDailyVolumes(symbol, days) {
  const data = await binanceFetch(
    `/klines?symbol=${symbol}&interval=1d&limit=${days}`,
    `klines:${symbol}`
  )
  // klines 每根形如 [openTime, open, high, low, close, volume, ...]
  return data.map(k => {
    const close = parseFloat(k[4])
    const volume = parseFloat(k[5])
    return close * volume // 日成交额 ≈ 收盘价 × 成交量
  })
}

// 统计工具
const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length
const stddev = arr => {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

/**
 * 将大额数字格式化为紧凑单位（B=十亿 / M=百万 / K=千）。
 * @param {number} value 原始数值
 * @returns {string} 如 "81.43B"、"715.52M"
 */
const formatCompact = (value) => {
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B'
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M'
  if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K'
  return value.toFixed(2)
}

/**
 * 分析单个交易对的"持续放量"指标。
 *
 * 核心逻辑：
 * 1. 数据根数校验：klines 返回根数不足 days×90% 视为上市时间过短，直接无效。
 * 2. 基础统计：avgDaily（日均成交额）、cv（变异系数）、minRatio（最低/最高比）。
 * 3. 分段稳定性检查：将时间三等分，每段平均成交额须 ≥ 全期均值的
 *    segmentRatio 倍，从根源上排除"前 25 天没量、最后 5 天暴涨"的短期热点。
 *
 * @param {string} symbol
 * @param {number[]} dailyVolumes 每日成交额（USDT）
 * @param {number} days 统计窗口天数
 * @param {number} segmentRatio 分段最低占比阈值
 */
function analyzeSymbol(symbol, dailyVolumes, days, segmentRatio) {
  const valid = dailyVolumes.filter(v => v > 0)
  const total = dailyVolumes.length
  const activeDays = valid.length

  // 数据根数不足（如上市不足 days 天）时标记无效
  if (total < Math.ceil(days * 0.9)) {
    return { symbol, valid: false, reason: '上市时间不足，数据根数不够' }
  }

  const avgDaily = mean(valid)
  const maxDaily = Math.max(...valid)
  const minDaily = Math.min(...valid)
  const cv = avgDaily > 0 ? stddev(valid) / avgDaily : Infinity
  const totalVolume = valid.reduce((s, v) => s + v, 0)
  const minRatio = maxDaily > 0 ? minDaily / maxDaily : 0

  // 分段稳定性检查：将时间三等分，每段平均成交额须 ≥ 全期均值的 segmentRatio 倍
  const segmentCount = 3
  const segLen = Math.floor(valid.length / segmentCount)
  let segmentOk = true
  let minSegmentAvg = 0
  if (segLen >= 2) {
    const segmentAvgs = []
    for (let i = 0; i < segmentCount; i++) {
      const segSlice = valid.slice(i * segLen, i === segmentCount - 1 ? valid.length : (i + 1) * segLen)
      if (segSlice.length === 0) continue
      const segAvg = mean(segSlice)
      segmentAvgs.push(segAvg)
      if (segAvg < avgDaily * segmentRatio) {
        segmentOk = false
      }
    }
    minSegmentAvg = segmentAvgs.length > 0 ? Math.min(...segmentAvgs) : 0
  }

  // 综合得分：成交额高 + 波动小 => 得分高
  const score = avgDaily * (1 - Math.min(cv, 1))

  return {
    symbol,
    valid: true,
    activeDays,
    totalDays: total,
    avgDaily,
    totalVolume,
    minDaily,
    maxDaily,
    minRatio,
    cv,
    score,
    segmentOk,
    minSegmentAvg,
    last24h: valid[valid.length - 1] || 0,
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('🔍 开始扫描币安 USDT 永续合约持续放量交易对...')
  console.log(`   窗口: ${OPTIONS.days}天 | 候选池: ${OPTIONS.pool} | 输出: ${OPTIONS.top}`)

  // 1. 全市场 24h 成交额排序，取候选池
  console.log('\n[1/3] 获取全市场 24h 成交额...')
  const allTickers = await fetchAllPerpetualTickers()
  const candidatePool = allTickers.slice(0, OPTIONS.pool)
  console.log(`   全市场 ${allTickers.length} 个 USDT 永续合约，取前 ${candidatePool.length} 个作为候选池`)

  // 2. 逐个拉日线，分析稳定度
  console.log(`\n[2/3] 拉取最近 ${OPTIONS.days} 天日线并分析成交量稳定性...`)
  const analysisResults = await runPool(candidatePool, CONCURRENCY, async (ticker) => {
    try {
      const dailyVolumes = await fetchDailyVolumes(ticker.symbol, OPTIONS.days)
      const analysis = analyzeSymbol(ticker.symbol, dailyVolumes, OPTIONS.days, OPTIONS.segmentRatio)
      return { ...analysis, current24h: ticker.quoteVolume, contractType: ticker.contractType }
    } catch (error) {
      return { symbol: ticker.symbol, valid: false, reason: `请求失败: ${error.message}` }
    }
  })

  const valid = analysisResults.filter(r => r.valid && r.error === undefined)

  // 3. 过滤 + 排序 + 取前 top
  console.log(`\n[3/3] 过滤与排序...`)
  const qualified = valid
    .filter(r => r.avgDaily >= OPTIONS.minDaily)
    .filter(r => r.activeDays >= Math.ceil(OPTIONS.days * 0.9)) // 至少 90% 天数有量
    .filter(r => r.minRatio >= OPTIONS.minRatio)
    .filter(r => r.cv <= OPTIONS.cvMax)
    .filter(r => r.segmentOk) // 三段区间均有持续放量
    .sort((a, b) => b.score - a.score)
    .slice(0, OPTIONS.top)

  const filteredOut = {
    tested: analysisResults.length,
    invalidData: analysisResults.length - valid.length,
    lowAvgVolume: valid.filter(r => r.avgDaily < OPTIONS.minDaily).length,
    inactiveDays: valid.filter(r => r.activeDays < Math.ceil(OPTIONS.days * 0.9)).length,
    lowMinRatio: valid.filter(r => r.minRatio < OPTIONS.minRatio).length,
    highCv: valid.filter(r => r.cv > OPTIONS.cvMax).length,
    segmentFailed: valid.filter(r => !r.segmentOk).length,
  }

  // 4. 输出结果
  console.log(`\n✅ 找到 ${qualified.length} 个持续放量交易对：\n`)
  const header = `${'#'.padStart(3)} ${'交易对'.padEnd(14)} ${'类型'.padStart(4)} ${'日均成交额'.padStart(12)} ${'CV'.padStart(6)} ${'最低/最高'.padStart(8)} ${'活跃天数'.padStart(6)} ${'30天累计'.padStart(12)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  qualified.forEach((item, i) => {
    const rank = String(i + 1).padStart(3)
    const symbol = item.symbol.padEnd(14)
    const type = (item.contractType === 'TRADIFI_PERPETUAL' ? 'T' : 'P').padStart(4)
    const avg = formatCompact(item.avgDaily).padStart(12)
    const cv = item.cv.toFixed(2).padStart(6)
    const ratio = (item.minRatio * 100).toFixed(0) + '%'.padStart(7)
    const days = `${item.activeDays}/${item.totalDays}`.padStart(6)
    const total = formatCompact(item.totalVolume).padStart(12)
    console.log(`${rank} ${symbol} ${type} ${avg} ${cv} ${ratio} ${days} ${total}`)
  })

  console.log('\n--- 过滤统计 ---')
  console.log(`测试候选: ${filteredOut.tested}`)
  console.log(`数据不足/失败: ${filteredOut.invalidData}`)
  console.log(`日均成交额低于阈值: ${filteredOut.lowAvgVolume}`)
  console.log(`活跃天数不足: ${filteredOut.inactiveDays}`)
  console.log(`最低/最高比低于阈值: ${filteredOut.lowMinRatio}`)
  console.log(`CV 超过阈值: ${filteredOut.highCv}`)
  console.log(`分段稳定性不达标: ${filteredOut.segmentFailed}`)
  console.log(`候选池中 TRADIFI 合约: ${allTickers.filter(t => t.contractType === 'TRADIFI_PERPETUAL').length} 个`)
  console.log(`TRADIFI 合约通过筛选: ${qualified.filter(r => r.contractType === 'TRADIFI_PERPETUAL').length} 个`)

  // 5. 写出 JSON 结果
  const outputPath = resolve(PROJECT_ROOT, OPTIONS.output)
  await mkdir(dirname(outputPath), { recursive: true })
  const result = {
    generatedAt: new Date().toISOString(),
    options: OPTIONS,
    filters: {
      minDaily: OPTIONS.minDaily,
      minRatio: OPTIONS.minRatio,
      cvMax: OPTIONS.cvMax,
      segmentRatio: OPTIONS.segmentRatio,
      activeDaysThreshold: `>= ${Math.ceil(OPTIONS.days * 0.9)} 天`,
    },
    symbols: qualified.map((item, i) => ({
      rank: i + 1,
      symbol: item.symbol,
      contractType: item.contractType || 'PERPETUAL',
      avgDailyVolume: Math.round(item.avgDaily),
      avgDailyVolumeDisplay: formatCompact(item.avgDaily),
      cv: Number(item.cv.toFixed(4)),
      minMaxRatio: Number(item.minRatio.toFixed(4)),
      activeDays: `${item.activeDays}/${item.totalDays}`,
      totalVolume30d: Math.round(item.totalVolume),
      totalVolume30dDisplay: formatCompact(item.totalVolume),
      current24hVolume: item.current24h,
      score: Number(item.score.toFixed(2)),
    })),
    allResults: valid.map(item => ({
      symbol: item.symbol,
      contractType: item.contractType || 'PERPETUAL',
      valid: item.valid,
      avgDailyVolume: Math.round(item.avgDaily),
      cv: Number(item.cv.toFixed(4)),
      minMaxRatio: Number(item.minRatio.toFixed(4)),
      activeDays: `${item.activeDays}/${item.totalDays}`,
      totalVolume30d: Math.round(item.totalVolume),
      segmentOk: item.segmentOk,
      minSegmentAvg: Math.round(item.minSegmentAvg),
    })),
  }
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`\n📄 完整结果已写入: ${OPTIONS.output}`)
}

main().catch(error => {
  console.error('脚本执行失败:', error)
  process.exit(1)
})