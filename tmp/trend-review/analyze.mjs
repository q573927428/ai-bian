// ==================== 趋势策略历史复盘（只读运行数据） ====================
// 用法：node tmp/trend-review/analyze.mjs [--check-kline]
// 仅写入本目录的 metrics.json；不会启动机器人、调用外部服务或改动运行数据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, 'data')
const finite = value => typeof value === 'number' && Number.isFinite(value)
const round = (value, digits = 6) => finite(value) ? Number(value.toFixed(digits)) : null
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const sum = values => values.reduce((total, value) => total + (finite(value) ? value : 0), 0)
const mean = values => values.length ? sum(values) / values.length : null
const localTime = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const side = trade => trade.direction === 'LONG' ? 1 : -1
const initialRisk = trade => Math.abs(trade.entryPrice - trade.stopLossPrice) * trade.quantity
const netR = trade => initialRisk(trade) > 0 ? trade.pnl / initialRisk(trade) : null
const mfeR = trade => initialRisk(trade) > 0 && finite(trade.maxFloatingProfit)
  ? trade.maxFloatingProfit / initialRisk(trade) : null

/** 中位数只接收有效数值；缺失不能自动当作零。 */
function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b)
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null
}

/** 净利使用交易记录 pnl；旧记录只能反推毛利，不能假定资金费已完整记录。 */
function stats(records) {
  const winners = records.filter(trade => trade.pnl > 0)
  const losers = records.filter(trade => trade.pnl < 0)
  const wins = sum(winners.map(trade => trade.pnl))
  const losses = -sum(losers.map(trade => trade.pnl))
  return {
    n: records.length,
    wins: winners.length,
    losses: losers.length,
    winRatePercent: round(records.length ? winners.length / records.length * 100 : null),
    netPnl: round(sum(records.map(trade => trade.pnl))),
    grossPnl: round(sum(records.map(trade => finite(trade.grossRealizedPnl)
      ? trade.grossRealizedPnl : trade.pnl + (trade.totalCommission || 0) - (trade.fundingFee || 0)))),
    commission: round(sum(records.map(trade => trade.totalCommission))),
    recordedFundingFee: round(sum(records.map(trade => trade.fundingFee))),
    profitFactor: round(losses > 0 ? wins / losses : null),
    averageWin: round(mean(winners.map(trade => trade.pnl))),
    averageLoss: round(mean(losers.map(trade => trade.pnl))),
    meanNetR: round(mean(records.map(netR).filter(finite))),
    medianFeeR: round(median(records.map(trade => trade.totalCommission / initialRisk(trade)))),
    medianHoldingMinutes: round(median(records.map(trade => trade.holdingMinutes))),
  }
}

/** 分组保留样本数，防止将小样本盈利桶误当成稳定规律。 */
function group(records, keyOf) {
  const grouped = new Map()
  for (const trade of records) {
    const key = keyOf(trade)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(trade)
  }
  return Object.fromEntries([...grouped].map(([key, records]) => [key, stats(records)]))
}

/** 固定分桶仅作探索统计，不按结果寻找最优阈值。 */
function bucket(value, edges) {
  if (!finite(value)) return 'missing'
  const index = edges.findIndex(edge => value < edge)
  return index < 0 ? `>=${edges.at(-1)}` : index === 0 ? `<${edges[0]}` : `${edges[index - 1]}~${edges[index]}`
}

/** 兼容历史 EMA 字段，以交易方向定义正向追价距离；不同参数阶段必须另行分组。 */
function stretch(trade) {
  const indicators = trade.entryIndicators || {}
  const fastEma = indicators.EMA20 ?? indicators.EMA14 ?? indicators.EMAEMA14
  return finite(fastEma) && indicators.ATR > 0
    ? (trade.entryPrice - fastEma) * side(trade) / indicators.ATR : null
}

const files = fs.readdirSync(dataDir).filter(file => /^trade-history(?:-\d{8}|-\d{4}-(?:0[1-9]|1[0-2]))?\.json$/.test(file))
  .sort((a, b) => Number(/-\d{4}-\d{2}\.json$/.test(a)) - Number(/-\d{4}-\d{2}\.json$/.test(b)) || a.localeCompare(b))
const unique = new Map()
let sourceCount = 0
for (const file of files) {
  const records = readJson(path.join(dataDir, file))
  if (!Array.isArray(records)) throw new Error(`交易历史不是数组：${file}`)
  for (const record of records) {
    sourceCount++
    if (!record.id) throw new Error(`交易缺少 ID：${file}`)
    unique.set(record.id, { ...unique.get(record.id), ...record, sourceFile: file })
  }
}
const trades = [...unique.values()].sort((a, b) => a.closeTime - b.closeTime)
if (!trades.length) throw new Error('没有可分析的交易')
if (trades.some(trade => !finite(trade.pnl) || !(initialRisk(trade) > 0))) throw new Error('存在无效盈亏或初始风险')
const strategies = fs.readdirSync(path.join(dataDir, 'strategies')).filter(file => file.endsWith('.json'))
  .map(file => readJson(path.join(dataDir, 'strategies', file)))
