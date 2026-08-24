// ==================== 资金流与 OI 联合分类器 ====================
import type { FlowOIDirection, FlowOIState, KLineTimeframe, SimpleKLineData } from '../../types/kline-simple'

export const FLOW_OI_THRESHOLDS: Record<KLineTimeframe, { activeFlowDeviationThreshold: number; oiChangePercentThreshold: number }> = {
  '5m': { activeFlowDeviationThreshold: 20, oiChangePercentThreshold: 0.3 },
  '15m': { activeFlowDeviationThreshold: 15, oiChangePercentThreshold: 0.5 },
  '1h': { activeFlowDeviationThreshold: 10, oiChangePercentThreshold: 0.6 },
  '4h': { activeFlowDeviationThreshold: 8, oiChangePercentThreshold: 0.8 },
  '1d': { activeFlowDeviationThreshold: 5, oiChangePercentThreshold: 2 },
  '1w': { activeFlowDeviationThreshold: 2, oiChangePercentThreshold: 2 }
}

function direction(value: number | undefined, threshold: number): FlowOIDirection {
  if (value === undefined || !Number.isFinite(value)) return 'unavailable'
  if (value >= threshold) return 'positive'
  if (value <= -threshold) return 'negative'
  return 'neutral'
}

/** 计算资金流 12 周期 EMA 偏离及 OI 相对上一根有效快照的变化，并输出联合状态。 */
export function classifyFlowOI(data: SimpleKLineData[], timeframe: KLineTimeframe): SimpleKLineData[] {
  const thresholds = FLOW_OI_THRESHOLDS[timeframe]
  const emaValues: number[] = []
  let ema: number | undefined
  return data.map((bar, index) => {
    // 存储字段按方案保存为比例（例如 0.05），分类阈值使用百分点，因此统一转换为百分数。
    const rawRatio = bar.activeDeltaRatio ?? (bar.quoteVolume && bar.quoteVolume > 0 && bar.activeDelta !== undefined ? bar.activeDelta / bar.quoteVolume : undefined)
    const ratio = rawRatio === undefined ? undefined : rawRatio * 100
    if (ratio !== undefined) {
      emaValues.push(ratio)
      // 前 12 个有效点用于建立初始均值，之后按 EMA 递推，缺失点不参与。
      if (emaValues.length === 12) ema = emaValues.reduce((sum, value) => sum + value, 0) / 12
      else if (emaValues.length > 12 && ema !== undefined) ema = (ratio * (2 / 13)) + ema * (11 / 13)
    }
    const validEma = emaValues.length >= 12
    const flowDeviation = ratio !== undefined && ema !== undefined ? ratio - ema : undefined
    // OI 采用上一根有效快照作为基准，保持图表、接口和联合状态使用同一口径。
    let previousOI: number | undefined
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const value = data[previousIndex]?.oiValue
      if (value !== undefined && Number.isFinite(value) && value > 0) {
        previousOI = value
        break
      }
    }
    const oiChange = bar.oiValue !== undefined && Number.isFinite(bar.oiValue) && bar.oiValue > 0 && previousOI !== undefined
      ? bar.oiValue - previousOI
      : undefined
    const oiChangePercent = oiChange !== undefined && previousOI ? oiChange / previousOI * 100 : undefined
    const flowDirection = validEma ? direction(flowDeviation, thresholds.activeFlowDeviationThreshold) : 'unavailable'
    const oiDirection = direction(oiChangePercent, thresholds.oiChangePercentThreshold)
    let state: FlowOIState = 'neutral'
    if (flowDirection === 'unavailable' || oiDirection === 'unavailable') state = 'unavailable'
    else if (flowDirection === 'positive' && oiDirection === 'positive') state = 'long-build'
    else if (flowDirection === 'negative' && oiDirection === 'positive') state = 'short-build'
    else if (flowDirection === 'positive' && oiDirection === 'negative') state = 'short-cover'
    else if (flowDirection === 'negative' && oiDirection === 'negative') state = 'long-liquidation'
    return { ...bar, activeFlowDeviation: flowDeviation, oiChange, oiChangePercent, state }
  })
}
