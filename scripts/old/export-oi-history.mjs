// ==================== OI 变化率交易历史导出脚本 ====================
// 用途：从 data/trade-history.json 导出交易记录（含 OI 变化率、入场指标、评分风控等），按开仓时间倒序（最新在前）
// 用法：
//   node scripts/export-oi-history.mjs                # 导出全部记录
//   node scripts/export-oi-history.mjs --limit 50     # 仅导出最近 50 条
//   node scripts/export-oi-history.mjs --out data/oi-history.txt  # 自定义输出路径
import fs from 'node:fs'

const TRADE_HISTORY = 'data/trade-history.json'
const DEFAULT_OUTPUT = 'data/oi-history-full.txt'

// 表头字段，使用 tab 分隔便于直接粘贴到表格
const HEADER = [
  '开仓时间',
  '策略',
  '交易对',
  '方向',
  '杠杆',
  '数量',
  '入场价',
  '退出价',
  'OI变化率',
  '入场分数',
  '置信度',
  '风险等级',
  'RSI',
  'ADX',
  'ATR',
  'EMA14',
  'EMA50',
  '成交量比',
  'ATR波动率%',
  '币安热度',
  '最终盈亏',
  '盈亏%',
  '最高价',
  '最低价',
  '最大浮盈',
  '最大浮盈%',
  '最大浮亏',
  '最大浮亏%',
  '持仓分钟',
  '平仓类型',
].join('\t')

/**
 * 从 aiReasoning 文本提取 OI 变化率（%）
 * 兼容现有几种格式：OI变化率1.15%、OI变化+0.48%、OI增加+0.62%、OI变化(0.51%)
 * 无法解析时返回 null
 */
