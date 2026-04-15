import fs from "fs"

const input = "./data/strategy-analysis.json"
const configPath = "./data/bot-config.json"
const output = "./test/trade-history.pine"

const trades = JSON.parse(fs.readFileSync(input, "utf8"))
const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

// 根据 strategyMode 确定 EMA 参数
const isMediumTerm = config.strategyMode === "medium_term"
const emaPeriods = config.indicatorsConfig?.emaPeriods || {}
const strategyMode = config.strategyMode || "short_term"
const emaFast = emaPeriods?.[strategyMode]?.fast || (isMediumTerm ? 50 : 20)
const emaSlow = emaPeriods?.[strategyMode]?.slow || (isMediumTerm ? 200 : 60)

const emaDeviationThreshold = config.indicatorsConfig?.predictiveCross?.distancePercent || 0.0008
const emaDeviationThresholdPercent = emaDeviationThreshold * 100

const openTimes = []
const closeTimes = []

const entryPrices = []
const exitPrices = []

const stopLoss = []
const tp1 = []
const tp2 = []

const directions = []
const symbols = []
const pnl = []
const leverage = []
const entryRSIs = []
const entryADXs = []
const averageATRs = []
const exitReasons = []

for (const t of trades) {

  openTimes.push(t.openTime)
  closeTimes.push(t.closeTime)

  entryPrices.push(t.entryPrice)
  exitPrices.push(t.exitPrice)

  stopLoss.push(t.stopLossPrice.toFixed(3))
  tp1.push(t.takeProfit1Price.toFixed(3))
  tp2.push(t.takeProfit2Price.toFixed(3))

  directions.push(`"${t.direction}"`)
  symbols.push(`"${t.symbol}"`)

  pnl.push(t.pnlPercentage.toFixed(2))

  leverage.push(t.actualLeverage)
  
  // 添加新字段 - 对 RSI、ADX、ATR 保留1位小数
  entryRSIs.push((t.entryRSI || 0).toFixed(1))
  entryADXs.push((t.entryADX15m || 0).toFixed(1))
  averageATRs.push((t.averageATR || 0).toFixed(1))
  exitReasons.push(`"${t.exitReason || 'N/A'}"`)
}

const pine = `//@version=6
indicator("Trade History Dashboard", overlay=true, max_labels_count=500, max_lines_count=500)

// EMA 移动平均线 (根据 strategyMode 配置: ${isMediumTerm ? 'medium_term' : 'short_term'})
emaFastPeriod = ${emaFast}
emaSlowPeriod = ${emaSlow}
emaFastLine = ta.ema(close, emaFastPeriod)
emaSlowLine = ta.ema(close, emaSlowPeriod)

plot(emaFastLine, "EMA ${emaFast}", color=color.blue, linewidth=2)
plot(emaSlowLine, "EMA ${emaSlow}", color=color.orange, linewidth=2)

// ====================== EMA${emaFast}-EMA${emaSlow} 偏离率 ======================
emaDiffDeviation = (emaFastLine - emaSlowLine) / emaSlowLine * 100

// 分级颜色逻辑（核心优化）
color devColor =
     emaDiffDeviation > ${emaDeviationThresholdPercent}  ? color.red :
     emaDiffDeviation < -${emaDeviationThresholdPercent} ? color.red :
     color.green

// 只保留一个标签（避免爆 label）
var label emaLabel = na

if barstate.islast
    label.delete(emaLabel)
    emaLabel := label.new(
        bar_index,
        high,
        "EMA${emaFast}-EMA${emaSlow}: " + str.tostring(emaDiffDeviation, "#.##") + "%",
        style = label.style_label_right,
        color = devColor,
        textcolor = color.white,
        size = size.normal
    )

// ====================== 原始数据 ======================

var int[] openTimes = array.from(${openTimes.join(",")})
var int[] closeTimes = array.from(${closeTimes.join(",")})

var float[] entryPrices = array.from(${entryPrices.join(",")})
var float[] exitPrices = array.from(${exitPrices.join(",")})

var float[] stopLoss = array.from(${stopLoss.join(",")})
var float[] tp1 = array.from(${tp1.join(",")})
var float[] tp2 = array.from(${tp2.join(",")})

var string[] directions = array.from(${directions.join(",")})
var string[] symbols = array.from(${symbols.join(",")})
var float[] pnl = array.from(${pnl.join(",")})

var int[] leverage = array.from(${leverage.join(",")})
var float[] entryRSIs = array.from(${entryRSIs.join(",")})
var float[] entryADXs = array.from(${entryADXs.join(",")})
var float[] averageATRs = array.from(${averageATRs.join(",")})
var string[] exitReasons = array.from(${exitReasons.join(",")})

for i = 0 to array.size(openTimes) - 1

    openTime = array.get(openTimes, i)
    closeTime = array.get(closeTimes, i)

    entryPrice = array.get(entryPrices, i)
    exitPrice = array.get(exitPrices, i)

    sl = array.get(stopLoss, i)
    t1 = array.get(tp1, i)
    t2 = array.get(tp2, i)

    dir = array.get(directions, i)
    sym = array.get(symbols, i)
    lev = array.get(leverage, i)
    p = array.get(pnl, i)
    
    // 获取新字段
    entryRSI = array.get(entryRSIs, i)
    entryADX = array.get(entryADXs, i)
    avgATR = array.get(averageATRs, i)
    exitReason = array.get(exitReasons, i)

    tf = timeframe.in_seconds() * 1000
    openCond =openTime >= time and openTime < time + tf
    closeCond =closeTime >= time and closeTime < time + tf

    if openCond

        label.new(
            bar_index,
            entryPrice,
            dir + " 开仓" + "\\n" +
            str.tostring(entryPrice) + "\\n" +
            "Lev: " + str.tostring(lev) + "\\n" +
            "RSI: " + str.tostring(entryRSI, "#.##") + "\\n" +
            "ADX: " + str.tostring(entryADX, "#.##") + "\\n" +
            "ATR: " + str.tostring(avgATR, "#.##"),
            style = dir == "LONG" ? label.style_label_up : label.style_label_down,
            color = dir == "LONG" ? color.green : color.red,
            textcolor = color.white,
            size = size.small
        )

        // line.new(bar_index, entryPrice, bar_index, sl, color=color.red, width=1)
        // line.new(bar_index, entryPrice, bar_index, t1, color=color.green, width=1)
        // line.new(bar_index, entryPrice, bar_index, t2, color=color.green, width=1)

    if closeCond
        
        label.new(
            bar_index,
            exitPrice,
            "平仓\\n" +
            str.tostring(exitPrice) + "\\n" +
            "PnL: " + str.tostring(p) + "%\\n" +
            exitReason,
            style = label.style_label_left,
            color = color.yellow,
            textcolor = p > 0 ? color.green : color.red,
            size = size.small
        )

        // line.new(bar_index, entryPrice, bar_index, exitPrice, color=color.blue, width=2)
`

fs.writeFileSync(output, pine)

console.log("Pine Script 已生成 ->", output)