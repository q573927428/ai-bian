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
    const { strategyMode, fast: emaFast, medium: emaMedium, slow: emaSlow, fastName: emaFastName, mediumName: emaMediumName, slowName: emaSlowName } = getEMAPeriodConfig(config)
    
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
    let adxMain, adxSecondary, adxTertiary
    if (strategyMode === 'medium_term') {
      // 中长期策略：1h为主周期，4h为次要周期，1d为第三周期
      adxMain = adxMainValues[adxMainValues.length - 1]?.adx || 0      // 1h
      adxSecondary = adxSecondaryValues[adxSecondaryValues.length - 1]?.adx || 0  // 4h
      adxTertiary = adxTertiaryValues[adxTertiaryValues.length - 1]?.adx || 0    // 1d
    } else {
      // 短期策略：15m为主周期，1h为次要周期，4h为第三周期
      adxMain = adxMainValues[adxMainValues.length - 1]?.adx || 0      // 15m
      adxSecondary = adxSecondaryValues[adxSecondaryValues.length - 1]?.adx || 0  // 1h
      adxTertiary = adxTertiaryValues[adxTertiaryValues.length - 1]?.adx || 0    // 4h
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

    // 根据策略模式确定ADX周期标签
    const adxPeriodLabels = strategyMode === 'medium_term' 
      ? { main: '1h', secondary: '4h', tertiary: '1d' } 
      : { main: '15m', secondary: '1h', tertiary: '4h' }

    return {
      // EMA动态配置
      emaPeriods: { fast: emaFast, medium: emaMedium, slow: emaSlow },
      emaNames: { fast: emaFastName, medium: emaMediumName, slow: emaSlowName },
      emaFast: emaFastValue,
      emaMedium: emaMediumValue,
      emaSlow: emaSlowValue,
      emaFastValues,
      emaMediumValues,
      emaSlowValues,
      // ADX动态配置
      adxPeriodLabels,
      adxMain,
      adxSecondary,
      adxTertiary,
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

