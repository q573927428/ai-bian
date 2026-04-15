/**
 * ADX计算工具函数
 * 用于在客户端计算ADX、+DI、-DI值
 */

/**
 * 计算ADX相关指标
 * @param klineData K线数据数组
 * @param period ADX周期，默认为14
 * @returns 包含+DI、-DI、ADX值的对象数组
 */
export function calculateADX(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number = 14
): Array<{ plusDI: number; minusDI: number; adx: number }> {
  if (klineData.length < period + 1) {
    return new Array(klineData.length).fill({ plusDI: 0, minusDI: 0, adx: 0 })
  }

  const trValues: number[] = []
  const plusDMValues: number[] = []
  const minusDMValues: number[] = []

  // 计算TR、+DM、-DM
  for (let i = 1; i < klineData.length; i++) {
    const current = klineData[i]
    const previous = klineData[i - 1]
    if (!current || !previous) continue

    // 计算真实波幅TR
    const tr1 = current.h - current.l
    const tr2 = Math.abs(current.h - previous.c)
    const tr3 = Math.abs(current.l - previous.c)
    const tr = Math.max(tr1, tr2, tr3)
    trValues.push(tr)

    // 计算方向运动DM
    const upMove = current.h - previous.h
    const downMove = previous.l - current.l

    let plusDM = 0
    let minusDM = 0

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove
    }

    plusDMValues.push(plusDM)
    minusDMValues.push(minusDM)
  }

  // 计算平滑TR、+DM、-DM
  const smoothTR: number[] = []
  const smoothPlusDM: number[] = []
  const smoothMinusDM: number[] = []

  // 初始平滑值（前period个值的和）
  let sumTR = trValues.slice(0, period).reduce((sum, val) => sum + val, 0)
  let sumPlusDM = plusDMValues.slice(0, period).reduce((sum, val) => sum + val, 0)
  let sumMinusDM = minusDMValues.slice(0, period).reduce((sum, val) => sum + val, 0)

  smoothTR.push(sumTR)
  smoothPlusDM.push(sumPlusDM)
  smoothMinusDM.push(sumMinusDM)

  // 后续平滑值
  for (let i = period; i < trValues.length; i++) {
    sumTR = sumTR - sumTR / period + (trValues[i] || 0)
    sumPlusDM = sumPlusDM - sumPlusDM / period + (plusDMValues[i] || 0)
    sumMinusDM = sumMinusDM - sumMinusDM / period + (minusDMValues[i] || 0)

    smoothTR.push(sumTR)
    smoothPlusDM.push(sumPlusDM)
    smoothMinusDM.push(sumMinusDM)
  }

  // 计算+DI、-DI
  const plusDI: number[] = []
  const minusDI: number[] = []
  const dxValues: number[] = []

  for (let i = 0; i < smoothTR.length; i++) {
    const tr = smoothTR[i] || 0
    const plusDM = smoothPlusDM[i] || 0
    const minusDM = smoothMinusDM[i] || 0

    const diPlus = tr === 0 ? 0 : (plusDM / tr) * 100
    const diMinus = tr === 0 ? 0 : (minusDM / tr) * 100

    plusDI.push(diPlus)
    minusDI.push(diMinus)

    // 计算DX
    const diff = Math.abs(diPlus - diMinus)
    const sum = diPlus + diMinus
    const dx = sum === 0 ? 0 : (diff / sum) * 100
    dxValues.push(dx)
  }

  // 计算ADX（DX的平滑移动平均）
  const adxValues: number[] = []

  if (dxValues.length >= period) {
    // 初始ADX是前period个DX的平均值
    let sumDX = dxValues.slice(0, period).reduce((sum, val) => sum + val, 0)
    let adx = sumDX / period
    adxValues.push(adx)

    // 后续ADX平滑计算
    for (let i = period; i < dxValues.length; i++) {
      adx = (adx * (period - 1) + (dxValues[i] || 0)) / period
      adxValues.push(adx)
    }
  }

  // 组装结果
  const result: Array<{ plusDI: number; minusDI: number; adx: number }> = []

  // 前面 2*period -1 根K线ADX值为0（需要足够数据计算）
  const validStartIndex = 2 * period - 1
  
  // 填充前面的空值
  for (let i = 0; i < validStartIndex; i++) {
    // 前period根没有DI值，后面的period-1根有DI值但没有ADX值
    const diIndex = i - period
    result.push({
      plusDI: diIndex >= 0 ? (plusDI[diIndex] || 0) : 0,
      minusDI: diIndex >= 0 ? (minusDI[diIndex] || 0) : 0,
      adx: 0
    })
  }

  // 填充ADX计算完成后的值
  for (let i = 0; i < adxValues.length; i++) {
    const diIndex = validStartIndex - period + i
    result.push({
      plusDI: plusDI[diIndex] || 0,
      minusDI: minusDI[diIndex] || 0,
      adx: adxValues[i] || 0
    })
  }

  // 确保结果长度和输入K线长度一致
  while (result.length < klineData.length) {
    result.push({ plusDI: 0, minusDI: 0, adx: 0 })
  }
  
  // 如果结果超长，截断
  if (result.length > klineData.length) {
    result.splice(klineData.length)
  }

  return result
}

/**
 * 计算ADX并返回与时间戳对齐的数据
 * @param klineData K线数据数组
 * @param period ADX周期，默认为14
 * @returns 包含时间、ADX、+DI、-DI的数组
 */
export function calculateADXSeries(
  klineData: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  period: number = 14
): Array<{ time: number; adx: number; plusDI: number; minusDI: number }> {
  const adxValues = calculateADX(klineData, period)

  // 返回与时间戳对齐的数据
  return klineData.map((item, index) => ({
    time: item.t,
    adx: adxValues[index]?.adx || 0,
    plusDI: adxValues[index]?.plusDI || 0,
    minusDI: adxValues[index]?.minusDI || 0
  }))
}