function extractOIChangePercent(reasoning) {
  if (!reasoning) return null
  let m = reasoning.match(/(?:OI变化率|OI变化|OI增加)\s*\(?\s*([+-]?\d+(?:\.\d+)?)%/)
  if (m) return parseFloat(m[1])
  m = reasoning.match(/OI变化\(([^)]+)%\)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 从 aiReasoning 文本提取成交量比（成交量/成交量EMA均值，倍）
 * aiReasoning 中成交量比格式多样：
 *  - 预计成交量(89839.62)/成交量EMA12均值(64916.86)=1.38倍≥1.3倍✔️
 *  - 预计成交量(15036.71)≥1.3倍成交量EMA12(9845.17×1.3=12798.721) ✔️
 *  - 预计成交量49424.15≥成交量EMA均值(6938.32)1.3倍 ✔️
 *  - 预计成交量/12周期EMA均值3.97倍≥1.3倍 ✔️
 *  - 预计成交量/均量1.43≥1.3 ✔️
 * 优先通过「成交量值 / EMA均值」直接相除得到实际倍数；
 * 无法拿到数值对时才回退到文本直给的倍数（如 =1.38倍 / 3.97倍）
 */
function extractVolumeRatio(reasoning) {
  if (!reasoning) return null
  // 1) 数值对相除：成交量 / 成交量EMA均值 = 实际倍数
  const pair = reasoning.match(
    /预计成交量\(?([\d.,]+)\)?[\s\S]*?成交量EMA(?:\d+)?(?:均值)?\(([\d.,]+)[^)]*\)/
  )
  if (pair) {
    const vol = parseFloat(pair[1].replace(/,/g, ''))
    const ema = parseFloat(pair[2].replace(/,/g, ''))
    if (ema > 0) return vol / ema
  }
  // 2) 文本直给倍数：预计成交量/12周期EMA均值3.97倍≥1.3倍
  let m = reasoning.match(/预计成交量\/[^0-9]*(\d+(?:\.\d+)?)(?:倍)?≥/)
  if (m) return parseFloat(m[1])
  // 3) 等号直给倍数：=1.38倍（需在数值对匹配失败时才走到）
  m = reasoning.match(/=(\d+(?:\.\d+)?)倍/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 从 aiReasoning 文本提取 ATR 波动率（%）
 * 兼容带括号（ATR波动率(1.68%)）与不带括号（ATR波动率2.02%正常）两种格式
 * 无法解析时返回 null
 */
function extractAtrVolatility(reasoning) {
  if (!reasoning) return null
  const m = reasoning.match(/ATR波动率\(?([+-]?\d+(?:\.\d+)?)%/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 从 aiReasoning 文本提取币安广场热度
 * 兼容格式：
 *  - 币安广场热度(79)-33.1%📉下降（带括号热度值）
 *  - 币安广场热度58+11.5%增长（不带括号热度值）
 *  - 币安广场热度-22.4%下降（缺失热度值，仅变化率）
 *  - 币安热度+21.7%看涨（简写形式）
 * 返回 "79(-33.1%)" / "-(-22.4%)" 格式，便于阅读；无法解析时返回 null
 */
function extractBinanceHeat(reasoning) {
  if (!reasoning) return null
  // 优先匹配带热度值：括号/无括号均可
  const m = reasoning.match(/币安(?:广场)?热度\(?(\d+)\)?\s*([+-]?\d+(?:\.\d+)?)%/)
  if (m) return `${m[1]}(${m[2]}%)`
  // 回退：缺失热度值，仅变化率
  const m2 = reasoning.match(/币安(?:广场)?热度\s*([+-]?\d+(?:\.\d+)?)%/)
  return m2 ? `-(${m2[1]}%)` : null
}

/**
 * 格式化数值：按数量级自适应小数位数
 * null / NaN 返回 '-'，避免污染导出数据
 */
function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  const abs = Math.abs(n)
  let digits = 4
  if (abs >= 1000) digits = 2
  else if (abs >= 100) digits = 3
  else if (abs < 0.01) digits = 6
  return n.toFixed(digits)
}

/**
 * 格式化百分比：带符号、保留 2 位小数
 */
function formatPercent(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

/**
 * 格式化时间戳为 MM-DD HH:mm（UTC）
 */
function formatTime(ts) {
  return new Date(ts).toISOString().slice(5, 16).replace('T', ' ')
}

/**
 * 解析命令行参数：--limit N / --out PATH
 */
function parseArgs(argv) {
  const args = { limit: null, out: DEFAULT_OUTPUT }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[i + 1], 10)
      i++
    } else if (argv[i] === '--out' && argv[i + 1]) {
      args.out = argv[i + 1]
      i++
    }
  }
  return args
}

/**
 * 主流程：读取交易历史 -> 排序 -> 格式化 -> 写入文件
 */
function main() {
  const { limit, out } = parseArgs(process.argv.slice(2))

  const trades = JSON.parse(fs.readFileSync(TRADE_HISTORY, 'utf8'))
  let sorted = [...trades].sort((a, b) => b.openTime - a.openTime)
  if (limit && limit > 0) {
    sorted = sorted.slice(0, limit)
  }

  const rows = sorted.map((t) => {
    // 从 aiReasoning 提取入场时的 OI 变化率（历史记录未单独存该字段）
    const oiChange = extractOIChangePercent(t.aiReasoning)
    const volumeRatio = extractVolumeRatio(t.aiReasoning)
    const atrVolatility = extractAtrVolatility(t.aiReasoning)
    const binanceHeat = extractBinanceHeat(t.aiReasoning)
    const indicators = t.entryIndicators || {}
    return [
      formatTime(t.openTime),
      t.strategyId,
      t.symbol,
      t.direction || 'LONG',
      t.leverage != null ? `${t.leverage}x` : '-',
      formatNumber(t.quantity),
      formatNumber(t.entryPrice),
      formatNumber(t.exitPrice),
      oiChange != null ? formatPercent(oiChange) : 'N/A',
      t.entryScore != null ? t.entryScore : '-',
      t.entryConfidence != null ? `${t.entryConfidence}%` : '-',
      t.entryRiskLevel || '-',
      indicators.RSI != null ? indicators.RSI.toFixed(2) : '-',
      indicators.ADX != null ? indicators.ADX.toFixed(2) : '-',
      formatNumber(indicators.ATR),
      formatNumber(indicators.EMAEMA14),
      formatNumber(indicators.EMAEMA50),
      volumeRatio != null ? volumeRatio.toFixed(2) + '倍' : '-',
      atrVolatility != null ? atrVolatility.toFixed(2) + '%' : '-',
      binanceHeat || '-',
      t.pnl != null ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(4) : '-',
      formatPercent(t.pnlPercentage),
      formatNumber(t.highestPrice),
      formatNumber(t.lowestPrice),
      formatNumber(t.maxFloatingProfit),
      formatPercent(t.maxFloatingProfitPercent),
      formatNumber(t.maxFloatingLoss),
      formatPercent(t.maxFloatingLossPercent),
      t.holdingMinutes != null ? `${t.holdingMinutes}min` : '-',
      t.closeCategory || '-',
    ].join('\t')
  })

  const content = [HEADER, ...rows].join('\n') + '\n'
  fs.writeFileSync(out, content, 'utf8')

  const naCount = rows.filter((r) => r.includes('N/A')).length
  console.log(`已导出 ${rows.length} 条 -> ${out}`)
  if (naCount > 0) {
    console.log(`注意：${naCount} 条记录缺少 OI 变化率文本（显示 N/A）`)
  }
}

main()