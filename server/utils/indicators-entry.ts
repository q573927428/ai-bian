import { EMA } from 'technicalindicators'
import type { OHLCV, TechnicalIndicators, BotConfig, TradingSignal } from '../../types'
import { calculatePercentage, getEMAPeriodConfig } from './indicators-shared'

/**
 * 通用工具：检查K线时间有效性，避免K线刚开始时数据不稳定
 */
function checkCandleTimeValidity(
  lastCandle: OHLCV,
  strategyMode: string,
  minElapsedRatio: number = 0.1
): {
  isValid: boolean
  elapsedRatio: number
  reason: string
} {
  const candleStartTime = lastCandle.timestamp
  const currentTime = Date.now()
  // 根据策略模式确定时间框架（中长期1小时=3600000ms，短期15分钟=900000ms）
  const timeframeMs = strategyMode === 'medium_term' ? 60 * 60 * 1000 : 15 * 60 * 1000
  const elapsedRatio = Math.min((currentTime - candleStartTime) / timeframeMs, 1)
  
  if (elapsedRatio < minElapsedRatio) {
    return {
      isValid: false,
      elapsedRatio,
      reason: `K线刚开始(${(elapsedRatio * 100).toFixed(1)}%)，数据不稳定，不通过`
    }
  }
  
  return {
    isValid: true,
    elapsedRatio,
    reason: ''
  }
}


/**
 * 检查价格是否靠近快速EMA（回踩条件）
 */
export function checkEMANearCondition(
  direction: 'LONG' | 'SHORT',
  price: number,
  indicators: TechnicalIndicators,
  config?: BotConfig
): { 
  passed: boolean; 
  nearEMA: boolean; 
  nearEMAType: string;
  reason: string;
  data: any
} {
  const { ema20: emaFast } = indicators
  const { fastName: emaFastName } = getEMAPeriodConfig(config)
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const emaDeviationThreshold = entryConfig?.emaDeviationThreshold || 0.005
  const emaDeviationEnabled = entryConfig?.emaDeviationEnabled ?? true

  const nearFastEMA = Math.abs(price - emaFast) / emaFast <= emaDeviationThreshold
  const passed = !emaDeviationEnabled || nearFastEMA

  const emaFastPercent = calculatePercentage(price, emaFast)

  let reason = ''
  if (passed) {
    reason = emaDeviationEnabled 
      ? `价格${direction === 'LONG' ? '回踩' : '反弹'}EMA（距离${emaFastName}: ${emaFastPercent}%）`
      : 'EMA接近检查已禁用'
  } else {
    reason = `价格未${direction === 'LONG' ? '回踩' : '反弹'}EMA（距离${emaFastName}: ${emaFastPercent}%）`
  }

  return {
    passed,
    nearEMA: nearFastEMA,
    nearEMAType: nearFastEMA ? emaFastName : 'none',
    reason,
    data: {
      emaDeviationEnabled,
      emaDeviationThreshold,
      nearFastEMA,
      emaFast,
      price
    }
  }
}

/**
 * 检查价格与慢线EMA的偏离度是否在允许范围
 */
export function checkEMASlowDeviationCondition(
  direction: 'LONG' | 'SHORT',
  price: number,
  indicators: TechnicalIndicators,
  config?: BotConfig
): { 
  passed: boolean; 
  deviation: number;
  reason: string;
  data: any
} {
  const { ema60: emaSlow } = indicators
  const { slowName: emaSlowName } = getEMAPeriodConfig(config)
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const emaSlowDeviationThreshold = entryConfig?.emaSlowDeviationThreshold || 0.015
  const emaSlowDeviationEnabled = entryConfig?.emaSlowDeviationEnabled ?? true

  const emaSlowDeviation = Math.abs(price - emaSlow) / emaSlow
  const passed = !emaSlowDeviationEnabled || emaSlowDeviation <= emaSlowDeviationThreshold

  let reason = ''
  if (passed) {
    reason = emaSlowDeviationEnabled
      ? `${emaSlowName}偏离(${(emaSlowDeviation * 100).toFixed(2)}%) ≤ ${(emaSlowDeviationThreshold * 100).toFixed(2)}%`
      : `${emaSlowName}偏离检查已禁用`
  } else {
    reason = `${emaSlowName}偏离过大(${(emaSlowDeviation * 100).toFixed(2)}%) > ${(emaSlowDeviationThreshold * 100).toFixed(2)}%`
  }

  return {
    passed,
    deviation: emaSlowDeviation,
    reason,
    data: {
      emaSlowDeviationEnabled,
      emaSlowDeviationThreshold,
      emaSlow,
      price,
      emaSlowName
    }
  }
}

