/**
 * RSI计算工具函数
 * 用于在客户端计算RSI值
 */

/**
 * 计算RSI值
 * @param prices 价格数组（通常是收盘价）
 * @param period RSI周期，默认为14
 * @returns RSI值数组，长度与输入相同，值范围0-100
 */
export function calculateRSI(
  prices: number[],
  period: number = 14
): number[] {
  if (prices.length === 0 || period <= 0) {
    return []
  }

  const rsiValues: number[] = []
  const gains: number[] = []
  const losses: number[] = []

  // 计算价格变化
  for (let i = 1; i < prices.length; i++) {
    const change = (prices[i] || 0) - (prices[i - 1] || 0)
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }

  // 初始平均增益和平均损失
  if (gains.length < period) {
    // 数据不足时返回0填充
    return new Array(prices.length).fill(0)
  }

  // 计算第一个周期的平均增益和损失
  let avgGain = gains.slice(0, period).reduce((sum, val) => sum + val, 0) / period
  let avgLoss = losses.slice(0, period).reduce((sum, val) => sum + val, 0) / period

  // 第一个RSI值
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  let rsi = 100 - (100 / (1 + rs))
  rsiValues.push(rsi)

  // 计算后续RSI值（使用平滑移动平均）
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + (gains[i] || 0)) / period
    avgLoss = (avgLoss * (period - 1) + (losses[i] || 0)) / period

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsi = 100 - (100 / (1 + rs))
    rsiValues.push(rsi)
  }

  // 填充前面的空值
  const emptyValues = new Array(prices.length - rsiValues.length).fill(0)
  return [...emptyValues, ...rsiValues]
}

/**
 * 计算RSI并返回与时间戳对齐的数据
 * @param klineData K线数据数组
 * @param period RSI周期，默认为14
 * @param priceField 使用的价格字段，默认为收盘价'c'
 * @returns 包含时间和值的RSI数据数组
 */
export function calculateRSISeries(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number = 14,
  priceField: 'c' | 'o' | 'h' | 'l' = 'c'
): Array<{ time: number; value: number }> {
  if (klineData.length < period + 1) {
    return []
  }

  const prices = klineData.map(item => item[priceField])
  const rsiValues = calculateRSI(prices, period)

  // 返回与时间戳对齐的数据
  return klineData.map((item, index) => ({
    time: item.t,
    value: rsiValues[index] || 0
  }))
}