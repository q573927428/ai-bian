import { EMA, RSI, ADX, ATR } from 'technicalindicators'
import type { OHLCV, TechnicalIndicators, BotConfig, TradingSignal } from '../../types'
import { BinanceService } from './binance'
import { getEMAPeriodConfig } from './indicators-shared'

/**
 * 计算技术指标
 */
export async function calculateIndicators(
  binance: BinanceService,
  symbol: string,
  config?: BotConfig,
  candlesMain?: OHLCV[]
): Promise<TechnicalIndicators> {
  try {
    // 统一获取EMA配置（复用工具函数，消除重复代码）
    const { strategyMode, fast: emaFast, medium: emaMedium, slow: emaSlow } = getEMAPeriodConfig(config)
    
    // 根据策略模式选择K线周期
    const mainTF = strategyMode === 'medium_term' ? '1h' : '15m'
    const secondaryTF = strategyMode === 'medium_term' ? '4h' : '1h'
    const tertiaryTF = strategyMode === 'medium_term' ? '1d' : '4h'

    // K线数量从配置读取，默认300根，中长期策略需要足够K线数据来计算EMA200等指标
    const requiredCandles = config?.indicatorsConfig?.requiredCandles || 300
    
    // 获取不同周期的K线数据
    const mainCandles = candlesMain || await binance.fetchOHLCV(symbol, mainTF, undefined, requiredCandles)
    const candlesSecondary = await binance.fetchOHLCV(symbol, secondaryTF, undefined, requiredCandles)
    const candlesTertiary = await binance.fetchOHLCV(symbol, tertiaryTF, undefined, requiredCandles)

    const closesMain = mainCandles.map(c => c.close)
    const highsMain = mainCandles.map(c => c.high)
    const lowsMain = mainCandles.map(c => c.low)

    // 检查是否有足够的数据计算EMA
    if (closesMain.length < emaSlow) {
      throw new Error(`K线数据不足，需要至少${emaSlow}根K线来计算EMA${emaSlow}，当前只有${closesMain.length}根`)
    }

    // 计算EMA（基于主周期）
    const emaFastValuesFull = EMA.calculate({ period: emaFast, values: closesMain })
    const emaMediumValuesFull = EMA.calculate({ period: emaMedium, values: closesMain })
    const emaSlowValuesFull = EMA.calculate({ period: emaSlow, values: closesMain })

    // 获取EMA值，如果计算失败则使用最后一个收盘价作为替代
    const getEMAValue = (emaValues: number[], defaultValue: number) => {
      if (emaValues.length === 0) {
        // 如果EMA计算失败，使用最后一个收盘价作为替代
        return closesMain[closesMain.length - 1] || defaultValue
      }
      return emaValues[emaValues.length - 1] || defaultValue
    }

    // 计算RSI（基于主周期）
    const rsiValues = RSI.calculate({ period: 14, values: closesMain })

    // 计算ATR（基于主周期）
    const atrValues = ATR.calculate({ period: 14, high: highsMain, low: lowsMain, close: closesMain })

    // 计算ADX（多周期）
    const adxMainValues = ADX.calculate({
      high: mainCandles.map(c => c.high),
      low: mainCandles.map(c => c.low),
      close: mainCandles.map(c => c.close),
      period: 14,
    })

    const adxSecondaryValues = ADX.calculate({
      high: candlesSecondary.map(c => c.high),
      low: candlesSecondary.map(c => c.low),
      close: candlesSecondary.map(c => c.close),
      period: 14,
    })

    const adxTertiaryValues = ADX.calculate({
      high: candlesTertiary.map(c => c.high),
      low: candlesTertiary.map(c => c.low),
      close: candlesTertiary.map(c => c.close),
      period: 14,
    })

    // 根据策略模式映射ADX字段
    let adx15m, adx1h, adx4h
    if (strategyMode === 'medium_term') {
      // 中长期策略：1h为主周期，4h为次要周期，1d为第三周期
      adx15m = adxMainValues[adxMainValues.length - 1]?.adx || 0      // 1h
      adx1h = adxSecondaryValues[adxSecondaryValues.length - 1]?.adx || 0  // 4h
      adx4h = adxTertiaryValues[adxTertiaryValues.length - 1]?.adx || 0    // 1d
    } else {
      // 短期策略：15m为主周期，1h为次要周期，4h为第三周期
      adx15m = adxMainValues[adxMainValues.length - 1]?.adx || 0      // 15m
      adx1h = adxSecondaryValues[adxSecondaryValues.length - 1]?.adx || 0  // 1h
      adx4h = adxTertiaryValues[adxTertiaryValues.length - 1]?.adx || 0    // 4h
    }

    // 使用getEMAValue函数获取EMA值
    const emaFastValue = getEMAValue(emaFastValuesFull, closesMain[closesMain.length - 1] || 0)
    const emaMediumValue = getEMAValue(emaMediumValuesFull, closesMain[closesMain.length - 1] || 0)
    const emaSlowValue = getEMAValue(emaSlowValuesFull, closesMain[closesMain.length - 1] || 0)

    // 只保留最后10个EMA值，减少状态文件体积（程序只需要最后2个值用于金叉死叉判断）
    const emaFastValues = emaFastValuesFull.slice(-3)
    const emaMediumValues = emaMediumValuesFull.slice(-3)
    const emaSlowValues = emaSlowValuesFull.slice(-3)

    // 计算ADX斜率（当前值 - N周期前的值）
    const adxSlopePeriod = config?.riskConfig?.takeProfit?.adxSlopePeriod || 3
    const currentADX = adxMainValues[adxMainValues.length - 1]?.adx || 0
    const previousADXIndex = Math.max(0, adxMainValues.length - 1 - adxSlopePeriod)
    const previousADX = adxMainValues[previousADXIndex]?.adx || currentADX
    const adxSlope = currentADX - previousADX

    // OI持仓量计算
    let openInterest = 0
    let openInterestChangePercent = 0
    let openInterestTrend: 'increasing' | 'decreasing' | 'flat' = 'flat'
    
    const oiConfig = config?.indicatorsConfig?.openInterest
    if (oiConfig?.enabled) {
      try {
        // 根据策略模式获取OI历史周期
        const oiChangePeriod = oiConfig.changePeriod[strategyMode] || (strategyMode === 'medium_term' ? 24 : 96)
        
        // 获取当前OI和历史OI数据
        const currentOI = await binance.fetchOpenInterest(symbol)
        const oiHistory = await binance.fetchOpenInterestHistory(symbol, mainTF, undefined, oiChangePeriod)
        
        openInterest = currentOI.openInterest
        
        // 计算OI变化率
        if (oiHistory.length >= oiChangePeriod) {
          const oldOI = oiHistory[0]?.openInterest ?? 0
          let rawChangeRate = 0
          if (oldOI > 0) {
            rawChangeRate = (openInterest - oldOI) / oldOI * 100
            openInterestChangePercent = Number(rawChangeRate.toFixed(3))
          }
        } else if (oiHistory.length > 0) {
          const oldOI = oiHistory[0]?.openInterest ?? 0
          if (oldOI > 0) {
            openInterestChangePercent = Number(((openInterest - oldOI) / oldOI * 100).toFixed(3))
          }
        }
        
        // 使用EMA计算OI趋势
        if (oiHistory.length >= oiConfig.trendPeriod) {
          const oiValues = oiHistory.map(item => item.openInterest)
          // 计算OI的EMA值
          const oiEmaValues = EMA.calculate({ period: oiConfig.trendPeriod, values: oiValues })
          
          if (oiEmaValues.length >= 2) {
            const currentEma = oiEmaValues.at(-1) ?? 0
            const previousEma = oiEmaValues.at(-2) ?? 0
            if (currentEma > 0 && previousEma > 0) {
              const threshold = currentEma * (oiConfig.trendThresholdPercent / 100)
              
              if (currentEma - previousEma > threshold) {
                openInterestTrend = 'increasing'
              } else if (previousEma - currentEma > threshold) {
                openInterestTrend = 'decreasing'
              } else {
                openInterestTrend = 'flat'
              }
            }
          }
        }
      } catch (error: any) {
        console.warn(`计算OI指标失败: ${error.message}`)
      }
    }

    return {
      ema20: emaFastValue,
      ema30: emaMediumValue,
      ema60: emaSlowValue,
      emaFastValues,
      emaMediumValues,
      emaSlowValues,
      adx15m,
      adx1h,
      adx4h,
      adxSlope,
      rsi: rsiValues[rsiValues.length - 1] || 0,
      atr: atrValues[atrValues.length - 1] || 0,
      openInterest,
      openInterestChangePercent,
      openInterestTrend,
    }
  } catch (error: any) {
    throw new Error(`计算技术指标失败: ${error.message}`)
  }
}