/**
 * 检查RSI是否在配置的合理区间
 */
export function checkRSIRangeCondition(
  direction: 'LONG' | 'SHORT',
  indicators: TechnicalIndicators,
  config?: BotConfig
): { 
  passed: boolean; 
  reason: string;
  data: any
} {
  const { rsi } = indicators
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const rsiMin = entryConfig?.rsiMin || 40
  const rsiMax = entryConfig?.rsiMax || (direction === 'LONG' ? 60 : 55)

  const rsiInRange = rsi >= rsiMin && rsi <= rsiMax
  const passed = rsiInRange

  let reason = ''
  if (passed) {
    reason = `RSI适中(${rsi.toFixed(1)})[${rsiMin} - ${rsiMax}]`
  } else {
    reason = `RSI(${rsi.toFixed(1)})不在[${rsiMin} - ${rsiMax}]区间`
  }

  return {
    passed,
    reason,
    data: {
      rsi,
      rsiMin,
      rsiMax,
      rsiInRange
    }
  }
}

/**
 * 检查K线形态是否符合要求（阳线/阴线或上下影线确认）
 */
export function checkCandleConfirmCondition(
  direction: 'LONG' | 'SHORT',
  lastCandle: OHLCV,
  config?: BotConfig
): { 
  passed: boolean; 
  candleType: string;
  reason: string;
  data: any
} {
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const candleShadowThreshold = entryConfig?.candleShadowThreshold || 0.005
  const isLong = direction === 'LONG'

  const isConfirmCandle = isLong
    ? (lastCandle.close > lastCandle.open || (lastCandle.open - lastCandle.low) / lastCandle.open >= candleShadowThreshold)
    : (lastCandle.close < lastCandle.open || (lastCandle.high - lastCandle.open) / lastCandle.open >= candleShadowThreshold)
  
  const candleType = isLong
    ? (lastCandle.close > lastCandle.open ? '阳线' : '下影线')
    : (lastCandle.close < lastCandle.open ? '阴线' : '上影线')
  
  const passed = isConfirmCandle

  let reason = ''
  if (passed) {
    reason = `${candleType}确认`
  } else {
    reason = isLong ? 'K线未确认（非阳线且无明显下影线）' : 'K线未确认（非阴线且无明显上影线）'
  }

  return {
    passed,
    candleType,
    reason,
    data: {
      candleShadowThreshold,
      isConfirmCandle,
      lastCandle
    }
  }
}

/**
 * 检查成交量条件
 */
export function checkVolumeCondition(
  direction: 'LONG' | 'SHORT',
  lastCandle: OHLCV,
  volumeHistory: number[],
  config?: BotConfig
): { 
  passed: boolean; 
  reason: string;
  data: any
} {
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const { strategyMode } = getEMAPeriodConfig(config)
  const volumeConfirmation = entryConfig?.volumeConfirmation ?? true
  const volumeEMAPeriod = entryConfig?.volumeEMAPeriod || 10
  const volumeEMAMultiplier = entryConfig?.volumeEMAMultiplier || 1.2

  let volumePassed = true
  let volumeReason = ''
  let predictedVolume: number | null = null
  let elapsedRatio: number | null = null
  
  if (volumeConfirmation && volumeHistory && volumeHistory.length >= volumeEMAPeriod) {
    const currentVolume = lastCandle.volume
    
    // 计算成交量EMA（使用历史已完成K线的成交量）
    const volumeEMAValues = EMA.calculate({ period: volumeEMAPeriod, values: volumeHistory })
    const volumeEMA = volumeEMAValues[volumeEMAValues.length - 1] || 0
    
    // 检查K线时间有效性
    const timeValidity = checkCandleTimeValidity(lastCandle, strategyMode);
    elapsedRatio = timeValidity.elapsedRatio;
    
    if (!timeValidity.isValid) {
      // 前10%时间成交量不稳定，不通过成交量检查
      volumePassed = false
      volumeReason = timeValidity.reason
    } else {
      // 按时间比例预测完整K线成交量
      predictedVolume = currentVolume / elapsedRatio
      volumePassed = predictedVolume >= volumeEMA * volumeEMAMultiplier
      volumeReason = `成交量: ${currentVolume.toFixed(2)} (${(elapsedRatio * 100).toFixed(1)}%) → 预测: ${predictedVolume.toFixed(2)} vs ${volumeEMAPeriod}周期EMA(x${volumeEMAMultiplier}): ${(volumeEMA * volumeEMAMultiplier).toFixed(2)}`
    }
  } else if (volumeConfirmation) {
    volumePassed = false
    volumeReason = '成交量数据不足，无法计算EMA'
  }

  return {
    passed: volumePassed,
    reason: volumeReason,
    data: {
      volumeConfirmation,
      volumeEMAPeriod,
      volumeEMAMultiplier,
      predictedVolume,
      elapsedRatio
    }
  }
}