const automatic = trades.filter(trade => trade.closeCategory !== 'manual')
const dmi = trades.filter(trade => finite(trade.entryIndicators?.PDI))
const losers = trades.filter(trade => trade.pnl < 0)

// 先用真实 analysisId 关联；旧记录只接受 120 秒内且理由、方向、分数均一致的唯一记录。
// 时间接近但文本不一致的候选不会被强行关联。
const snapshots = new Map()
const decisionRoot = path.join(dataDir, 'trade-decisions')
if (fs.existsSync(decisionRoot)) {
  for (const month of fs.readdirSync(decisionRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const file of fs.readdirSync(path.join(decisionRoot, month.name)).filter(file => file.endsWith('.json'))) {
      const snapshot = readJson(path.join(decisionRoot, month.name, file))
      snapshots.set(snapshot.analysisId, snapshot)
    }
  }
}
const aiRows = []
const malformedAiLines = []
for (const file of fs.readdirSync(path.join(dataDir, 'ai-analysis')).filter(file => /^ai-analysis-2026-10-\d+\.jsonl$/.test(file))) {
  const lines = fs.readFileSync(path.join(dataDir, 'ai-analysis', file), 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!line.trim()) return
    try {
      const row = JSON.parse(line)
      if (row.environmentContext) aiRows.push(row)
    } catch {
      malformedAiLines.push(`${file}:${index + 1}`)
    }
  })
}
const joined = []
let ambiguousMatches = 0
for (const trade of trades) {
  const snapshot = snapshots.get(trade.entryAnalysisId)
  if (snapshot?.analysis?.environmentContext) {
    if (snapshot.strategyId !== trade.strategyId || snapshot.symbol !== trade.symbol || snapshot.analysis.direction !== trade.direction) {
      throw new Error(`决策档案与交易不一致：${trade.id}`)
    }
    joined.push({ ...trade, env: snapshot.analysis.environmentContext, match: 'analysisId' })
    continue
  }
  const candidates = aiRows.filter(row => row.strategyId === trade.strategyId && row.symbol === trade.symbol
    && row.timestamp <= trade.openTime && trade.openTime - row.timestamp <= 120000
    && row.direction === trade.direction && row.reasoning === trade.aiReasoning
    && row.confidence === trade.entryConfidence && row.scoreBreakdown?.finalScore === trade.entryScore)
  if (candidates.length === 1) joined.push({ ...trade, env: candidates[0].environmentContext, match: 'unique_exact_reasoning_120s' })
  else if (candidates.length > 1) ambiguousMatches++
}

// 仅观察实际发生的后续交易，不能把删除这些记录后的和当作新的完整策略回测收益。
const reentries = trades.map(trade => {
  const previous = trades.filter(old => old.symbol === trade.symbol && old.id !== trade.id && old.closeTime <= trade.openTime).at(-1)
  return { ...trade, previous, gapMinutes: previous ? (trade.openTime - previous.closeTime) / 60000 : null }
})
const entryKeys = trades.map(trade => `${trade.symbol}|${trade.strategyId}|${trade.openTime}`)
const settlements = trades.filter(trade => finite(trade.grossRealizedPnl))
const maxSettlementResidual = Math.max(...settlements.map(trade => Math.abs(
  trade.pnl - trade.grossRealizedPnl + trade.totalCommission - (trade.fundingFee || 0))))

