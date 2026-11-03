<!-- ==================== 宏观市场区间汇总指标图表 ==================== -->
<template>
  <section class="summary-chart">
    <el-radio-group v-model="metric" size="small" aria-label="图表比较指标">
      <el-radio-button value="returnPercent">涨跌幅</el-radio-button>
      <el-radio-button value="relativePercent">相对 BTC</el-radio-button>
      <el-radio-button value="maxDrawdown">最大回撤</el-radio-button>
    </el-radio-group>
    <div class="chart-scroll">
      <div ref="canvas" class="chart-canvas" :style="{ height: `${Math.max(300, rows.length * 34 + 60)}px` }" role="img" :aria-label="`全部 ${rows.length} 个市场的${metricLabel}比较图`" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type ECharts } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from '../../composables/useTheme'
import type { MacroPinnedSummary } from './crosshair-sync'

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

/** 复用表格的原始指标及展示字段，保证两种视图使用同一区间和 BTC 基准。 */
interface SummaryChartRow extends Partial<MacroPinnedSummary> {
  name: string
  relativePercent: number | null
  relativeLabel: string
  relativeHint: string
}
const props = defineProps<{ rows: SummaryChartRow[] }>()
const metric = ref<'returnPercent' | 'relativePercent' | 'maxDrawdown'>('returnPercent')
const metricLabel = computed(() => ({ returnPercent: '涨跌幅', relativePercent: '相对 BTC', maxDrawdown: '最大回撤' })[metric.value])
const canvas = ref<HTMLDivElement>()
const { theme } = useTheme()
let chart: ECharts | undefined
let observer: ResizeObserver | undefined
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const timeLabel = (time?: number) => time == null ? '—' : clock.format(new Date(time * 1000))
const percentLabel = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

/** 最大回撤沿用表格的负值展示；缺失数据保留空值，不能伪装为零收益。 */
function metricValue(row: SummaryChartRow): number | null {
  const value = row[metric.value]
  return value == null || !Number.isFinite(value) ? null : metric.value === 'maxDrawdown' ? -value : value
}

/** 缺失指标仍保留市场名称，并明确区分收益率标的不适用与数据暂缺。 */
function valueLabel(row: SummaryChartRow): string {
  const value = metricValue(row)
  return value == null ? metric.value === 'relativePercent' ? row.relativeLabel : '—' : percentLabel(value)
}

/** 完整呈现原表格的各列信息；richText 避免市场名称被解释为 HTML。 */
function rowTooltip(row: SummaryChartRow): string {
  return [row.name, `起点收盘：${row.from ?? '—'}`, `终点收盘：${row.to ?? '—'}`,
    `涨跌幅：${row.percent ?? '—'}`, `相对 BTC：${row.relativeLabel}`, row.relativeHint,
    `最大回撤：${row.maxDrawdown == null ? '—' : percentLabel(-row.maxDrawdown)}`,
    `相隔时间：${row.duration ?? '—'}`, `起点K线（北京时间）：${timeLabel(row.selectedTime)}`,
    `终点K线（北京时间）：${timeLabel(row.latestTime)}`, `状态：${row.status ?? '—'}`].join('\n')
}

/** 使用全量市场分类轴，不截断排名；数据及主题变化时同步更新。 */
function renderChart() {
  if (!chart || !canvas.value) return
  // ECharts 在 resize 或替换配置时仍可能调用上一轮 formatter。
  // 每轮绑定自己的数据快照，避免市场列表更新后旧索引读到 undefined。
  const rows = [...props.rows]
  const values = rows.map(metricValue)
  const labels = rows.map(valueLabel)
  const categories = rows.map((row, index) => `${row.name}${metricValue(row) == null ? `（${labels[index]}）` : ''}`)
  const styles = getComputedStyle(canvas.value)
  const color = styles.getPropertyValue('--el-text-color-regular').trim() || '#909399'
  const border = styles.getPropertyValue('--el-border-color').trim() || '#454545'
  chart.resize()
  // 负值标签位于柱体左端，必须在绘图区内部预留文字宽度；
  // 单纯扩大 grid.left 会让最左侧柱体随轴一起移动，仍然与市场名称重叠。
  const minimum = Math.min(0, ...values.filter((value): value is number => value != null))
  const maximum = Math.max(0, ...values.filter((value): value is number => value != null))
  const plotWidth = Math.max(1, chart.getWidth() - 170 - 80)
  const labelSpace = Math.min(plotWidth / 2, Math.max(64, ...labels.map(label => label.length * 8 + 16)))
  const axisMinimum = minimum < 0 ? minimum - (maximum - minimum) * labelSpace / (plotWidth - labelSpace) : undefined
  chart.setOption({
    animation: false,
    grid: { left: 170, right: 80, top: 16, bottom: 36 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' }, renderMode: 'richText', confine: true,
      backgroundColor: styles.getPropertyValue('--el-bg-color-overlay').trim() || '#1d1e1f', borderColor: border,
      textStyle: { color, fontSize: 12 },
      formatter: params => {
        const entry = Array.isArray(params) ? params[0] : params
        const row = entry ? rows[entry.dataIndex] : undefined
        return row ? rowTooltip(row) : ''
      },
    },
    xAxis: { type: 'value', min: axisMinimum,
      // 留白边界由像素比例计算，刻度展示需消除浮点尾数，并隐藏空间不足的重叠标签。
      axisLabel: { color, hideOverlap: true, formatter: (value: number) => `${Number(value.toFixed(2))}%` },
      splitLine: { lineStyle: { color: border, opacity: 0.5 } } },
    yAxis: {
      type: 'category', inverse: true, data: categories,
      axisTick: { show: false }, axisLine: { show: false },
      // 轴标签直接使用市场名称，不将 ECharts 的刻度文本强转为业务数组索引。
      axisLabel: { color, interval: 0, width: 155, overflow: 'truncate' },
    },
    series: [{
      type: 'bar', name: metricLabel.value, barMaxWidth: 20,
      data: values.map(value => {
        return { value, itemStyle: { color: value == null || value === 0 ? '#909399' : value > 0 ? '#26a69a' : '#ef5350' },
          label: { position: value != null && value < 0 ? 'left' : 'right' } }
      }),
      label: { show: true, color, fontSize: 12, formatter: params => labels[params.dataIndex] ?? '—' },
    }],
  } satisfies EChartsOption, true)
}

watch([() => props.rows, metric, theme], renderChart, { deep: true, flush: 'post' })
onMounted(() => {
  if (!canvas.value) return
  chart = init(canvas.value)
  observer = new ResizeObserver(renderChart)
  observer.observe(canvas.value)
  renderChart()
})
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); chart = undefined })
</script>

<style scoped>
.summary-chart { min-width: 0; }
.chart-scroll { max-height: 55vh; overflow: auto; margin-top: 12px; }
.chart-canvas { width: 100%; min-width: 540px; }
p { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--el-text-color-secondary); }
</style>