/**
 * 检查价格突破条件
 */
export function checkPriceBreakoutCondition(
  direction: 'LONG' | 'SHORT',
  price: number,
  candles: OHLCV[],
  config?: BotConfig
): { 
  passed: boolean; 
  reason: string;
  data: any
} {
  if (!candles?.length) {
    return {
      passed: true,
      reason: '价格突破指标未检查',
      data: null
    }
  }

  // 使用配置参数或默认值
  const enabled = config?.indicatorsConfig?.priceBreakout?.enabled ?? true
  const period = config?.indicatorsConfig?.priceBreakout?.period ?? 5
  const requireConfirmation = config?.indicatorsConfig?.priceBreakout?.requireConfirmation ?? true
  const confirmationCandles = config?.indicatorsConfig?.priceBreakout?.confirmationCandles ?? 1

  // 如果未启用价格突破指标，直接返回通过
  if (!enabled) {
    return {
      passed: true,
      reason: '价格突破指标未启用',
      data: {
        enabled: false,
        period,
        requireConfirmation,
        confirmationCandles
      }
    }
  }

  // 检查是否有足够的K线数据
  if (candles.length < period + confirmationCandles) {
    return {
      passed: false,
      reason: `K线数据不足，需要至少${period + confirmationCandles}根K线，当前只有${candles.length}根`,
      data: {
        enabled,
        period,
        requireConfirmation,
        confirmationCandles,
        candlesCount: candles.length
      }
    }
  }

  // 获取最近N根K线（排除最后确认的K线）
  const startIndex = Math.max(0, candles.length - period - confirmationCandles)
  const endIndex = candles.length - confirmationCandles
  const recentCandles = candles.slice(startIndex, endIndex)
  
  let targetPrice: number
  let priceBreakout: boolean
  let compareOperator: string
  let targetName: string

  if (direction === 'LONG') {
    targetPrice = Math.max(...recentCandles.map(c => c.high))
    priceBreakout = price > targetPrice
    compareOperator = priceBreakout ? '>' : '≤'
    targetName = '最高价'
  } else {
    targetPrice = Math.min(...recentCandles.map(c => c.low))
    priceBreakout = price < targetPrice
    compareOperator = priceBreakout ? '<' : '≥'
    targetName = '最低价'
  }
  
  let passed = priceBreakout
  let reason = `当前价格${price.toFixed(2)} ${compareOperator} 最近${period}根K线${targetName}${targetPrice.toFixed(2)}`
  
  // 如果需要确认，检查最近确认K线的收盘价
  if (requireConfirmation && priceBreakout) {
    const confirmationCandlesSlice = candles.slice(-confirmationCandles)
    let allConfirm: boolean
    
    if (direction === 'LONG') {
      allConfirm = confirmationCandlesSlice.every(candle => candle.close > targetPrice)
    } else {
      allConfirm = confirmationCandlesSlice.every(candle => candle.close < targetPrice)
    }
    
    passed = allConfirm
    reason = allConfirm 
      ? `${reason}，且最近${confirmationCandles}根K线收盘价确认突破`
      : `${reason}，但最近${confirmationCandles}根K线收盘价未全部确认突破`
  }

  return {
    passed,
    reason,
    data: {
      enabled,
      period,
      requireConfirmation,
      confirmationCandles,
      price,
      targetPrice,
      priceBreakout,
      recentCandlesCount: recentCandles.length,
      confirmationCandlesCount: confirmationCandles
    }
  }
}

