<!-- ==================== 任意本地合约价格比值看板 ==================== -->
<template>
  <section class="ratio-panel" v-loading="loading">
    <header>
      <strong :title="`同一时刻的合约收盘价相除，上涨表示分子更强；本周期未结束时使用盘中价格。滚轮缩放，放大后拖动平移；底部滑块选择范围。\n${lastTime ? `末点周期起始 ${formatTime(lastTime)}` : '暂无数据'}`">币种相对强弱</strong>
      <div class="ratio-summary">
        <span>{{ coin(numerator) }} / {{ coin(denominator) }} <strong>{{ lastRatio }}</strong></span>
        <small>{{ unfinished ? '本根未收盘' : '已收盘' }}{{ stale ? ' · 行情较旧' : '' }}</small>
        <small v-if="points.length" class="history-range">{{ historyRange }} · {{ points.length }}点</small>
      </div>
    </header>
    <div class="ratio-controls">
      <el-select v-model="numerator" size="small" filterable aria-label="分子币种">
        <el-option v-for="symbol in symbols" :key="symbol" :label="coin(symbol)" :value="symbol" />
      </el-select>
      <el-button size="small" aria-label="交换分子分母" @click="swap">⇄</el-button>
      <el-select v-model="denominator" size="small" filterable aria-label="分母币种">
        <el-option v-for="symbol in symbols" :key="symbol" :label="coin(symbol)" :value="symbol" />
      </el-select>
      <el-select v-model="timeframe" size="small" aria-label="比值图独立周期">
        <el-option v-for="entry in periods" :key="entry.value" :label="entry.label" :value="entry.value" />
      </el-select>
    </div>
    <div v-if="displayError" class="ratio-error" role="status">{{ displayError }}</div>
    <div ref="element" class="ratio-chart" />
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { KLineTimeframe } from '../../types/kline-simple'
import type { RatioPoint } from '../utils/relative-market-calculations'
import { useTheme } from '../composables/useTheme'
import { getChartTooltipTheme } from '../utils/chart-tooltip-theme'

