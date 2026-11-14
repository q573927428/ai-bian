<!-- ==================== 加密趋势通用时间序列图 ==================== -->
<template><div ref="element" class="trend-chart" /></template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, use, type ECharts } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from '../composables/useTheme'
import { getChartTooltipTheme } from '../utils/chart-tooltip-theme'
import type { TrendPoint } from '../../types/crypto-trends'
import { beijingDate } from '../utils/beijing-time'
import { trendDisplayPoints } from '../utils/crypto-trend-calculations'

/** 每条序列的图形、颜色和左右轴配置，单位由图表指定。 */
interface ChartSeries { name: string; points: TrendPoint[]; color: string; bar?: boolean; right?: boolean; dashed?: boolean; stack?: string; sentiment?: boolean; latestDisclosure?: boolean }
type AxisFormat = 'money' | 'percent' | 'index' | 'score' | 'points'
const props = defineProps<{ series: ChartSeries[]; days: number; format?: AxisFormat; rightFormat?: AxisFormat; min?: number; max?: number; rightMin?: number; rightMax?: number; referenceLines?: number[]; referenceSeries?: number }>()
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, VisualMapComponent, CanvasRenderer])
const element = ref<HTMLElement | null>(null)
const { theme } = useTheme()
let chart: ECharts | undefined
let observer: ResizeObserver | undefined
const money = (value: number) => {
  const size = Math.abs(value)
  const scale = size >= 1e12 ? 1e12 : size >= 1e9 ? 1e9 : size >= 1e6 ? 1e6 : 1
  return `${value < 0 ? '-' : ''}$${(size / scale).toFixed(scale === 1 ? 0 : 2)}${scale === 1e12 ? 'T' : scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : ''}`
}

/** 所有图以北京时间今天确定可视日期范围，缺失点为 null，不插值。 */
function render() {
  if (!chart || !element.value) return
  const end = Date.parse(beijingDate())
  const dates = Array.from({ length: props.days }, (_, i) => new Date(end - (props.days - 1 - i) * 86400000).toISOString().slice(0, 10))
  const dark = theme.value === 'dark'
  const text = dark ? '#c4cbd5' : '#596579'
  // 参考线跟随指定序列的坐标轴；变化率即使全为正或全为负，也必须看得到零线。
  const referenceSeries = props.referenceSeries ?? 0
  const zeroAxis = props.referenceLines?.includes(0) ? (props.series[referenceSeries]?.right ? 1 : 0) : -1
  const label = (value: number, format = props.format) => format === 'percent' ? `${value.toFixed(2)}%` : format === 'index' ? `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} 点` : format === 'score' ? value.toFixed(0) : format === 'points' ? `${value.toFixed(2)} pp` : money(value)
  chart.setOption({
    animation: false, color: props.series.map(s => s.color),
    // 分档只作用于情绪序列，BTC仍使用低亮度灰线，避免被情绪颜色误导。
    visualMap: props.series.flatMap((s, index) => s.sentiment ? [{ type: 'piecewise', show: false, seriesIndex: index, dimension: 1, pieces: [
      { lt: 25, color: '#f04452', label: '极度恐慌' },
      { gte: 25, lt: 45, color: '#f59e0b', label: '恐慌' },
      { gte: 45, lte: 55, color: '#facc15', label: '中性' },
      { gt: 55, lt: 75, color: '#a3d900', label: '贪婪' },
      { gte: 75, color: '#22c58b', label: '极度贪婪' },
    ] }] : []),
    legend: { top: 0, type: 'scroll', itemWidth: 12, itemHeight: 7, itemGap: 8, textStyle: { color: text, fontSize: 9 } },
    tooltip: { ...getChartTooltipTheme(element.value), trigger: 'axis', confine: true },
    grid: { top: 24, left: 8, right: 8, bottom: 28, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    xAxis: { type: 'category', data: dates, axisLabel: { color: text, fontSize: 10, formatter: (value: string) => value.slice(5) }, axisLine: { lineStyle: { color: dark ? '#374151' : '#d1d5db' } } },
    yAxis: [0, 1].map(index => ({ type: 'value', scale: true, min: (index ? props.rightMin : props.min) ?? (index === zeroAxis ? (extent: { min: number }) => Math.min(0, extent.min) : undefined), max: (index ? props.rightMax : props.max) ?? (index === zeroAxis ? (extent: { max: number }) => Math.max(0, extent.max) : undefined), splitNumber: 3, position: index ? 'right' : 'left', show: !index || props.series.some(s => s.right), axisLabel: { color: text, fontSize: 9, formatter: (value: number) => label(value, index ? props.rightFormat ?? props.format : props.format) }, splitLine: { show: !index, lineStyle: { color: dark ? '#29313c' : '#edf0f4' } } })),
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 9, bottom: 3, showDetail: false, borderColor: 'transparent' }],
    series: props.series.map((s, seriesIndex) => {
      const lookup = new Map(trendDisplayPoints(s.points, Date.now(), s.latestDisclosure).map(p => [p.date, p]))
      // 共用堆叠组让清算正负柱在同一日期中心对齐；正负数仍分别从零轴向两侧延伸。
      return { name: s.name, type: s.bar ? 'bar' : 'line', stack: s.stack, yAxisIndex: s.right ? 1 : 0, showSymbol: false, connectNulls: false,
        z: s.sentiment ? 3 : 2,
        // 色带绑定情绪轴的真实分数，移动BTC价格轴不会改变极端区域的位置。
        markArea: s.sentiment ? { silent: true, label: { show: true, position: 'insideTopRight', color: text, fontSize: 9 }, data: [
          [{ name: '极度恐慌', yAxis: 0, itemStyle: { color: 'rgba(240,68,82,0.10)' } }, { yAxis: 25 }],
          [{ name: '极度贪婪', yAxis: 75, itemStyle: { color: 'rgba(34,197,139,0.10)' } }, { yAxis: 100 }],
        ] } : undefined,
        // 逐序列格式化，避免情绪分数与右轴BTC价格混用单位和盘中标记。
        tooltip: { valueFormatter: (value: unknown, dataIndex: number) => {
          const point = lookup.get(dates[dataIndex]!)
          const state = point?.disclosedDate ? `（最近披露 ${point.disclosedDate}）` : point?.provisional ? '（盘中）' : ''
          return typeof value === 'number' ? `${label(value, s.right ? props.rightFormat ?? props.format : props.format)}${state}` : '--'
        } },
        markLine: seriesIndex === referenceSeries && props.referenceLines?.length ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: text, type: 'dashed', opacity: .4 }, data: props.referenceLines.map(yAxis => ({ yAxis })) } : undefined,
        lineStyle: { width: 2, type: s.dashed ? 'dashed' : 'solid' }, data: dates.map(date => {
        const point = lookup.get(date)
        return point?.provisional ? { value: point.value, itemStyle: { opacity: .55 } } : point?.value ?? null
      }) }
    }),
  }, true)
}
watch(() => [props.series, props.days, props.format, props.rightFormat, props.min, props.max, props.rightMin, props.rightMax, props.referenceLines, props.referenceSeries, theme.value], render, { deep: true })
onMounted(() => { if (element.value) { chart = init(element.value); observer = new ResizeObserver(() => chart?.resize()); observer.observe(element.value); render() } })
onUnmounted(() => { observer?.disconnect(); chart?.dispose() })
</script>
<style scoped>
.trend-chart { width: 100%; height: 100%; min-width: 0; }
</style>