/**
 * 通用入场条件检查（自带方向判断+OI集成+评分制）
 * @returns 统一格式的入场检测信号
 */
export function checkEntry(
  price: number,
  indicators: TechnicalIndicators,
  lastCandle: OHLCV,
  config?: BotConfig,
  volumeHistory?: number[],
  candles15m?: OHLCV[]
): TradingSignal {
  const { fastName: emaFastName, mediumName: emaMediumName, slowName: emaSlowName } = getEMAPeriodConfig(config)
  const { ema20: emaFast, ema60: emaSlow, openInterestTrend, openInterestChangePercent } = indicators
  const entryConfig = config?.indicatorsConfig?.entryConfig
  const oiConfig = config?.indicatorsConfig?.openInterest
  const minScoreThreshold = entryConfig?.minScoreThreshold || 70

  // 第一步：自行判断趋势方向（仅作为必要条件，不加分）
  const emaFastAboveSlow = emaFast > emaSlow
  let direction: 'LONG' | 'SHORT' | null = null
  let totalScore = 0
  const scoreDetails: string[] = []
  const data: Record<string, any> = {}

  const isLongCondition = emaFastAboveSlow
  const isShortCondition = !emaFastAboveSlow

  if (isLongCondition) {
    direction = 'LONG'
    scoreDetails.push(`方向 LONG ${emaFastName}(${emaFast.toFixed(4)}) > ${emaSlowName}(${emaSlow.toFixed(4)})`)
  } else if (isShortCondition) {
    direction = 'SHORT'
    scoreDetails.push(`方向 SHORT ${emaFastName}(${emaFast.toFixed(4)}) < ${emaSlowName}(${emaSlow.toFixed(4)})`)
  } else {
    return {
      type: 'ENTRY',
      triggered: false,
      direction: null,
      reason: `无明确趋势方向：IDLE ${emaFastName}(${emaFast.toFixed(4)})，${emaSlowName}(${emaSlow.toFixed(4)})`,
      data: { score: 0 }
    }
  }

  const isLong = direction === 'LONG'

  // 第二步：OI趋势匹配（25分）
  if (oiConfig?.enabled) {
    let oiMatch = false
    if (isLong) {
      // 多头需要OI增仓且变化率为正
      oiMatch = openInterestTrend !== 'decreasing' && openInterestChangePercent > 0
    } else {
      // 空头需要OI增仓且变化率为负
      oiMatch = openInterestTrend !== 'decreasing' && openInterestChangePercent < 0
    }

    if (oiMatch) {
      totalScore += 25
    } else {
      scoreDetails.push(`OI不匹配：+0分 (趋势${openInterestTrend}，变化率${openInterestChangePercent}%)`)
    }
  } else {
    totalScore += 25
  }

  // 调用独立条件函数
  const emaNearResult = checkEMANearCondition(direction, price, indicators, config)
  const emaSlowDevResult = checkEMASlowDeviationCondition(direction, price, indicators, config)
  const rsiResult = checkRSIRangeCondition(direction, indicators, config)
  const candleResult = checkCandleConfirmCondition(direction, lastCandle, config)
  const volumeResult = checkVolumeCondition(direction, lastCandle, volumeHistory || [], config)
  const breakoutResult = checkPriceBreakoutCondition(direction, price, candles15m || [], config)

  // EMA接近条件（10分）
  if (emaNearResult.passed) {
    totalScore += 10
  } else {
    scoreDetails.push(`EMA接近：+0分 (${emaNearResult.reason})`)
  }

  // EMA偏离度（22分）
  if (emaSlowDevResult.passed) {
    totalScore += 22
  } else {
    scoreDetails.push(`EMA偏离：+0分 (${emaSlowDevResult.reason})`)
  }

  // RSI区间（10分）
  if (rsiResult.passed) {
    totalScore += 10
  } else {
    scoreDetails.push(`RSI区间：+0分 (${rsiResult.reason})`)
  }

  // K线确认（10分）
  if (candleResult.passed) {
    totalScore += 10
  } else {
    scoreDetails.push(`K线确认：+0分 (${candleResult.reason})`)
  }

  // 成交量确认（23分）
  if (volumeResult.passed) {
    totalScore += 23
  } else {
    scoreDetails.push(`成交量：+0分 (${volumeResult.reason})`)
  }

  // 判断是否通过
  const triggered = totalScore >= minScoreThreshold
  const reason = triggered 
    ? `趋势检测: 总分${totalScore}/${minScoreThreshold}分：${scoreDetails.join('，')}`
    : `趋势检测: 总分${totalScore}/${minScoreThreshold}分：${scoreDetails.join('，')}`

  // 填充扩展数据
  data.score = totalScore
  data.minScoreThreshold = minScoreThreshold
  data.nearEMA = emaNearResult.nearEMA
  data.rsiInRange = rsiResult.passed
  data.isConfirmCandle = candleResult.passed
  data.volumePassed = volumeResult.passed
  data.priceBreakoutPassed = breakoutResult.passed
  data.emaFast = emaFast
  data.emaSlow = emaSlow
  data.openInterestTrend = openInterestTrend
  data.openInterestChangePercent = openInterestChangePercent

  // 返回统一格式
  return {
    type: 'ENTRY',
    triggered,
    direction,
    reason,
    data
  }
}