const props = defineProps<{ refreshVersion: number; days: number }>()
const periods: { value: KLineTimeframe; label: string; seconds: number }[] = [
  { value: '5m', label: '5分钟', seconds: 300 }, { value: '15m', label: '15分钟', seconds: 900 },
  { value: '1h', label: '1小时', seconds: 3600 }, { value: '4h', label: '4小时', seconds: 14400 },
  { value: '1d', label: '日线', seconds: 86400 }, { value: '1w', label: '周线', seconds: 604800 },
]
const numerator = ref('ETHUSDT'), denominator = ref('BTCUSDT')
const timeframe = ref<KLineTimeframe>('4h')
const available = ref<string[]>(['ETHUSDT', 'BTCUSDT', 'SOLUSDT', 'DOGEUSDT'])
const symbols = computed(() => [...new Set([...available.value, numerator.value, denominator.value])].sort())
const element = ref<HTMLDivElement>()
const loading = ref(false), error = ref('')
const sourcePoints = ref<RatioPoint[]>([])
// 与其余趋势图采用相同的 UTC 自然日窗口；采样周期独立，切换全局范围不重复请求行情。
const points = computed(() => {
  const end = Date.parse(new Date().toISOString().slice(0, 10)) / 1000
  const start = end - (props.days - 1) * 86400
  return sourcePoints.value.filter(point => point.t >= start && point.t < end + 86400)
})
const displayError = computed(() => error.value || (!loading.value && sourcePoints.value.length && !points.value.length ? '所选时间范围内暂无共同行情' : ''))
const { theme } = useTheme()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
let controller: AbortController | undefined
const optionsController = new AbortController()
let version = 0, disposed = false
const coin = (symbol: string) => symbol.replace(/USDT$/, '')
const formatTime = (time: number) => new Date(time * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const historyRange = computed(() => {
  const date = (time: number) => new Date(time * 1000).toLocaleDateString('zh-CN')
  return points.value.length ? `${date(points.value[0]!.t)} — ${date(points.value.at(-1)!.t)}` : ''
})
const lastTime = computed(() => points.value.at(-1)?.t)
const lastRatio = computed(() => points.value.at(-1)?.value.toPrecision(7) ?? '—')
const step = computed(() => periods.find(entry => entry.value === timeframe.value)!.seconds)
const unfinished = computed(() => lastTime.value !== undefined && lastTime.value + step.value > Date.now() / 1000)
const stale = computed(() => lastTime.value !== undefined && Date.now() / 1000 - lastTime.value - step.value > 2 * step.value)

/** 交换整个比较方向，Vue 同轮更新合并为一次行情加载。 */
function swap() { [numerator.value, denominator.value] = [denominator.value, numerator.value] }

/** 同时刻收盘价形成比值曲线，缺口断线；价格轴随标签宽度和当前可视数据自适应。 */
function render() {
  if (!chart || !element.value) return
  if (!points.value.length) { chart.clear(); return }
  const bars = points.value
  const end = bars.at(-1)!.t
  const start = Math.max(bars[0]!.t, end - 494 * step.value)
  const times = Array.from({ length: Math.floor((end - start) / step.value) + 1 }, (_, i) => start + i * step.value)
  const lookup = new Map(bars.map(bar => [bar.t, bar]))
  // 自动刷新和主题切换保留用户选择的区间；切换币种或周期清图后才恢复完整历史。
  const zoom = (chart.getOption()?.dataZoom as { start?: number; end?: number }[] | undefined)?.[0]
  const text = theme.value === 'dark' ? '#c4cbd5' : '#596579'
  chart.setOption({
    animation: false,
    // 由 ECharts 按真实刻度宽度收缩绘图区，避免固定预留80px导致小数价格轴大面积留白。
    grid: { left: 8, right: 8, top: 8, bottom: 28, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: { ...getChartTooltipTheme(element.value), trigger: 'axis', confine: true,
      formatter: (params: any) => {
        const entry = Array.isArray(params) ? params[0] : params
        const time = times[entry?.dataIndex]
        const bar = time === undefined ? undefined : lookup.get(time)
        return bar ? `${new Date(bar.t * 1000).getFullYear()}/${formatTime(bar.t)}<br>比值 ${bar.value.toPrecision(7)}${bar.t + step.value > Date.now() / 1000 ? '（本周期未结束）' : ''}` : '该时刻缺少共同行情'
      } },
    xAxis: { type: 'category', data: times.map(formatTime), axisLabel: { color: text, fontSize: 9, hideOverlap: true }, axisLine: { lineStyle: { color: text, opacity: .25 } } },
    yAxis: { type: 'value', position: 'right', scale: true, splitNumber: 3, axisLabel: { color: text, fontSize: 9, formatter: (value: number) => Number(value.toPrecision(5)).toString() }, splitLine: { lineStyle: { color: text, opacity: .12 } } },
    // 图内滚轮缩放、按住拖动平移；阻止拖图时选中文字或带动页面，图外仍可正常滚动。
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, start: zoom?.start ?? 0, end: zoom?.end ?? 100,
        zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: true },
      { type: 'slider', start: zoom?.start ?? 0, end: zoom?.end ?? 100, height: 9, bottom: 3, showDetail: false, borderColor: 'transparent' },
    ],
    series: [{ type: 'line', name: '收盘价格比值', showSymbol: false, connectNulls: false, smooth: false,
      lineStyle: { color: '#35c98c', width: 1.8 }, itemStyle: { color: '#35c98c' },
      data: times.map(time => lookup.get(time)?.value ?? null) }],
  } as echarts.EChartsOption, { notMerge: true })
}

