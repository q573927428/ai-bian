// ==================== K 线工作台副图序列 ====================
import type { KLineTimeframe, SimpleKLineData } from '../../types/kline-simple'
import { calculateAdxChartSeries } from './adx-chart-series.ts'
import { calculateContractFlow } from './contract-order-flow.ts'
import { calculateErChartSeries } from './er-chart-series.ts'
import { calculateMacdChartSeries } from './macd-chart-series.ts'
import { calculateRsiChartSeries } from './rsi-chart-series.ts'

export const KLINE_INDICATORS = ['CVD', 'DELTA', 'DMI', 'RSI', 'ER20', 'MACD'] as const
export type KlineIndicator = typeof KLINE_INDICATORS[number]

// 图例与绘图共用配色；ADX 用较粗的中性色线，避免被误认成方向线。
export const KLINE_DMI_LINES = [
  { label: 'ADX', key: 'adx', color: '#7e8798', lineWidth: 2 },
  { label: '+DI', key: 'pdi', color: '#26a69a', lineWidth: 1 },
  { label: '-DI', key: 'mdi', color: '#ef5350', lineWidth: 1 }
] as const
export type KlineDmiLine = typeof KLINE_DMI_LINES[number]['label']

export const DEFAULT_KLINE_INDICATOR: KlineIndicator = 'MACD'
// 工作台的图表周期跟随行情接口，不扩展交易策略可用周期。
export const KLINE_WORKSPACE_PERIODS = ['5m', '15m', '1h', '4h', '1d', '1w'] as const satisfies readonly KLineTimeframe[]
export type KlineWorkspacePeriod = typeof KLINE_WORKSPACE_PERIODS[number]
const PERIOD_SECONDS: Record<KlineWorkspacePeriod, number> = {
  '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800
}

/** 副图数值与原始 K 线一一对应，null 代表预热或数据缺失，而非零。 */
export interface KlineIndicatorSeries {
  label: string
  kind: 'line' | 'histogram'
  color: string
  lineWidth?: 1 | 2
  values: (number | null)[]
}

/** 仅计算正在查看的指标；复用指标页算法，不需要再获取一份历史行情。 */
export function getKlineIndicatorSeries(indicator: KlineIndicator, bars: SimpleKLineData[], timeframe: KlineWorkspacePeriod, now = Date.now()): KlineIndicatorSeries[] {
  const step = PERIOD_SECONDS[timeframe]
  switch (indicator) {
    case 'CVD':
    case 'DELTA': {
      const flow = calculateContractFlow(bars, step)
      return indicator === 'CVD'
        ? [{ label: 'CVD', kind: 'line', color: '#409eff', values: flow.cvd }]
        : [{ label: 'Delta', kind: 'histogram', color: '#26a69a', values: flow.delta }]
    }
    case 'DMI': {
      // 一次计算得到三条线，确保预热空值和行情缺口都对齐到相同的 K 线。
      const dmi = calculateAdxChartSeries(bars, step)
      return KLINE_DMI_LINES.map(({ label, key, color, lineWidth }) => ({
        label, kind: 'line', color, lineWidth, values: dmi.map(point => point?.[key] ?? null)
      }))
    }
    case 'RSI':
      return [{ label: 'RSI', kind: 'line', color: '#9c85ff', values: calculateRsiChartSeries(bars, step) }]
    case 'ER20':
      // 固定使用 20 根，与按钮命名一致；坐标轴用百分比更易辨认。
      return [{ label: 'ER20 %', kind: 'line', color: '#259eaa', values: calculateErChartSeries(bars, timeframe, step, now, 20).map(value => value == null ? null : value * 100) }]
    case 'MACD': {
      const macd = calculateMacdChartSeries(bars, step)
      return [
        { label: 'MACD', kind: 'histogram', color: '#26a69a', values: macd.map(point => point?.histogram ?? null) },
        { label: 'DIF', kind: 'line', color: '#e6a23c', values: macd.map(point => point?.dif ?? null) },
        { label: 'DEA', kind: 'line', color: '#9c85ff', values: macd.map(point => point?.dea ?? null) }
      ]
    }
  }
}