/**
 * 检测Pin Bar针形K线形态
 */
function detectPinBar(
  lastCandle: OHLCV,
  config: any,
  emaFast: number,
  emaSlow: number,
  price: number,
  strategyMode: string
): { triggered: boolean; direction: 'LONG' | 'SHORT' | null; reason: string } {
  // 先检查K线时间有效性
  const timeValidity = checkCandleTimeValidity(lastCandle, strategyMode, 0.3);
  if (!timeValidity.isValid) {
    return {
      triggered: false,
      direction: null,
      reason: timeValidity.reason
    };
  }

  const shadowBodyRatio = config.shadowBodyRatio ?? 3;
  const maxBodyRatio = config.maxBodyRatio ?? 0.3;

  const lastBodySize = Math.abs(lastCandle.close - lastCandle.open);
  const lastTotalSize = lastCandle.high - lastCandle.low;
  const lastUpperShadow = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const lastLowerShadow = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  
  // 趋势判断
  const isUptrend = price > emaSlow && emaFast > emaSlow; // 上升趋势：价格在慢线上方 + 快线在慢线上方
  const isDowntrend = price < emaSlow && emaFast < emaSlow; // 下降趋势：价格在慢线下方 + 快线在慢线下方
  
  // 增加EMA慢线偏离度检查，避免高位/低位接盘
  const deviationDirection = isUptrend ? 'LONG' : 'SHORT';
  const deviationCheck = checkEMASlowDeviationCondition(
    deviationDirection,
    price,
    { ema60: emaSlow } as TechnicalIndicators,
    config
  );
  if (!deviationCheck.passed) {
    return {
      triggered: false,
      direction: null,
      reason: `未触发Pin Bar信号：${deviationCheck.reason}`
    };
  }
  
  if (lastBodySize / lastTotalSize <= maxBodyRatio) {
    // 看涨Pin Bar：长下影线 + 上升趋势
    if (isUptrend && lastLowerShadow >= lastBodySize * shadowBodyRatio && lastLowerShadow > lastUpperShadow * 2) {
      return {
        triggered: true,
        direction: 'LONG',
        reason: `[PA信号] 看涨Pin Bar：下影线(${lastLowerShadow.toFixed(4)})是实体(${lastBodySize.toFixed(4)})的${(lastLowerShadow/lastBodySize).toFixed(1)}倍，上升趋势确认，反转做多`
      };
    }
    
    // 看跌Pin Bar：长上影线 + 下降趋势
    if (isDowntrend && lastUpperShadow >= lastBodySize * shadowBodyRatio && lastUpperShadow > lastLowerShadow * 2) {
      return {
        triggered: true,
        direction: 'SHORT',
        reason: `[PA信号] 看跌Pin Bar：上影线(${lastUpperShadow.toFixed(4)})是实体(${lastBodySize.toFixed(4)})的${(lastUpperShadow/lastBodySize).toFixed(1)}倍，下降趋势确认，反转做空`
      };
    }
  }
  
  let reason = '未触发Pin Bar信号';
  if (!isUptrend && !isDowntrend) {
    reason = '未触发Pin Bar信号：当前为震荡趋势，不满足趋势条件';
  } else if (isUptrend) {
    reason = '未触发Pin Bar信号：上升趋势仅允许看涨Pin Bar';
  } else if (isDowntrend) {
    reason = '未触发Pin Bar信号：下降趋势仅允许看跌Pin Bar';
  }
  
  return { triggered: false, direction: null, reason };
}