/**
 * 检查ADX趋势条件（多周期确认）
 */
export function checkADXTrend(indicators: TechnicalIndicators, config?: BotConfig) {
  const { adx15m, adx1h, adx4h } = indicators
  const adxConfig = config?.indicatorsConfig?.adxTrend
  const strategyMode = config?.strategyMode || 'short_term'
  // 根据策略模式确定周期标签
  const [p1, p2, p3] = strategyMode === 'medium_term' ? ['1h', '4h', '1d'] : ['15m', '1h', '4h']
  const t1 = adxConfig?.adx15mThreshold || 30
  const t2 = adxConfig?.adx1hThreshold || 25
  const t3 = adxConfig?.adx4hThreshold || 28
  const enableCompare = adxConfig?.enableAdx15mVs1hCheck ?? true

  const pass1 = adx15m >= t1
  const pass2 = adx1h >= t2
  const pass3 = adx4h >= t3
  const passCompare = enableCompare ? adx15m > adx1h : true
  // 逻辑：必须满足三个绝对阈值，并且根据开关决定是否检查相对比较
  const passed = pass1 && pass2 && pass3 && passCompare

  let reason = ''
  if (passed) {
    const conds = [`${p1} ADX(${adx15m.toFixed(2)}) >= ${t1}`, `${p2} ADX(${adx1h.toFixed(2)}) >= ${t2}`, `${p3} ADX(${adx4h.toFixed(2)}) >= ${t3}`]
    enableCompare && conds.push(`${p1} ADX(${adx15m.toFixed(2)}) > ${p2} ADX(${adx1h.toFixed(2)})`)
    reason = conds.join(' 且 ') + '（趋势全面确认）'
  } else {
    const reasons = []
    !pass1 && reasons.push(`${p1} ADX(${adx15m.toFixed(2)}) < ${t1}`)
    !pass2 && reasons.push(`${p2} ADX(${adx1h.toFixed(2)}) < ${t2}`)
    !pass3 && reasons.push(`${p3} ADX(${adx4h.toFixed(2)}) < ${t3}`)
    enableCompare && !passCompare && reasons.push(`${p1} ADX(${adx15m.toFixed(2)}) ≤ ${p2} ADX(${adx1h.toFixed(2)})`)
    reason = reasons.join('，')
  }

  return {
    passed,
    reason,
    data: {
      adx15m, adx1h, adx4h,
      periodLabels: { p1, p2, p3, strategyMode },
      required: { t1, t2, t3, enableCompare },
      actual: { pass1, pass2, pass3, passCompare }
    }
  }
}