const metrics = {
  source: { files, sourceCount, uniqueCount: trades.length, rangeBeijing: [localTime(Math.min(...trades.map(trade => trade.openTime))), localTime(Math.max(...trades.map(trade => trade.closeTime)))] },
  definitions: {
    pnl: '交易记录净利，USDT；不等于账户收益率',
    grossPnl: '有 grossRealizedPnl 时使用原值；旧记录以净利+手续费-已记录资金费反推',
    profitFactor: '盈利交易净利总和 / 亏损交易净利总和的绝对值',
    R: 'abs(entryPrice - stopLossPrice) * quantity；使用初始止损',
    MFE: '历史监控采样的最大浮盈，只用于归因，不能作为入场过滤变量',
    environmentJoin: '优先 analysisId；其他仅使用120秒内方向、理由、置信度、评分均相同的唯一记录',
  },
  quality: {
    duplicateIds: sourceCount - trades.length,
    repeatedEntryKeys: entryKeys.length - new Set(entryKeys).size,
    maxSettlementResidual,
    legacySettlementCount: trades.filter(trade => !trade.settlementSource).length,
    estimatedSettlementCount: trades.filter(trade => trade.settlementSource === 'estimated').length,
    supportResistanceCount: trades.filter(trade => trade.entrySupportResistance).length,
    fullDecisionJoinedCount: joined.filter(trade => trade.match === 'analysisId').length,
    environmentJoinedCount: joined.length,
    environmentAnalysisRecords: aiRows.length,
    ambiguousMatches, malformedAiLines,
  },
  overall: stats(trades),
  monthly: group(trades, trade => localTime(trade.closeTime).slice(0, 7)),
  byStrategy: group(trades, trade => trade.strategyId),
  byStrategyMonth: group(trades, trade => localTime(trade.closeTime).slice(0, 7) + ' ' + trade.strategyId),
  byCategory: group(trades, trade => trade.closeCategory),
  bySettlement: group(trades, trade => trade.settlementSource || 'legacy'),
  byEraFields: group(trades, trade => finite(trade.entryIndicators?.PDI) ? 'DMI字段期'
    : finite(trade.entryIndicators?.EMA60) ? 'EMA20/60字段期' : finite(trade.entryIndicators?.EMA14) ? 'EMA14/50字段期' : '旧字段期'),
  adxAutomatic: group(automatic, trade => bucket(trade.entryIndicators?.ADX, [20, 25, 30, 40])),
  adxDmiPeriod: group(dmi, trade => bucket(trade.entryIndicators?.ADX, [20, 25, 30, 40])),
  volumeAutomatic: group(automatic, trade => bucket(trade.entryIndicators?.EstimatedVolumeEmaRatioPercent, [100, 150, 250, 400])),
  stretchDmiPeriod: group(dmi, trade => bucket(stretch(trade), [0, 1, 2, 3])),
  losingTradesMfe: {
    total: losers.length,
    belowQuarterR: losers.filter(trade => mfeR(trade) < 0.25).length,
    belowHalfR: losers.filter(trade => mfeR(trade) < 0.5).length,
    atLeastOneR: losers.filter(trade => mfeR(trade) >= 1).length,
    atLeastOnePointTwoR: losers.filter(trade => mfeR(trade) >= 1.2).length,
  },
  environmentLabels: group(joined, trade => trade.env.structure.label),
  environmentTones: group(joined, trade => trade.env.structure.tone),
  environmentTonesFullDecisionOnly: group(joined.filter(trade => trade.match === 'analysisId'), trade => trade.env.structure.tone),
  sameSideWithinHourAfterInitialStop: stats(reentries.filter(trade => trade.previous?.closeCategory === 'stop_loss'
    && trade.gapMinutes <= 60 && trade.direction === trade.previous.direction)),
  sinceCurrentUpdatedAt: group(trades.filter(trade => {
    const strategy = strategies.find(strategy => strategy.id === trade.strategyId)
    return strategy && trade.openTime >= Date.parse(strategy.updatedAt)
  }), trade => trade.strategyId),
  environmentTrades: joined.map(trade => ({ id: trade.id, symbol: trade.symbol, strategyId: trade.strategyId,
    openTimeBeijing: localTime(trade.openTime), direction: trade.direction, pnl: trade.pnl,
    confidence: trade.entryConfidence, label: trade.env.structure.label, tone: trade.env.structure.tone, match: trade.match })),
}

if (process.argv.includes('--check-kline')) {
  // 严格以只读方式检查；不调用项目数据库初始化代码，避免写PRAGMA、迁移或清理数据。
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(path.join(dataDir, 'kline.db'), { readOnly: true })
  try {
    metrics.klineReadOnlyCheck = {
      quickCheck: database.prepare('PRAGMA quick_check(3)').all(),
      btcRanges: database.prepare("SELECT timeframe, COUNT(*) n, MIN(timestamp) oldest, MAX(timestamp) newest FROM kline_data WHERE symbol='BTCUSDT' GROUP BY timeframe")
        .all().map(row => ({ ...row, oldestBeijing: localTime(row.oldest * 1000), newestBeijing: localTime(row.newest * 1000) })),
    }
    // 定点查询验证读取错误，所有异常均保留原文，不能把损坏当作空K线。
    try {
      const rows = database.prepare("SELECT timestamp,close FROM kline_data WHERE symbol='ZECUSDT' AND timeframe='15m' ORDER BY timestamp").all()
      metrics.klineReadOnlyCheck.zec15mRows = rows.length
    } catch (error) {
      metrics.klineReadOnlyCheck.zec15mReadError = error.message
    }
  } finally {
    database.close()
  }
}

// 汇总恒等式同时校验分组逻辑及手续费符号，不需要启动应用或完整构建。
const tolerance = 0.00001
if (maxSettlementResidual > tolerance) throw new Error('结算恒等式不成立')
if (Math.abs(sum(Object.values(metrics.monthly).map(month => month.netPnl)) - metrics.overall.netPnl) > tolerance) throw new Error('月度净利与总净利不一致')
if (Math.abs(sum(Object.values(metrics.byStrategy).map(strategy => strategy.netPnl)) - metrics.overall.netPnl) > tolerance) throw new Error('策略净利与总净利不一致')
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ source: metrics.source, overall: metrics.overall, quality: metrics.quality,
  klineReadOnlyCheck: metrics.klineReadOnlyCheck, output: path.join(outDir, 'metrics.json') }, null, 2))