/**
 * 检测吞没形态
 */
function detectEngulfing(
  lastCandle: OHLCV,
  prevCandle: OHLCV,
  config: any,
  strategyMode: string,
  emaFast: number,
  emaSlow: number,
  price: number
): { triggered: boolean; direction: 'LONG' | 'SHORT' | null; reason: string } {
  // 先检查K线时间有效性
  const timeValidity = checkCandleTimeValidity(lastCandle, strategyMode, 0.3);
  if (!timeValidity.isValid) {
    return {
      triggered: false,
      direction: null,
      reason: timeValidity.reason
    };
  }

  // 趋势判断
  const isUptrend = price > emaSlow && emaFast > emaSlow; // 上升趋势：价格在慢线上方 + 快线在慢线上方
  const isDowntrend = price < emaSlow && emaFast < emaSlow; // 下降趋势：价格在慢线下方 + 快线在慢线下方
  
  // 增加EMA慢线偏离度检查，避免高位/低位接盘
  const longDeviationCheck = checkEMASlowDeviationCondition(
    'LONG',
    price,
    { ema60: emaSlow } as TechnicalIndicators,
    config
  );
  const shortDeviationCheck = checkEMASlowDeviationCondition(
    'SHORT',
    price,
    { ema60: emaSlow } as TechnicalIndicators,
    config
  );
  
  const minEngulfRatio = config.minEngulfRatio ?? 1.8;
  
  const lastBodySize = Math.abs(lastCandle.close - lastCandle.open);
  const prevBodySize = Math.abs(prevCandle.close - prevCandle.open);
  const prevIsBullish = prevCandle.close > prevCandle.open;
  const lastIsBullish = lastCandle.close > lastCandle.open;
  
  // 看涨吞没：前阴后阳 + 阳线实体完全包裹阴线实体 + 上升趋势 + 偏离度满足
  if (!prevIsBullish && lastIsBullish && 
      lastCandle.open < prevCandle.close && 
      lastCandle.close > prevCandle.open &&
      lastBodySize >= prevBodySize * minEngulfRatio &&
      isUptrend &&
      longDeviationCheck.passed) {
    return {
      triggered: true,
      direction: 'LONG',
      reason: `[PA信号] 看涨吞没：阳线实体(${lastBodySize.toFixed(4)})完全包裹前阴线实体(${prevBodySize.toFixed(4)})，上升趋势确认，反转做多`
    };
  }
  
  // 看跌吞没：前阳后阴 + 阴线实体完全包裹阳线实体 + 下降趋势 + 偏离度满足
  if (prevIsBullish && !lastIsBullish && 
      lastCandle.open > prevCandle.close && 
      lastCandle.close < prevCandle.open &&
      lastBodySize >= prevBodySize * minEngulfRatio &&
      isDowntrend &&
      shortDeviationCheck.passed) {
    return {
      triggered: true,
      direction: 'SHORT',
      reason: `[PA信号] 看跌吞没：阴线实体(${lastBodySize.toFixed(4)})完全包裹前阳线实体(${prevBodySize.toFixed(4)})，下降趋势确认，反转做空`
    };
  }
  
  let reason = '未触发吞没形态信号';
  if (!isUptrend && !isDowntrend) {
    reason = '未触发吞没形态信号：当前为震荡趋势，不满足趋势条件';
  } else if (isUptrend) {
    reason = !longDeviationCheck.passed 
      ? `未触发吞没形态信号：${longDeviationCheck.reason}`
      : '未触发吞没形态信号：上升趋势仅允许看涨吞没';
  } else if (isDowntrend) {
    reason = !shortDeviationCheck.passed 
      ? `未触发吞没形态信号：${shortDeviationCheck.reason}`
      : '未触发吞没形态信号：下降趋势仅允许看跌吞没';
  }
  
  return { triggered: false, direction: null, reason };
}

