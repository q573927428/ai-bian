// ==================== 补齐历史订单 OI 变化率与预计成交量比 ====================
// 用途：从 data/trade-history.json 的 aiReasoning 文本中提取 OIChangePercent 与 EstimatedVolumeEmaRatioPercent
//      并为缺失的订单补齐（写入 entryIndicators）
// 用法：
//   node scripts/backfill-oi-volume-ratio.mjs --dry-run   # 仅预览提取结果，不写入
//   node scripts/backfill-oi-volume-ratio.mjs             # 补齐并写回 trade-history.json
import fs from 'node:fs'

const TRADE_HISTORY = 'data/trade-history.json'

/**
 * 从 aiReasoning 文本提取 OI 变化率（%）
 * 兼容多种写法：OI变化率(1.85%) / OI变化0.91% / OI增加+1.12% / OI增1.75% / OI变化(0.24%)
 * 无法解析时返回 null
 */
function extractOIChangePercent(reasoning) {
  if (!reasoning) return null
  let m = reasoning.match(/(?:OI变化率|OI变化|OI增加|OI增)\s*\(?\s*([+-]?\d+(?:\.\d+)?)%/)
  if (m) return parseFloat(m[1])
  m = reasoning.match(/OI变化\(([^)]+)%\)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 解析数值字符串，支持千分位逗号与 M/B 后缀（如 127.6M）
 */
function parseNum(raw) {
  if (!raw) return null
  const upper = raw.toUpperCase()
  let v = parseFloat(raw.replace(/,/g, '').replace(/[MB]/g, ''))
  if (Number.isNaN(v)) return null
  if (upper.includes('M')) v *= 1000000
  if (upper.includes('B')) v *= 1000000000
  return v
}

/**
 * 在 预计成交量值 之后查找 EMA 参考值（成交量EMA均量等）
 * 依次尝试：括号值（EMA关键词后）→ 裸值（EMA关键词后）→ X倍(值) → ≥值
 */
function findEmaValue(reasoning, startIndex) {
  const after = reasoning.slice(startIndex)

  // 1) EMA 关键词 + 可选"的" + 可选倍数 + 括号值（如 成交量EMA12(12537.09) / 成交量EMA(12周期312379.90) / 成交量EMA均值(14056.95)）
  let m = after.match(
    /(?:成交量EMA(?:\d+)?(?:均值)?|成交(?:量)?MA|EMA成交量|成交量均值|成交量12周期EMA|均量|均价|均值|容量均值|EMA均量|EMA均值|EMA量|成交量)\s*(?:的)?\s*(?:\d+(?:\.\d+)?倍)?\s*[(（]\s*(?:12周期)?\s*([\d.,]+[MB]?)/i
  )
  if (m) {
    const v = parseNum(m[1])
    if (v != null && v > 50) return v
  }

  // 2) EMA 关键词 + 裸值（无括号，如 成交量EMA2521662.62 / 成交量EMA均值12周期58590.35）
  m = after.match(
    /(?:成交量EMA(?:\d+)?(?:均值)?|成交量12周期EMA|成交(?:量)?MA|EMA成交量|均量|均价|均值|容量均值|EMA均量|EMA均值|EMA量|成交量)\s*(?:12周期)?\s*(?:[\d.]+倍)?\s*([\d.,]+[MB]?)/i
  )
  if (m) {
    const v = parseNum(m[1])
    if (v != null && v > 50) return v
  }

  // 3) X倍[(（](值)>50（无关键词，如 1.6倍(365390.22)）
  m = after.match(/\d+(?:\.\d+)?倍\s*[(（]\s*(?:12周期)?\s*([\d.,]+)/)
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''))
    if (v > 50) return v
  }

  // 4) ≥/>= 后裸值（无关键词，如 预计成交量6487.38≥5593.58）
  m = after.match(/[≥>]=?\s*([\d.,]+[MB]?)/i)
  if (m) {
    const v = parseNum(m[1])
    if (v != null && v > 50) return v
  }

  return null
}

/**
 * 从 aiReasoning 文本提取预计成交量 / 成交量EMA均值 的百分比比例
 * 优先通过「预计成交量值 / EMA平均值」直接相除得到精确比例（×100）
 * 无法拿到数值对时才回退到文本直给的倍数（如 1.45倍 → 145）
 * 无法解析时返回 null
 */
function extractVolumeEmaRatioPercent(reasoning) {
  if (!reasoning) return null

  // ---------- 方法A：量值 / EMA值 精确相除 ----------
  const volMatch = reasoning.match(/预计(?:K线结束|K线)?(?:量|成交量)\s*[(（]?\s*([\d.,]+[MB]?)\s*[)）]?/i)
  if (volMatch) {
    const afterVol = reasoning.slice(volMatch.index + volMatch[0].length)
    const nextChar = afterVol.trimStart()[0] || ''
    // 排除量值本身是倍数的情况：预计成交量1.98倍 / 预计成交量(5.52倍)
    if (nextChar !== '倍') {
      const vol = parseNum(volMatch[1])
      if (vol != null && vol > 1) {
        const ema = findEmaValue(reasoning, volMatch.index + volMatch[0].length)
        if (ema != null && ema > 0) {
          const ratio = (vol / ema) * 100
          // 合理范围：0.5倍 ~ 500倍
          if (ratio > 50 && ratio < 50000) return ratio
        }
      }
    }
  }

  // ---------- 方法B：文本直给倍数 ----------
  const afterPrefix = reasoning.match(/预计(?:K线结束|K线)?(?:量|成交量)(.*)$/)
  const segment = afterPrefix ? afterPrefix[1] : reasoning

  // B1: / 后括号倍数（预计成交量/12周期EMA(1.35倍) / 预计成交量/成交量EMA均值(1.47倍)）
  let m = segment.match(/\/(?:[^()]*?)\((\d+(?:\.\d+)?)\s*倍?\)/)
  if (m) return parseFloat(m[1]) * 100

  // B2: 量值本身就是倍数（预计成交量1.98倍 / 预计成交量(5.52倍)）
  m = reasoning.match(/预计(?:K线结束|K线)?(?:量|成交量)\s*[(（]?\s*(\d+(?:\.\d+)?)\s*倍/)
  if (m) return parseFloat(m[1]) * 100

  // B3: / 后 X.XX倍 直接文本（预计成交量/成交量EMA均值1.45倍 / 预计成交量/12周期EMA2.75倍）
  m = segment.match(/\/(?:[^≥]*?)(\d+(?:\.\d+)?)\s*倍(?![−\d.()（])/)
  if (m) return parseFloat(m[1]) * 100

  // B4: / 后 X.XX≥（无倍字，预计成交量/EMA均值4.74≥ / 预计成交量/均量1.43≥）
  m = segment.match(/\/(?:[^≥]*?)(\d+(?:\.\d+)?)\s*≥/)
  if (m) return parseFloat(m[1]) * 100

  // B5: =X.XX倍 / 括号 X.XX倍（预计成交量...=1.38倍 / 1.53倍(1.65倍) 取括号内 1.65）
  m = segment.match(/=(\d+(?:\.\d+)?)\s*倍/)
  if (m) return parseFloat(m[1]) * 100
  m = segment.match(/\((\d+(?:\.\d+)?)\s*倍\)/)
  if (m) return parseFloat(m[1]) * 100

  return null
}

/**
 * 补齐单条记录：返回是否发生变更
 */
function backfillRecord(trade) {
  if (!trade.entryIndicators) trade.entryIndicators = {}
  const indicators = trade.entryIndicators
  let changed = false

  if (indicators.OIChangePercent == null) {
    const oi = extractOIChangePercent(trade.aiReasoning)
    if (oi != null) {
      indicators.OIChangePercent = oi
      changed = true
    }
  }

  if (indicators.EstimatedVolumeEmaRatioPercent == null) {
    const ratio = extractVolumeEmaRatioPercent(trade.aiReasoning)
    if (ratio != null) {
      indicators.EstimatedVolumeEmaRatioPercent = ratio
      changed = true
    }
  }

  return changed
}

function main() {
  const isDryRun = process.argv.includes('--dry-run')
  const trades = JSON.parse(fs.readFileSync(TRADE_HISTORY, 'utf8'))

  let updated = 0
  const failures = []

  for (const t of trades) {
    const changed = backfillRecord(t)
    if (changed) updated++
    const ind = t.entryIndicators || {}
    if (changed && (ind.OIChangePercent == null || ind.EstimatedVolumeEmaRatioPercent == null)) {
      failures.push(`[${t.id}] ${t.symbol} OI=${ind.OIChangePercent} VolRatio=${ind.EstimatedVolumeEmaRatioPercent}`)
    }
  }

  // 统计补齐后的全局缺失情况
  let oiMissing = 0
  let volMissing = 0
  for (const t of trades) {
    const ind = t.entryIndicators || {}
    if (ind.OIChangePercent == null) oiMissing++
    if (ind.EstimatedVolumeEmaRatioPercent == null) volMissing++
  }

  console.log(`共 ${trades.length} 条记录`)
  console.log(`本次变更：${updated} 条`)
  console.log(`补齐后 OIChangePercent 缺失：${oiMissing}`)
  console.log(`补齐后 EstimatedVolumeEmaRatioPercent 缺失：${volMissing}`)

  if (failures.length > 0) {
    console.log(`\n仍有缺失的记录 ${failures.length} 条：`)
    failures.forEach((f) => console.log('  ' + f))
  }

  if (isDryRun) {
    console.log('\n[DRY-RUN] 未写入文件')
  } else {
    fs.writeFileSync(TRADE_HISTORY, JSON.stringify(trades, null, 2), 'utf8')
    console.log(`\n已写回 ${TRADE_HISTORY}（更新 ${updated} 条）`)
  }
}

main()