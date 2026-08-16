// ==================== 历史订单 K 线完成进度回填脚本 ====================
// 用途：根据订单入场时间和主周期，估算并补齐 candleProgressPercent。
// 用法：
//   node scripts/backfill-candle-progress.mjs                 # 仅预览，不写入
//   node scripts/backfill-candle-progress.mjs --write         # 备份后写入
//   node scripts/backfill-candle-progress.mjs --write --overwrite
//   node scripts/backfill-candle-progress.mjs --file data/trade-history.json
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_HISTORY_FILE = path.resolve('data', 'trade-history.json')
const STRATEGIES_DIR = path.resolve('data', 'strategies')

/**
 * 读取指定命令行参数的值，兼容“--file value”和“--file=value”。
 */
function getArgumentValue(name) {
  const equalPrefix = `${name}=`
  const equalArgument = process.argv.find(argument => argument.startsWith(equalPrefix))
  if (equalArgument) return equalArgument.slice(equalPrefix.length)

  const argumentIndex = process.argv.indexOf(name)
  return argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined
}

/**
 * 将线上支持的 K 线周期转换为毫秒。
 *
 * 与 StrategyEngine.timeframeToMs() 保持相同的 m/h/d 单位口径；格式无效时返回 null，
 * 避免使用默认周期静默写入错误数据。
 */
function timeframeToMs(timeframe) {
  if (typeof timeframe !== 'string') return null

  const match = timeframe.trim().match(/^(\d+)([mhd])$/i)
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isInteger(value) || value <= 0) return null

  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  }[match[2].toLowerCase()]

  return value * unitMs
}

/**
 * 从当前策略文件读取主周期，供缺少 mainTimeframe 的旧订单回退使用。
 *
 * 策略配置可能在历史开仓后被修改，因此该来源会单独计为“策略推断”，不与订单自带周期混淆。
 */
function loadStrategyTimeframes() {
  const timeframes = new Map()
  if (!fs.existsSync(STRATEGIES_DIR)) return timeframes

  for (const fileName of fs.readdirSync(STRATEGIES_DIR)) {
    if (!fileName.endsWith('.json')) continue

    const strategyPath = path.join(STRATEGIES_DIR, fileName)
    try {
      const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf8'))
      const timeframe = strategy.marketData?.timeframes?.[0]
      if (strategy.id && timeframeToMs(timeframe)) {
        timeframes.set(strategy.id, timeframe)
      }
    } catch (error) {
      console.warn(`跳过无法读取的策略文件 ${strategyPath}: ${error.message}`)
    }
  }

  return timeframes
}

/**
 * 使用入场成交时间估算该时间在当前 K 线中的位置，并保留一位小数。
 *
 * Binance K 线以 Unix 时间边界对齐，因此可通过时间戳对周期取模得到进度。
 * 该结果包含 AI 响应和下单成交延迟，不等同于历史 AI 请求时刻的精确值。
 */
function calculateCandleProgressPercent(openTime, timeframeMs) {
  const offset = ((openTime % timeframeMs) + timeframeMs) % timeframeMs
  return Number(((offset / timeframeMs) * 100).toFixed(1))
}

/**
 * 为历史订单补齐 K 线完成进度并返回详细统计。
 */
function backfillTrades(trades, strategyTimeframes, overwrite) {
  const stats = {
    total: trades.length,
    updated: 0,
    preserved: 0,
    fromTradeTimeframe: 0,
    fromStrategyTimeframe: 0,
    skippedInvalidOpenTime: 0,
    skippedMissingTimeframe: 0,
    skippedInvalidTimeframe: 0
  }
  const samples = []

  for (const trade of trades) {
    if (!overwrite && Number.isFinite(trade.candleProgressPercent)) {
      stats.preserved++
      continue
    }

    const openTime = Number(trade.openTime)
    if (!Number.isFinite(openTime) || openTime <= 0) {
      stats.skippedInvalidOpenTime++
      continue
    }

    const hasTradeTimeframe = typeof trade.mainTimeframe === 'string' && trade.mainTimeframe.trim() !== ''
    const timeframe = hasTradeTimeframe
      ? trade.mainTimeframe
      : strategyTimeframes.get(trade.strategyId)

    if (!timeframe) {
      stats.skippedMissingTimeframe++
      continue
    }

    const timeframeMs = timeframeToMs(timeframe)
    if (!timeframeMs) {
      stats.skippedInvalidTimeframe++
      continue
    }

    trade.candleProgressPercent = calculateCandleProgressPercent(openTime, timeframeMs)
    stats.updated++
    if (hasTradeTimeframe) stats.fromTradeTimeframe++
    else stats.fromStrategyTimeframe++

    if (samples.length < 10) {
      samples.push({
        id: trade.id,
        openTime: new Date(openTime).toISOString(),
        timeframe,
        timeframeSource: hasTradeTimeframe ? 'trade' : 'strategy',
        candleProgressPercent: trade.candleProgressPercent
      })
    }
  }

  return { stats, samples }
}

/**
 * 执行预览或带备份的历史文件回填。
 */
function main() {
  const shouldWrite = process.argv.includes('--write')
  const overwrite = process.argv.includes('--overwrite')
  const historyArgument = getArgumentValue('--file')
  const historyFile = path.resolve(historyArgument || DEFAULT_HISTORY_FILE)

  if (!fs.existsSync(historyFile)) {
    throw new Error(`历史订单文件不存在: ${historyFile}`)
  }

  const trades = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
  if (!Array.isArray(trades)) {
    throw new Error(`历史订单文件必须是 JSON 数组: ${historyFile}`)
  }

  const strategyTimeframes = loadStrategyTimeframes()
  const { stats, samples } = backfillTrades(trades, strategyTimeframes, overwrite)

  console.log(`历史文件：${historyFile}`)
  console.log(`订单总数：${stats.total}`)
  console.log(`本次可回填：${stats.updated}`)
  console.log(`  使用订单 mainTimeframe：${stats.fromTradeTimeframe}`)
  console.log(`  使用当前策略配置推断：${stats.fromStrategyTimeframe}`)
  console.log(`保留已有有效值：${stats.preserved}`)
  console.log(`跳过（openTime 无效）：${stats.skippedInvalidOpenTime}`)
  console.log(`跳过（无法确定周期）：${stats.skippedMissingTimeframe}`)
  console.log(`跳过（周期格式无效）：${stats.skippedInvalidTimeframe}`)

  if (samples.length > 0) {
    console.log('\n前 10 条回填预览：')
    console.table(samples)
  }

  if (!shouldWrite) {
    console.log('\n[PREVIEW] 未写入文件；确认结果后添加 --write 执行回填。')
    return
  }

  if (stats.updated === 0) {
    console.log('\n没有需要写入的记录。')
    return
  }

  const backupFile = `${historyFile}.backup-candle-progress-${Date.now()}`
  fs.copyFileSync(historyFile, backupFile)
  fs.writeFileSync(historyFile, `${JSON.stringify(trades, null, 2)}\n`, 'utf8')
  console.log(`\n已写回：${historyFile}`)
  console.log(`原文件备份：${backupFile}`)
}

main()