/** 只读取本站行情；切换选择即取消旧请求，避免慢响应覆盖新组合。 */
async function load() {
  const request = ++version
  controller?.abort()
  error.value = ''
  if (numerator.value === denominator.value) { loading.value = false; error.value = '请选择不同的两个币种'; sourcePoints.value = []; render(); return }
  controller = new AbortController()
  loading.value = true
  try {
    const response = await $fetch<{ points: RatioPoint[] }>('/api/market/ratio', {
      query: { left: numerator.value, right: denominator.value, timeframe: timeframe.value }, signal: controller.signal, timeout: 15000, retry: 0,
    })
    if (disposed || request !== version) return
    sourcePoints.value = response.points
    if (!sourcePoints.value.length) error.value = '所选币种在此周期没有共同行情，请更换币种或周期'
    render()
  } catch (reason) {
    if (!disposed && request === version) error.value = points.value.length ? '刷新失败，当前保留上次行情' : '本地行情读取失败，请稍后刷新'
  } finally { if (!disposed && request === version) loading.value = false }
}

watch([numerator, denominator, timeframe], () => {
  sourcePoints.value = []; render()
  try { localStorage.setItem('trend-ratio-preference', JSON.stringify({ numerator: numerator.value, denominator: denominator.value, timeframe: timeframe.value })) } catch { /* 浏览器禁用存储时仍允许切换。 */ }
  void load()
})
watch(() => props.refreshVersion, () => { void load() })
// 全局范围切换时展示新窗口全貌，避免沿用上个窗口的局部缩放造成时间范围误判。
watch(() => props.days, () => { chart?.clear(); render() })
watch(theme, render)
onMounted(async () => {
  if (!element.value) return
  chart = echarts.init(element.value)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(element.value)
  try {
    const saved = JSON.parse(localStorage.getItem('trend-ratio-preference') || 'null')
    if (saved && /^[A-Z0-9]+USDT$/.test(saved.numerator) && /^[A-Z0-9]+USDT$/.test(saved.denominator) && periods.some(entry => entry.value === saved.timeframe)) {
      numerator.value = saved.numerator; denominator.value = saved.denominator; timeframe.value = saved.timeframe
    }
  } catch { /* 损坏的偏好回退到 ETH/BTC、4小时。 */ }
  void load()
  try {
    const result = await $fetch<{ success: boolean; data?: { symbols: { symbol: string }[] } }>('/api/kline-simple', { query: { action: 'stored-symbols' }, signal: optionsController.signal, timeout: 15000, retry: 0 })
    if (!disposed && result.success) available.value = (result.data?.symbols ?? []).map(entry => entry.symbol).filter(symbol => /^[A-Z0-9]+USDT$/.test(symbol))
  } catch { /* 币种列表失败时仍可使用默认组合。 */ }
})
onBeforeUnmount(() => { disposed = true; version++; controller?.abort(); optionsController.abort(); observer?.disconnect(); chart?.dispose() })
</script>
<style scoped>
.ratio-panel { display: flex; flex-direction: column; min-width: 0; }
header { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 5px 8px 2px; color: var(--text-primary); font-size: 12px; }
header strong { flex-shrink: 0; cursor: help; }
small { color: var(--text-secondary); font-size: 10px; }
.ratio-controls { display: flex; flex: 0 0 auto; min-width: 0; gap: 4px; padding: 0 8px 2px; }
.ratio-controls .el-select { flex: 1; min-width: 0; }
.ratio-controls .el-button { margin: 0; padding: 5px 8px; }
.ratio-summary { display: flex; flex: 1; min-width: 0; align-items: baseline; gap: 6px; font-size: 10px; color: var(--text-primary); white-space: nowrap; overflow-x: auto; }
.ratio-summary > * { flex-shrink: 0; }
.ratio-chart { flex: 1; min-height: 0; width: 100%; }
.history-range { margin-left: auto; font-size: 10px; }
.ratio-error { padding: 2px 12px; font-size: 11px; color: var(--el-color-warning); }
</style>