/**
 * 检查价格行为(PA)信号 统一入口
 * 支持Pin Bar针形K线和吞没形态
 * @returns 统一格式的PA信号
 */
export function checkPriceActionSignal(
  candles: OHLCV[],
  config?: BotConfig,
  price?: number,
  emaFast?: number,
  emaSlow?: number
): TradingSignal {
  const paConfig = config?.indicatorsConfig?.priceAction;
  const { strategyMode } = getEMAPeriodConfig(config);
  
  // PA未启用直接返回
  if (!paConfig?.enabled) {
    return {
      type: 'PA',
      triggered: false,
      direction: null,
      reason: 'PA策略未启用',
      data: { paEnabled: false }
    };
  }
  
  if (candles.length < 2) {
    return {
      type: 'PA',
      triggered: false,
      direction: null,
      reason: 'K线数据不足',
      data: { candlesLength: candles.length }
    };
  }
  
  const lastCandle = candles[candles.length - 1]!;
  const prevCandle = candles[candles.length - 2]!;
  const data: Record<string, any> = {
    paConfig,
    lastCandle,
    prevCandle,
    price,
    emaFast,
    emaSlow
  };
  
  // 1. 检测Pin Bar
  if (paConfig.pinBarEnabled && price !== undefined && emaFast !== undefined && emaSlow !== undefined) {
    const pinBarResult = detectPinBar(lastCandle, paConfig, emaFast, emaSlow, price, strategyMode);
    if (pinBarResult.triggered) {
      data.signalType = 'pinBar';
      return {
        type: 'PA',
        triggered: pinBarResult.triggered,
        direction: pinBarResult.direction,
        reason: pinBarResult.reason,
        data
      };
    }
  }
  
  // 2. 检测吞没形态
  if (paConfig.engulfingEnabled && price !== undefined && emaFast !== undefined && emaSlow !== undefined) {
    const engulfingResult = detectEngulfing(lastCandle, prevCandle, paConfig, strategyMode, emaFast, emaSlow, price);
    if (engulfingResult.triggered) {
      data.signalType = 'engulfing';
      return {
        type: 'PA',
        triggered: engulfingResult.triggered,
        direction: engulfingResult.direction,
        reason: engulfingResult.reason,
        data
      };
    }
  }
  
  return {
    type: 'PA',
    triggered: false,
    direction: null,
    reason: '未触发PA信号',
    data
  };
}

/**
 * 检查波动率条件
 */
export function checkVolatility(
  price: number,
  indicators: TechnicalIndicators,
  config?: BotConfig,
  symbol?: string
): { passed: boolean; reason: string; data?: any } {
  // 使用配置参数或默认值
  const enabled = config?.indicatorsConfig?.volatility?.enabled ?? true
  const minATRPercent = config?.indicatorsConfig?.volatility?.minATRPercent ?? 0.5
  const skipSymbols = config?.indicatorsConfig?.volatility?.skipSymbols ?? []

  // 如果未启用波动率过滤，直接返回通过
  if (!enabled) {
    return {
      passed: true,
      reason: '波动率过滤未启用',
      data: {
        enabled: false,
        minATRPercent,
        skipSymbols
      }
    }
  }

  // 检查是否在跳过列表中
  if (symbol && skipSymbols.includes(symbol)) {
    return {
      passed: true,
      reason: `交易对${symbol}在跳过列表中，不检查波动率`,
      data: {
        enabled,
        minATRPercent,
        skipSymbols,
        symbol,
        skipped: true
      }
    }
  }

  const { atr } = indicators

  // 计算ATR百分比（波动率）
  const atrPercent = (atr / price) * 100

  // 检查波动率是否达到最小阈值
  const passed = atrPercent >= minATRPercent

  let reason = ''
  if (passed) {
    reason = `波动率满足条件：ATR百分比${atrPercent.toFixed(2)}% ≥ ${minATRPercent}%`
  } else {
    reason = `波动率过低：ATR百分比${atrPercent.toFixed(2)}% < ${minATRPercent}%`
  }

  return {
    passed,
    reason,
    data: {
      enabled,
      minATRPercent,
      skipSymbols,
      price,
      atr,
      atrPercent,
      symbol,
      skipped: symbol ? skipSymbols.includes(symbol) : false
    }
  }
}
