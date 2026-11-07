// ==================== 热力图周期色阶与图例 ====================
// 短周期采用更小的色阶阈值，避免同样的 ±5% 上限让短线行情全部挤在最浅一档。
const PERIOD_COLOR_THRESHOLDS: Record<string, readonly [number, number, number]> = {
  '5m': [0.05, 0.15, 0.3],
  '15m': [0.1, 0.25, 0.5],
  '1h': [0.2, 0.5, 1],
  '4h': [0.3, 1, 2],
  '24h': [1, 2.5, 5]
}
/** 获取周期对应的浅、中、深颜色阈值。 */
export function getHeatmapColorThresholds(period: string) {
  return PERIOD_COLOR_THRESHOLDS[period] ?? PERIOD_COLOR_THRESHOLDS['24h']!
}

/** 图表配色与标题栏说明共享同一份七档色阶。 */
export function getHeatmapLegend(period: string) {
  const [low, middle, high] = getHeatmapColorThresholds(period)
  return [
    { label: `≤−${high}%`, color: '#b91c32', title: `涨跌幅 ≤ −${high}%` },
    { label: `−${middle}%`, color: '#874047', title: `−${middle}% 的颜色，区间内逐渐过渡` },
    { label: `−${low}%`, color: '#633e44', title: `−${low}% 的颜色，小幅下跌仍保留浅红色` },
    { label: '0%', color: '#41464d', title: '持平或缺失行情；小幅上涨为浅绿，小幅下跌为浅红' },
    { label: `+${low}%`, color: '#344b3a', title: `+${low}% 的颜色，小幅上涨仍保留浅绿色` },
    { label: `+${middle}%`, color: '#2e6844', title: `+${middle}% 的颜色，区间内逐渐过渡` },
    { label: `≥+${high}%`, color: '#10863f', title: `涨跌幅 ≥ +${high}%` }
  ]
}