/**
 * 检查EMA交叉（金叉/死叉/预判交叉）
 * @returns 统一格式的EMA交叉信号
 */
export function checkEMACross(
  emaFastValues: number[],
  emaSlowValues: number[],
  price: number,
  config?: BotConfig,
): TradingSignal {
  // 优先判断EMA金叉/死叉（直接入场信号）
  let triggered = false
  let direction: 'LONG' | 'SHORT' | null = null
  let reason = ''
  const data: Record<string, any> = {}

  // 使用缓存中已计算好的EMA值，不再重复计算
  if (emaFastValues.length < 2 || emaSlowValues.length < 2) {
    return {
      type: 'EMA_CROSS',
      triggered: false,
      direction: null,
      reason: 'EMA数据不足，无法判断交叉',
      data: { emaFastValuesLength: emaFastValues.length, emaSlowValuesLength: emaSlowValues.length }
    }
  }

  const fastCurrent = emaFastValues.at(-1)!
  const fastPrev = emaFastValues.at(-2)!
  const slowCurrent = emaSlowValues.at(-1)!
  const slowPrev = emaSlowValues.at(-2)!

  const { fastName: emaFastName, slowName: emaSlowName } = getEMAPeriodConfig(config)
  const crossEntryEnabled = config?.indicatorsConfig?.crossEntryEnabled ?? true
  const showCrossFailureReason = config?.indicatorsConfig?.showCrossFailureReason ?? false

  // 预判交叉配置
  const predConfig = config?.indicatorsConfig?.predictiveCross
  const predEnabled = predConfig?.enabled ?? true
  const distancePercent = predConfig?.distancePercent ?? 0.0008
  const onlyTrend = predConfig?.onlyTrend ?? true

  const emaDiffPercent = Math.abs(fastCurrent - slowCurrent) / slowCurrent
  const isNearCross = emaDiffPercent <= distancePercent
  // 价格在慢EMA上方时，只预判金叉（做多信号）
  // 价格在慢EMA下方时，只预判死叉（做空信号）
  const isTrendAligned = onlyTrend ? 
    (price > slowCurrent && fastCurrent <= slowCurrent) || (price < slowCurrent && fastCurrent >= slowCurrent) : true

  const canPredict = predEnabled && isNearCross && isTrendAligned
  // 检查实际交叉 - 受crossEntryEnabled开关独立控制
  const goldenCross = crossEntryEnabled && fastPrev <= slowPrev && fastCurrent > slowCurrent
  const deadCross = crossEntryEnabled && fastPrev >= slowPrev && fastCurrent < slowCurrent

  // 填充扩展数据
  data.fastCurrent = fastCurrent
  data.fastPrev = fastPrev
  data.slowCurrent = slowCurrent
  data.slowPrev = slowPrev
  data.emaDiffPercent = emaDiffPercent
  data.isNearCross = isNearCross
  data.isTrendAligned = isTrendAligned
  data.canPredict = canPredict
  data.goldenCross = goldenCross
  data.deadCross = deadCross
  data.crossEntryEnabled = crossEntryEnabled
  data.predictiveCrossEnabled = predEnabled

  if (canPredict && !goldenCross && !deadCross) {
    triggered = true
    direction = fastCurrent < slowCurrent ? 'LONG' : 'SHORT'
    const crossType = direction === 'LONG' ? '金叉' : '死叉'
    reason = `预判交叉：${direction} ${emaFastName}即将${crossType}${emaSlowName}，差值: ${(emaDiffPercent * 100).toFixed(3)}%`
    data.isPredictive = true
  } else if (goldenCross) {
    triggered = true
    direction = 'LONG'
    reason = `实际金叉：LONG ${emaFastName}上穿${emaSlowName}`
    data.isPredictive = false
  } else if (deadCross) {
    triggered = true
    direction = 'SHORT'
    reason = `实际死叉：SHORT ${emaFastName}下穿${emaSlowName}`
    data.isPredictive = false
  } else {
    triggered = false
    direction = null
    if (showCrossFailureReason) {
      const details: string[] = []
      if (predEnabled) {
        details.push(`差值: ${(emaDiffPercent * 100).toFixed(2)}% > ${(distancePercent * 100).toFixed(2)}%`)
        !isTrendAligned && details.push('趋势不对齐')
      }
      if (crossEntryEnabled) {
        const prevRel = fastPrev <= slowPrev ? '≤' : '≥'
        const currRel = fastCurrent <= slowCurrent ? '≤' : '≥'
        details.push(`未交叉：前值${fastPrev.toFixed(2)}${prevRel}${slowPrev.toFixed(2)}，当前${fastCurrent.toFixed(2)}${currRel}${slowCurrent.toFixed(2)}`)
      }
      reason = details.length ? `交叉入场检测：${details.join('，')}` : '未触发EMA交叉信号'
    } else {
      reason = '未触发EMA交叉信号'
    }
  }

  return {
    type: 'EMA_CROSS',
    triggered,
    direction,
    reason,
    data
  }
}

