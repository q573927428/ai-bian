// ==================== ATR 前后端一致性验证测试（最简方案） ====================
// 验证前端 ema-calculator.ts 的 calculateATR：
// 1. 全量递推（Wilder 平滑 1/period）与后端 technicalindicators 库逐值一致
// 2. 除前 period-1 根外，每根K线都有有效的 ATR 值（无 0 填充的历史段）
import { ATR } from 'technicalindicators'

// 与 app/utils/ema-calculator.ts 完全一致的前端实现（全量递推，跳过首TR）
function calculateATRFrontend(klineData, period = 14) {
  if (klineData.length === 0 || period <= 0) return []
  const atrValues = []
  const trueRanges = []
  for (let i = 1; i < klineData.length; i++) {
    const current = klineData[i]
    const previous = klineData[i - 1]
    if (!current || !previous) continue
    const tr1 = current.h - current.l
    const tr2 = Math.abs(current.h - previous.c)
    const tr3 = Math.abs(current.l - previous.c)
    trueRanges.push(Math.max(tr1, tr2, tr3))
  }
  if (trueRanges.length < period) return []
  let sum = 0
  for (let i = 0; i < period; i++) sum += trueRanges[i] || 0
  const firstATR = sum / period
  atrValues.push(firstATR)
  const multiplier = 1 / period
  for (let i = period; i < trueRanges.length; i++) {
    const previousATR = atrValues[atrValues.length - 1] || 0
    const currentTR = trueRanges[i] || 0
    atrValues.push((currentTR - previousATR) * multiplier + previousATR)
  }
  const emptyCount = klineData.length - atrValues.length
  return [...new Array(Math.max(0, emptyCount)).fill(0), ...atrValues]
}

function generateMockKlines(count = 300) {
  const klines = []
  let price = 50000
  for (let i = 0; i < count; i++) {
    const open = price * (1 + (Math.random() - 0.5) * 0.02)
    const close = open * (1 + (Math.random() - 0.5) * 0.03)
    const high = Math.max(open, close) * (1 + Math.random() * 0.01)
    const low = Math.min(open, close) * (1 - Math.random() * 0.01)
    klines.push({ t: 1700000000 + i * 3600, o: open, h: high, l: low, c: close, v: Math.random() * 1000 })
    price = close
  }
  return klines
}

let passed = 0
let failed = 0

// 测试1：全量递推多个值序列与后端逐值一致
console.log('\n========== 测试1：全量递推与后端逐值一致 ==========')
{
  const klines = generateMockKlines(300)
  const front = calculateATRFrontend(klines, 14)
  const back = ATR.calculate({ period: 14, high: klines.map(k => k.h), low: klines.map(k => k.l), close: klines.map(k => k.c) })
  const frontEffective = front.slice(14)
  let fail = 0
  let maxDiff = 0
  for (let i = 0; i < back.length; i++) {
    const diff = Math.abs((frontEffective[i] ?? 0) - (back[i] ?? 0))
    maxDiff = Math.max(maxDiff, diff)
    if (diff >= 1e-9) fail++
  }
  console.log(`  全量300根: 最新ATR 前端=${(frontEffective[frontEffective.length - 1] ?? 0).toFixed(6)} 后端=${(back[back.length - 1] ?? 0).toFixed(6)}, 最大差异=${maxDiff.toExponential(3)}, 不一致数=${fail}`)
  if (fail === 0) { passed++ } else { failed++ }
}

// 测试2：无 0 填充的历史段——除前14根（数据不足周期）外每根都有有效 ATR
console.log('\n========== 测试2：每根K线都有有效 ATR 值（无历史段空白）==========')
{
  const klines = generateMockKlines(300)
  const front = calculateATRFrontend(klines, 14)
  // 前端返回数组与 klineData 等长，前 14 根为 0（不足周期），其余必须有非 0 有效值
  let zeroInValidRange = 0
  for (let i = 14; i < front.length; i++) {
    if (!front[i] || front[i] <= 0) zeroInValidRange++
  }
  const totalValid = front.length - 14
  console.log(`  有效区间[14..${front.length - 1}]: 共 ${totalValid} 根, 其中 0 值 ${zeroInValidRange} 根`)
  console.log(`  前 3 根值: ${front.slice(14, 17).map(v => v.toFixed(4)).join(', ')}`)
  if (zeroInValidRange === 0) { passed++ } else { failed++ }
}

// 测试3：全量递推最新值与"最近500根递推"一致（证明与后端 requiredCandles 窗口一致）
console.log('\n========== 测试3：全量递推 vs 最近500根递推（最新值一致性）==========')
{
  const klines = generateMockKlines(800)
  const frontFull = calculateATRFrontend(klines, 14)
  const frontWindow = calculateATRFrontend(klines.slice(-500), 14)
  const fullLatest = frontFull[frontFull.length - 1] ?? 0
  const winLatest = frontWindow[frontWindow.length - 1] ?? 0
  const diff = Math.abs(fullLatest - winLatest)
  console.log(`  全量800根: ${fullLatest.toFixed(8)}, 最近500根: ${winLatest.toFixed(8)}, 绝对差=${diff.toExponential(3)}`)
  if (diff < 1e-6) { passed++ } else { failed++ }
}

console.log(`\n========== 测试结果: ${passed} 通过, ${failed} 失败 ==========\n`)
process.exit(failed > 0 ? 1 : 0)