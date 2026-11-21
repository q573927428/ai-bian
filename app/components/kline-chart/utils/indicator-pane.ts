// ==================== 共享主图时间轴的指标副图 ====================
import { HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../../types/kline-simple'
import type { Timeframe } from '../../../../types/strategy'
import { getKlineIndicatorSeries, type KlineIndicator } from '../../../utils/kline-indicators'

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })
const indicatorNumber = new Intl.NumberFormat('en', { maximumSignificantDigits: 4, useGrouping: false })

/**
 * 在首页主图使用的同一个图表内增加副图。共用时间轴后，缩放、拖动与悬停无需相互转发。
 * 切换指标只重建副图系列，不改变主图时间范围或副图高度。
 */
export function createIndicatorPane(chart: IChartApi) {
  const pane = chart.addPane(true)
  // 副图默认约占绘图区的 22%，把更多空间留给主图，仍可拖动分隔线调整。
  chart.panes()[0]?.setStretchFactor(3.5)
  pane.setStretchFactor(1)
  pane.priceScale('right').applyOptions({ scaleMargins: { top: 0.18, bottom: 0.12 } })
  let series: (ISeriesApi<'Line'> | ISeriesApi<'Histogram'>)[] = []
  let current: KlineIndicator | undefined
  let previousBars: SimpleKLineData[] | undefined
  let previousLength = 0
  let previousTime: number | undefined
  let previousTimeframe: Timeframe | undefined

  /** 同一根盘中柱更新时仅推送尾值；切换指标、补历史或整批行情校正则重置序列。 */
  function update(indicator: KlineIndicator, bars: SimpleKLineData[], timeframe: Timeframe) {
    const validBars = bars.filter(bar => bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0)
    const datasets = getKlineIndicatorSeries(indicator, validBars, timeframe)
    const lastTime = validBars.at(-1)?.t
    const tailOnly = current === indicator && previousBars === bars && previousLength === validBars.length
      && previousTime === lastTime && previousTimeframe === timeframe
    if (current !== indicator) {
      series.forEach(item => chart.removeSeries(item))
      const formatter = indicator === 'CVD' || indicator === 'DELTA' ? compactNumber : indicatorNumber
      series = datasets.map(dataset => {
        const common = {
          title: dataset.label,
          priceLineVisible: false, // 最新值保留在坐标轴，避免多条横线盖住指标。
          priceFormat: { type: 'custom' as const, minMove: 0.00000001, formatter: (value: number) => formatter.format(value) }
        }
        return dataset.kind === 'histogram'
          ? pane.addSeries(HistogramSeries, { ...common, color: dataset.color })
          : pane.addSeries(LineSeries, { ...common, color: dataset.color, lineWidth: 1 })
      })
      current = indicator
    }
    datasets.forEach((dataset, index) => {
      const target = series[index]
      if (!target) return
      const pointAt = (bar: SimpleKLineData, barIndex: number) => {
        const value = dataset.values[barIndex]
        const time = bar.t as UTCTimestamp
        if (value == null) return { time }
        return dataset.kind === 'histogram'
          ? { time, value, color: value >= 0 ? dataset.color : '#ef5350' }
          : { time, value }
      }
      const last = validBars.at(-1)
      if (tailOnly && last) target.update(pointAt(last, validBars.length - 1))
      else target.setData(validBars.map(pointAt))
    })
    previousBars = bars
    previousLength = validBars.length
    previousTime = lastTime
    previousTimeframe = timeframe
  }

  return { pane, update }
}
