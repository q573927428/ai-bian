<!-- ==================== 加密趋势通用时间序列图 ==================== -->
<template><div ref="element" class="trend-chart" /></template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, use, type ECharts } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from '../composables/useTheme'
import type { TrendPoint } from '../../types/crypto-trends'

/** 每条美元序列的图形、颜色和左右轴配置。 */
interface ChartSeries { name: string; points: TrendPoint[]; color: string; bar?: boolean; right?: boolean; dashed?: boolean; stack?: string }
const props = defineProps<{ series: ChartSeries[]; days: number; percent?: boolean }>()
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])
const element = ref<HTMLElement | null>(null)
const { theme } = useTheme()
let chart: ECharts | undefined
let observer: ResizeObserver | undefined
const money = (value: number) => {
  const size = Math.abs(value)
  const scale = size >= 1e12 ? 1e12 : size >= 1e9 ? 1e9 : size >= 1e6 ? 1e6 : 1
  return `${value < 0 ? '-' : ''}$${(size / scale).toFixed(scale === 1 ? 0 : 2)}${scale === 1e12 ? 'T' : scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : ''}`
}

/** 所有图使用同一 UTC 日历坐标，缺失点为 null，禁止连线伪造趋势。 */
function render() {
  if (!chart) return
  const end = Date.parse(new Date().toISOString().slice(0, 10))
  const dates = Array.from({ length: props.days }, (_, i) => new Date(end - (props.days - 1 - i) * 86400000).toISOString().slice(0, 10))
  const dark = theme.value === 'dark'
  const text = dark ? '#c4cbd5' : '#596579'
  const label = (value: number) => props.percent ? `${value.toFixed(1)}%` : money(value)
  chart.setOption({
    animation: false, color: props.series.map(s => s.color),
    legend: { top: 2, type: 'scroll', textStyle: { color: text, fontSize: 10 } },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (value: unknown) => typeof value === 'number' ? label(value) : '--' },
    grid: { top: 38, left: 68, right: props.series.some(s => s.right) ? 68 : 16, bottom: 48 },
    xAxis: { type: 'category', data: dates, axisLabel: { color: text, fontSize: 10, formatter: (value: string) => value.slice(5) }, axisLine: { lineStyle: { color: dark ? '#374151' : '#d1d5db' } } },
    yAxis: [0, 1].map(index => ({ type: 'value', scale: true, position: index ? 'right' : 'left', show: !index || props.series.some(s => s.right), axisLabel: { color: text, fontSize: 10, formatter: label }, splitLine: { show: !index, lineStyle: { color: dark ? '#29313c' : '#edf0f4' } } })),
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 13, bottom: 5, showDetail: false, borderColor: 'transparent' }],
    series: props.series.map(s => {
      const lookup = new Map(s.points.map(p => [p.date, p.value]))
      // 共用堆叠组让清算正负柱在同一日期中心对齐；正负数仍分别从零轴向两侧延伸。
      return { name: s.name, type: s.bar ? 'bar' : 'line', stack: s.stack, yAxisIndex: s.right ? 1 : 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2, type: s.dashed ? 'dashed' : 'solid' }, data: dates.map(date => lookup.get(date) ?? null) }
    }),
  }, true)
}
watch(() => [props.series, props.days, props.percent, theme.value], render, { deep: true })
onMounted(() => { if (element.value) { chart = init(element.value); observer = new ResizeObserver(() => chart?.resize()); observer.observe(element.value); render() } })
onUnmounted(() => { observer?.disconnect(); chart?.dispose() })
</script>
<style scoped>
.trend-chart { width: 100%; height: 100%; min-width: 0; }
</style>