/**
 * 根据OI趋势过滤交易方向
 */
export function filterTrendByOpenInterest(
  direction: 'LONG' | 'SHORT' | 'IDLE',
  indicators: TechnicalIndicators,
  config?: BotConfig
): {
  direction: 'LONG' | 'SHORT' | 'IDLE',
  additionalReason: string
} {
  const oiEnabled = config?.indicatorsConfig?.openInterest?.enabled ?? false
  if (!oiEnabled || direction === 'IDLE') {
    return { direction, additionalReason: '' }
  }

  const { openInterestTrend, openInterestChangePercent } = indicators
  let oiPass = true
  let oiFailReason = ''

  if (direction === 'LONG') {
    // 多头 = 必须增仓 + 变化率为正
    oiPass = openInterestTrend !== 'decreasing' && openInterestChangePercent > 0
    if (!oiPass) {
      oiFailReason = `OI趋势：${openInterestTrend}（${openInterestChangePercent}%）`
    }
  } else if (direction === 'SHORT') {
    // 空头 = 必须增仓 + 变化率为负
    oiPass = openInterestTrend !== 'decreasing' && openInterestChangePercent < 0
    if (!oiPass) {
      oiFailReason = `OI趋势：${openInterestTrend}（${openInterestChangePercent}%）`
    }
  }

  if (!oiPass) {
    return {
      direction: 'IDLE',
      additionalReason: oiFailReason
    }
  }

  return { direction, additionalReason: '' }
}

