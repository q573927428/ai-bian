/**
 * EMA计算工具函数
 * 用于在客户端计算EMA值
 */

/**
 * 计算EMA值
 * @param prices 价格数组（通常是收盘价）
 * @param period EMA周期
 * @returns EMA值数组，长度与输入相同
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0 || period <= 0) {
    return []
  }

  // 与后端 technicalindicators 口径对齐：
  // 数据不足一个周期时不返回EMA
  if (prices.length < period) {
    return []
  }

  const emaValues: number[] = []
  const multiplier = 2 / (period + 1)

  // 第一个有效EMA（索引 period-1）是前 period 个价格的SMA
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += prices[i] || 0
  }

  const firstSMA = sum / period

  // 为了保持与K线长度一致，前置区间用首个有效EMA平铺
  // （不参与后续递推，不影响最新EMA结果）
  for (let i = 0; i < period - 1; i++) {
    emaValues.push(firstSMA)
  }

  emaValues.push(firstSMA)

  // 从第 period 个价格开始递推EMA
  for (let i = period; i < prices.length; i++) {
    const currentPrice = prices[i] || 0
    const previousEMA = emaValues[i - 1] || 0
    const currentEMA = (currentPrice - previousEMA) * multiplier + previousEMA
    emaValues.push(currentEMA)
  }

  return emaValues
}

/**
 * 计算EMA并返回与时间戳对齐的数据
 * @param klineData K线数据数组
 * @param period EMA周期
 * @param priceField 使用的价格字段，默认为收盘价'c'
 * @returns 包含时间和值的EMA数据数组
 */
export function calculateEMASeries(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number,
  priceField: 'c' | 'o' | 'h' | 'l' = 'c'
): Array<{ time: number; value: number }> {
  if (klineData.length < period) {
    return []
  }

  const prices = klineData.map(item => item[priceField])
  const emaValues = calculateEMA(prices, period)

  // 返回与时间戳对齐的数据
  return klineData.map((item, index) => ({
    time: item.t,
    value: emaValues[index] ?? 0
  }))
}

/**
 * 计算多个EMA周期
 * @param klineData K线数据数组
 * @param periods EMA周期数组，如[14, 120]
 * @returns 包含多个EMA周期的数据对象
 */
export function calculateMultipleEMAs(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  periods: number[]
): Record<number, Array<{ time: number; value: number }>> {
  const result: Record<number, Array<{ time: number; value: number }>> = {}

  for (const period of periods) {
    result[period] = calculateEMASeries(klineData, period)
  }

  return result
}

/**
 * 获取EMA颜色配置
 * @param period EMA周期
 * @returns 颜色配置
 */
export function getEMAColor(period: number): string {
  const colorMap: Record<number, string> = {
    14: '#298cf3', // 红色 - EMA14
    20: '#4ECDC4', // 青色 - EMA20
    30: '#FF6B6B', // 蓝色 - EMA30
    60: '#DDA0DD', // 紫色 - EMA60
    120: '#f3ab23', // 黄色 - EMA120
    200: '#96CEB4'  // 绿色 - EMA200
  }

  return colorMap[period] || '#FFFFFF'
}

/**
 * 获取EMA线宽配置
 * @param period EMA周期
 * @returns 线宽
 */
export function getEMAWidth(period: number): number {
  const widthMap: Record<number, number> = {
    14: 1.5,
    20: 2,
    30: 2,
    60: 2.5,
    120: 2.5,
    200: 3
  }

  return widthMap[period] || 1.5
}

/**
 * 计算ATR（平均真实波幅）
 * @param klineData K线数据数组
 * @param period ATR周期，默认为14
 * @returns ATR值数组，长度与输入相同
 */
export function calculateATR(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number = 14
): number[] {
  if (klineData.length === 0 || period <= 0) {
    return []
  }

  const atrValues: number[] = []
  const trueRanges: number[] = []

  // 计算真实波幅（TR）
  for (let i = 0; i < klineData.length; i++) {
    const current = klineData[i]
    if (!current) continue

    if (i === 0) {
      // 第一根K线：TR = 最高价 - 最低价
      trueRanges.push(current.h - current.l)
    } else {
      const previous = klineData[i - 1]
      if (!previous) continue
      
      // 真实波幅 = max(当前最高-当前最低, |当前最高-前收盘|, |当前最低-前收盘|)
      const tr1 = current.h - current.l
      const tr2 = Math.abs(current.h - previous.c)
      const tr3 = Math.abs(current.l - previous.c)
      trueRanges.push(Math.max(tr1, tr2, tr3))
    }
  }

  // 计算ATR（使用SMA作为第一个值，然后使用EMA）
  if (trueRanges.length < period) {
    return []
  }

  // 第一个ATR是前period个TR的简单移动平均
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i] || 0
  }
  
  const firstATR = sum / period
  atrValues.push(firstATR)

  // 计算后续ATR值（使用EMA公式）
  const multiplier = 2 / (period + 1)
  
  for (let i = period; i < trueRanges.length; i++) {
    const previousATR = atrValues[atrValues.length - 1] || 0
    const currentTR = trueRanges[i] || 0
    const currentATR = (currentTR - previousATR) * multiplier + previousATR
    atrValues.push(currentATR)
  }

  // 填充前面的空值
  const emptyValues = new Array(klineData.length - atrValues.length).fill(0)
  return [...emptyValues, ...atrValues]
}

