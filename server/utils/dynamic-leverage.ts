import type { TechnicalIndicators, RiskLevel } from '../../types'

/**
 * 动态杠杆配置（极简版）
 */
export interface DynamicLeverageConfig {
  enabled: boolean                    // 启用动态杠杆
  minLeverage: number                 // 最小杠杆倍数 (2)
  maxLeverage: number                 // 最大杠杆倍数 (20)
  baseLeverage: number                // 基础杠杆倍数 (5)
  riskLevelMultipliers: Record<RiskLevel, number> // 风险等级乘数
}

/**
 * 快速杠杆计算（纯技术指标版）
 * 基于ADX趋势强度、RSI合理性、ATR波动率、OI趋势和风险等级
 */
export function calculateQuickLeverage(
  technicalIndicators: TechnicalIndicators,
  riskLevel: RiskLevel,
  config: DynamicLeverageConfig
): number {
  // 基础杠杆
  let leverage = config.baseLeverage
  
  // ADX趋势强度调整：15分钟ADX 20-60 对应乘数0.98-1.85，趋势越强杠杆越高
  const adx = technicalIndicators.adx15m
  let adxFactor = 1.0
  if (adx >= 20) {
    adxFactor = 0.98 + Math.min((adx - 20) / 65, 0.87) // 每高10点乘数增加0.15，上限1.85
  } else {
    adxFactor = 0.98 // 趋势不明朗时降低杠杆
  }
  leverage *= adxFactor
  
  // RSI合理性调整：RSI在40-60区间趋势健康，乘数1.45；接近超买超卖时降低杠杆
  const rsi = technicalIndicators.rsi
  let rsiFactor = 1.0
  if (rsi >= 40 && rsi <= 60) {
    rsiFactor = 1.45
  } else if ((rsi >= 35 && rsi < 40) || (rsi > 60 && rsi <= 65)) {
    rsiFactor = 1.2
  } else {
    rsiFactor = 1.0 // RSI极端值时降低杠杆
  }
  leverage *= rsiFactor
  
  // 波动率调整：ATR波动率低于1%时市场平稳提高杠杆，高于3%时波动剧烈降低杠杆
  const atrPercent = technicalIndicators.atr / (technicalIndicators.ema20 || 1) * 100
  let volatilityFactor = 1.0
  if (atrPercent < 1) {
    volatilityFactor = 1.25
  } else if (atrPercent > 3) {
    volatilityFactor = 0.95
  }
  leverage *= volatilityFactor
  
  // OI趋势调整：OI平稳时市场健康，大幅波动时降低杠杆
  const oiTrend = technicalIndicators.openInterestTrend
  let oiFactor = 1.0
  if (oiTrend === 'flat') {
    oiFactor = 1.1
  } else if (Math.abs(technicalIndicators.openInterestChangePercent) > 5) {
    oiFactor = 0.95 // OI变化超过5%时降低杠杆
  }
  leverage *= oiFactor
  
  // 风险等级调整：风险越低，杠杆越高
  const riskFactor = config.riskLevelMultipliers[riskLevel] || 1.0
  leverage *= riskFactor
  
  // 整体提升30%杠杆
  leverage *= 1.3
  
  // 确保在范围内并取整
  leverage = Math.max(config.minLeverage, Math.min(config.maxLeverage, leverage))
  return Math.round(leverage)
}


/**
 * 计算安全杠杆倍数（考虑账户风险）
 * 基于止损距离计算最大安全杠杆，根据ADX趋势强度动态调整
 */
export function calculateSafeLeverage(
  accountBalance: number,
  maxRiskPercentage: number,
  stopLossPrice: number,
  entryPrice: number,
  adx15m?: number
): number {

  if (accountBalance <= 0 || entryPrice <= 0) return 1

  // 实际止损距离
  const stopLossDistance =
    Math.abs(entryPrice - stopLossPrice) / entryPrice

  if (stopLossDistance <= 0) return 1

  // ===== 1️⃣ 基础最小止损距离 =====
  const baseStopLoss = 0.015 // 1.5%

  let minStopLossDistance = baseStopLoss

  if (adx15m !== undefined && adx15m >= 0) {

    // 趋势越强 → 因子越小
    // ADX 0–60 → 因子 1.3–0.7
    const trendFactor =
      1.3 - Math.min(adx15m, 60) / 100

    minStopLossDistance = baseStopLoss * trendFactor
  }

  // 限制在合理范围
  minStopLossDistance = Math.max(
    0.01,
    Math.min(0.02, minStopLossDistance)
  )

  // ===== 2️⃣ 取有效止损距离 =====
  const effectiveStopLossDistance =
    Math.max(stopLossDistance, minStopLossDistance)

  // ===== 3️⃣ 计算安全杠杆 =====
  const safeLeverage =
    (maxRiskPercentage / 100) / effectiveStopLossDistance

  // ===== 4️⃣ 限制范围 =====
  return Math.max(1, Math.min(20, Math.floor(safeLeverage)))
}
/**
 * 综合计算最终杠杆（结合动态杠杆和安全杠杆）
 * 取两者中的较小值，确保安全
 */
export function calculateFinalLeverage(
  dynamicLeverage: number,
  safeLeverage: number,
  config: DynamicLeverageConfig
): number {
  // 取动态杠杆和安全杠杆中的较小值
  const finalLeverage = Math.min(dynamicLeverage, safeLeverage)
  
  // 确保在配置范围内
  return Math.max(config.minLeverage, Math.min(config.maxLeverage, finalLeverage))
}