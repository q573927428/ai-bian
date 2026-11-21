// ==================== 共享主图时间轴的指标副图 ====================
import { HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../../types/kline-simple'
import { getKlineIndicatorSeries, KLINE_DMI_LINES, type KlineDmiLine, type KlineIndicator, type KlineWorkspacePeriod } from '../../../utils/kline-indicators.ts'

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })
const indicatorNumber = new Intl.NumberFormat('en', { maximumSignificantDigits: 4, useGrouping: false })

/**
 * 在首页主图使用的同一个图表内增加副图。共用时间轴后，缩放、拖动与悬停无需相互转发。
 * 切换指标只重建副图系列，不改变主图时间范围或副图高度。
 */
export function createIndicatorPane(chart: IChartApi, hiddenDmiLines: ReadonlySet<KlineDmiLine>) {
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
  let previousTimeframe: KlineWorkspacePeriod | undefined

  /** 同一根盘中柱更新时仅推送尾值；切换指标、补历史或整批行情校正则重置序列。 */
  function update(indicator: KlineIndicator, bars: SimpleKLineData[], timeframe: KlineWorkspacePeriod) {
    const validBars = bars.filter(bar => bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0)
    const datasets = getKlineIndicatorSeries(indicator, validBars, timeframe)
    const lastTime = validBars.at(-1)?.t
    const tailOnly = current === indicator && previousBars === bars && previousLength === validBars.length
      && previousTime === lastTime && previousTimeframe === timeframe
    if (current !== indicator) {
      series.forEach(item => chart.removeSeries(item))
      const formatter = indicator === 'CVD' || indicator === 'DELTA' ? compactNumber : indicatorNumber
      series = datasets.map((dataset, index) => {
        const dmiLine = indicator === 'DMI' ? KLINE_DMI_LINES[index] : undefined
        const common = {
          title: dataset.label,
          priceLineVisible: false, // 最新值保留在坐标轴，避免多条横线盖住指标。
          priceFormat: { type: 'custom' as const, minMove: 0.00000001, formatter: (value: number) => formatter.format(value) }
        }
        return dataset.kind === 'histogram'
          ? pane.addSeries(HistogramSeries, { ...common, color: dataset.color })
          : pane.addSeries(LineSeries, {
              ...common,
              color: dataset.color,
              lineWidth: dataset.lineWidth ?? 1,
              // 三条 DMI 线共用右轴，避免不同刻度让交叉位置产生误读。
              ...(dmiLine && { priceScaleId: 'right', visible: !hiddenDmiLines.has(dmiLine.label) })
            })
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

  /** 只更新可见性，避免点击图例时重建数据或改变主图时间范围。 */
  function setHiddenDmiLines(hidden: ReadonlySet<KlineDmiLine>) {
    hiddenDmiLines = hidden
    if (current !== 'DMI') return
    KLINE_DMI_LINES.forEach(({ label }, index) => {
      series[index]?.applyOptions({ visible: !hidden.has(label) })
    })
  }

  return { pane, update, setHiddenDmiLines }
}