/**
 * 计算ATR并返回与时间戳对齐的数据
 * @param klineData K线数据数组
 * @param period ATR周期，默认为14
 * @returns 包含时间和值的ATR数据数组
 */
export function calculateATRSeries(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number = 14
): Array<{ time: number; value: number }> {
  if (klineData.length < period) {
    return []
  }

  const atrValues = calculateATR(klineData, period)

  // 返回与时间戳对齐的数据
  return klineData.map((item, index) => ({
    time: item.t,
    value: atrValues[index] || 0
  }))
}

/**
 * 计算ATR波动率百分比
 * @param atr ATR值
 * @param price 价格（通常是收盘价）
 * @returns ATR波动率百分比
 */
export function calculateATRPercent(atr: number, price: number): number {
  if (price === 0) return 0
  return (atr / price) * 100
}

/**
 * 检测EMA交叉点
 * @param klineData K线数据数组
 * @param fastPeriod 快线EMA周期
 * @param slowPeriod 慢线EMA周期
 * @returns 交叉点数组，包含时间、类型、价格和ATR信息
 */
export function detectEMACrossovers(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  fastPeriod: number,
  slowPeriod: number
): Array<{
  time: number
  type: 'golden' | 'dead'  // 金叉或死叉
  price: number           // 交叉点价格
  atr: number             // 交叉点ATR值
  atrPercent: number      // ATR波动率百分比
  fastEMA: number         // 快线EMA值
  slowEMA: number         // 慢线EMA值
}> {
  if (klineData.length < Math.max(fastPeriod, slowPeriod) + 1) {
    return []
  }

  const fastEMA = calculateEMASeries(klineData, fastPeriod)
  const slowEMA = calculateEMASeries(klineData, slowPeriod)
  const atrSeries = calculateATRSeries(klineData, 14)

  const crossovers: Array<{
    time: number
    type: 'golden' | 'dead'
    price: number
    atr: number
    atrPercent: number
    fastEMA: number
    slowEMA: number
  }> = []

  // 从第2个数据点开始检测交叉
  for (let i = 1; i < klineData.length; i++) {
    const currentFast = fastEMA[i]?.value || 0
    const currentSlow = slowEMA[i]?.value || 0
    const prevFast = fastEMA[i - 1]?.value || 0
    const prevSlow = slowEMA[i - 1]?.value || 0

    // 检测金叉：快线从下方上穿慢线
    const goldenCross = prevFast <= prevSlow && currentFast > currentSlow
    
    // 检测死叉：快线从上方下穿慢线
    const deadCross = prevFast >= prevSlow && currentFast < currentSlow

    if (goldenCross || deadCross) {
      const kline = klineData[i]
      const atrData = atrSeries[i]
      
      if (kline && atrData) {
        const atrPercent = calculateATRPercent(atrData.value, kline.c)
        
        crossovers.push({
          time: kline.t,
          type: goldenCross ? 'golden' : 'dead',
          price: kline.c,
          atr: atrData.value,
          atrPercent,
          fastEMA: currentFast,
          slowEMA: currentSlow
        })
      }
    }
  }

  return crossovers
}

/**
 * 获取EMA交叉标记的颜色
 * @param type 交叉类型
 * @returns 颜色值
 */
export function getEMACrossoverColor(type: 'golden' | 'dead'): string {
  return type === 'golden' ? '#26a69a' : '#ef5350'
}

/**
 * 获取EMA交叉标记的形状
 * @param type 交叉类型
 * @returns 形状名称
 */
export function getEMACrossoverShape(type: 'golden' | 'dead'): 'arrowUp' | 'arrowDown' {
  return type === 'golden' ? 'arrowUp' : 'arrowDown'
}

/**
 * 获取EMA交叉标记的文本
 * @param type 交叉类型
 * @param atrPercent ATR波动率百分比
 * @returns 标记文本
 */
export function getEMACrossoverText(type: 'golden' | 'dead', atrPercent: number): string {
  const typeText = type === 'golden' ? '金叉' : '死叉'
  return `${typeText} ATR:${atrPercent.toFixed(2)}%`
}
