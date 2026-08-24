<template>
  <section class="flow-oi-panel" :class="props.theme">
    <div class="panel-meta">
      <strong>资金流与 OI</strong>
      <template v-if="latest">
      <span>成交额 {{ format(latest.quoteVolume) }}</span><span>主动净流 {{ format(latest.activeDelta) }} ({{ formatRatioPercent(latest.activeDeltaRatio) }})</span> <span>偏离 {{ formatPercent(latest.activeFlowDeviation) }}</span>
      <span>OI变化 {{ formatPercent(latest.oiChangePercent) }}</span>
      <el-tag size="small" effect="plain" :class="['state-tag', stateClass]">{{ stateLabel }}</el-tag>
      </template>
    </div>
    <div v-if="loading" class="empty">加载中...</div>
    <div v-else-if="!rows.length" class="empty">暂无资金流数据</div>
    <div v-show="!loading && rows.length" ref="chartRef" class="plots" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createChart, HistogramSeries, ColorType } from 'lightweight-charts'
import type { KLineTimeframe } from '../../../types/kline-simple'
/** 副图接口返回的单根资金流与 OI 摘要。 */
interface FlowRow { t: number; c: number; quoteVolume: number | null; activeDelta: number | null; activeDeltaRatio: number | null; activeFlowDeviation: number | null; oiChangePercent: number | null; state: string }
/** 副图输入参数，负责复用主图的主题和时间轴视口配置。 */
interface Props {
  symbol: string
  timeframe: KLineTimeframe
  /** 主图当前最后一根 K 线时间，用于临时柱出现时推进副图时间轴。 */
  latestKlineTime?: number | null
  /** 主图最后一根 K 线数据修订号，时间戳不变但成交量/资金流字段更新时使用。 */
  latestKlineRevision?: number
  theme?: 'light' | 'dark'
  /** 主图时间轴可视范围（秒），为空时显示接口返回的最新数据。 */
  visibleRange?: [number, number] | null
  /** 主图时间轴右侧预留的 K 线数量。 */
  rightOffset?: number
  /** 主图时间轴的逻辑索引范围，优先于时间范围用于严格对齐缩放。 */
  visibleLogicalRange?: [number, number] | null
  /** 主图相邻 K 线中心点的像素间距。 */
  barSpacing?: number
  /** 主图时间轴实际绘图区宽度，不包含价格轴。 */
  timeScaleWidth?: number
  /** 主图十字光标所在的 K 线时间（秒）。 */
  crosshairTime?: number | null
}
const props = withDefaults(defineProps<Props>(), {
  latestKlineTime: null,
  latestKlineRevision: 0,
  theme: 'dark',
  visibleRange: null,
  visibleLogicalRange: null,
  rightOffset: 12,
  barSpacing: 6,
  timeScaleWidth: 0,
  crosshairTime: null
})
const rows = ref<FlowRow[]>([]); const loading = ref(false)
const activeCrosshairTime = ref<number | null>(null)
const chartRef = ref<HTMLElement | null>(null)
let chart: any = null
let flowSeries: any = null
let oiSeries: any = null
let resizeObserver: ResizeObserver | null = null
const visibleRows = computed(() => {
  const range = props.visibleRange
  if (!range) return rows.value
  return rows.value.filter(row => row.t >= range[0] && row.t <= range[1])
})
const hoveredRow = computed(() => activeCrosshairTime.value == null ? null : rows.value.find(row => row.t === activeCrosshairTime.value) || null)
const latest = computed(() => hoveredRow.value || visibleRows.value.at(-1) || rows.value.at(-1))
const oiMax = computed(() => Math.max(1, ...visibleRows.value.map(row => Math.abs(row.oiChangePercent || 0))))
const stateLabels: Record<string, string> = { 'long-build': '多头增仓', 'short-build': '空头增仓', 'short-cover': '空头回补', 'long-liquidation': '多头平仓', neutral: '中性', unavailable: '数据不足' }
const stateClass = computed(() => {
  const state = latest.value?.state || 'unavailable'
  return Object.prototype.hasOwnProperty.call(stateLabels, state) ? state : 'unavailable'
})
const stateLabel = computed(() => stateLabels[stateClass.value] || stateLabels.unavailable)
const format = (value: number | null | undefined) => value == null ? '暂无' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
// 主动净流比例是 0~1 小数，展示时需要转换为百分数；OI 变化率则已是百分点，两者口径不同。
const formatRatioPercent = (value: number | null | undefined) => value == null ? '暂无' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(3)}%`
const formatPercent = (value: number | null | undefined) => value == null ? '暂无' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}%`
const formatChartTime = (time: number) => new Date(time * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const formatTooltipTime = (time: number) => new Date(time * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
// OI 接口返回的数值单位是“百分点”（例如 0.6 表示 0.6%），不能使用
// lightweight-charts 的 percent 格式（该格式会把数值再乘以 100）。
const oiPriceFormat = { type: 'custom' as const, minMove: 0.001, formatter: (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}%` }
// 顶部资金流柱使用与“偏离”摘要相同的百分点口径，避免金额量纲掩盖偏离幅度。
const flowPriceFormat = { type: 'custom' as const, minMove: 0.001, formatter: (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}%` }
const chartOptions = () => ({ layout: { background: { type: ColorType.Solid, color: props.theme === 'dark' ? '#131722' : '#ffffff' }, textColor: props.theme === 'dark' ? '#d9d9d9' : '#333333' }, grid: { vertLines: { color: props.theme === 'dark' ? '#2b2b43' : '#f0f3fa' }, horzLines: { color: props.theme === 'dark' ? '#2b2b43' : '#f0f3fa' } }, rightPriceScale: { borderColor: props.theme === 'dark' ? '#2b2b43' : '#cccccc', scaleMargins: { top: 0.1, bottom: 0.1 } }, timeScale: { visible: true, timeVisible: true, secondsVisible: false, rightOffset: props.rightOffset, borderColor: props.theme === 'dark' ? '#2b2b43' : '#cccccc', tickMarkFormatter: formatChartTime }, localization: { timeFormatter: formatTooltipTime }, crosshair: { vertLine: { color: props.theme === 'dark' ? '#94a3b8' : '#64748b' }, horzLine: { color: 'transparent' } }, handleScroll: false, handleScale: false })

/**
 * 按主图的像素缩放参数同步副图时间轴。
 *
 * 两张图的价格轴宽度可能不同，因此需要把绘图区宽度差换算成 K 线数量，
 * 再修正右侧滚动位置；仅复制逻辑范围会让图表库各自算出不同的柱间距。
 */
const syncTimeScale = () => {
  if (!chart) return
  const timeScale = chart.timeScale()

  if (props.visibleLogicalRange) {
    timeScale.setVisibleLogicalRange({ from: props.visibleLogicalRange[0], to: props.visibleLogicalRange[1] })
  } else if (props.visibleRange) {
    timeScale.setVisibleRange({ from: props.visibleRange[0], to: props.visibleRange[1] })
  }

  if (props.barSpacing <= 0 || props.timeScaleWidth <= 0) {
    timeScale.scrollToPosition(props.rightOffset, false)
    return
  }

  timeScale.applyOptions({ barSpacing: props.barSpacing })
  const widthOffsetInBars = (timeScale.width() - props.timeScaleWidth) / props.barSpacing
  timeScale.scrollToPosition(props.rightOffset + widthOffsetInBars, false)
}

/**
 * 将主图刚追加的临时 K 线补进副图时间序列。
 * 后端尚未完成同步时使用 whitespace 点占位，避免副图比主图少一根柱；
 * 下一次接口刷新返回真实数据后，按时间戳去重并自动替换该占位点。
 */
const syncLatestKline = () => {
  const latestTime = props.latestKlineTime
  if (latestTime == null || !Number.isFinite(latestTime)) return
  if (rows.value.some(row => row.t === latestTime)) return
  rows.value = [...rows.value, {
    t: latestTime,
    c: 0,
    quoteVolume: null,
    activeDelta: null,
    activeDeltaRatio: null,
    activeFlowDeviation: null,
    oiChangePercent: null,
    state: 'unavailable'
  }].sort((a, b) => a.t - b.t)
}

const updateCharts = () => {
  if (!flowSeries || !oiSeries) return
  syncLatestKline()
  // 保留完整时间序列，避免副图因重新设置数据而产生独立的时间轴索引。
  // 缺失值使用 whitespace 点，不把 0 纳入自动缩放范围，避免 OI 轴长期显示固定的极小刻度。
  flowSeries.setData(rows.value.map(row => row.activeFlowDeviation == null
    ? { time: row.t }
    : { time: row.t, value: row.activeFlowDeviation, color: row.activeFlowDeviation >= 0 ? '#22c55e' : '#ef4444' }))
  oiSeries.setData(rows.value.map(row => row.oiChangePercent == null
    ? { time: row.t }
    : { time: row.t, value: row.oiChangePercent, color: row.oiChangePercent >= 0 ? '#3b82f6' : '#a16207' }))
  syncTimeScale()
  // lightweight-charts 在 setData 后会异步重算逻辑范围；下一帧再对齐一次，
  // 避免主图已经右移而副图仍停留在旧末端。
  requestAnimationFrame(syncTimeScale)
}
const updateCrosshair = () => {
  if (!props.crosshairTime || !chart) { chart?.clearCrosshairPosition(); return }
  const row = rows.value.find(item => item.t === props.crosshairTime)
  if (!row) return
  chart.setCrosshairPosition(row.activeFlowDeviation ?? 0, row.t, flowSeries)
  // 以 OI 序列再次定位，使 OI pane 的价格标签同步显示当前 K 线值。
  chart.setCrosshairPosition(row.oiChangePercent ?? 0, row.t, oiSeries)
}
const initCharts = () => {
  if (chart || !chartRef.value) return
  chart = createChart(chartRef.value, { ...chartOptions(), width: chartRef.value.clientWidth, height: 188 })
  flowSeries = chart.addSeries(HistogramSeries, { title: '资金流偏离', priceFormat: flowPriceFormat, base: 0 }, 0)
  chart.addPane()
  oiSeries = chart.addSeries(HistogramSeries, { title: 'OI', priceFormat: oiPriceFormat, base: 0 }, 1)
  // 两个副图 pane 默认等高，各占副图总高度的一半。
  chart.panes()[0]?.setStretchFactor(1)
  chart.panes()[1]?.setStretchFactor(1)
  chart.subscribeCrosshairMove((param: any) => {
    activeCrosshairTime.value = typeof param.time === 'number' ? param.time : null
  })
  chart.priceScale('right', 0).applyOptions({ visible: true, borderVisible: true, scaleMargins: { top: 0.12, bottom: 0.12 } })
  chart.priceScale('right', 1).applyOptions({ visible: true, borderVisible: true, scaleMargins: { top: 0.12, bottom: 0.12 } })
  resizeObserver = new ResizeObserver(() => {
    if (chartRef.value) {
      chart.applyOptions({ width: chartRef.value.clientWidth })
      requestAnimationFrame(syncTimeScale)
    }
  })
  resizeObserver.observe(chartRef.value)
  updateCharts()
}
async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response = await fetch(`/api/kline-simple/flow-oi?symbol=${encodeURIComponent(props.symbol)}&timeframe=${props.timeframe}&limit=2233`)
    const result = await response.json()
    rows.value = result.success ? result.data : []
  } catch {
    // 增量刷新失败时保留已有副图数据，避免主图更新被副图网络波动影响。
    if (!silent) rows.value = []
  } finally {
    if (!silent) loading.value = false
    await nextTick()
    if (!chart) initCharts()
    updateCharts()
    updateCrosshair()
  }
}
watch(() => [props.symbol, props.timeframe], () => load(), { immediate: true })
// 主图在周期边界可能先追加临时柱；立即刷新副图，后端数据到达后 load() 再完成校正。
watch(() => props.latestKlineTime, () => {
  syncLatestKline()
  if (chart) updateCharts()
  // 主图可能先于后端同步追加临时柱；静默拉取可在后端完成后自动替换占位点。
  void load(true)
})
// 后端刷新当前柱时，K 线时间戳可能不变；按修订号触发副图重新取数。
watch(() => props.latestKlineRevision, () => {
  if (chart) updateCharts()
  void load(true)
})
watch(() => [props.visibleRange, props.visibleLogicalRange, props.rightOffset, props.barSpacing, props.timeScaleWidth], syncTimeScale, { deep: true })
watch(() => props.crosshairTime, (time) => { activeCrosshairTime.value = time; updateCrosshair() })
watch(() => props.theme, () => { if (chart) chart.applyOptions(chartOptions()) })
onMounted(async () => {
  await nextTick()
  if (!loading.value && rows.value.length) initCharts()
})
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.remove() })
</script>

<style scoped>
.flow-oi-panel { border-top: 1px solid var(--el-border-color, #2d3748); padding: 8px 0 10px; color: var(--el-text-color-primary, #d7dee9); font-size: 12px; background: var(--el-bg-color, #111827); }
.flow-oi-panel.dark { color: #d9d9d9; background: #131722; border-top-color: #2b2b43; }
.flow-oi-panel.light { color: #191919; background: #fff; border-top-color: #cccccc; }
.panel-meta { display: flex; gap: 14px; align-items: center; min-width: 0; margin-bottom: 6px; padding: 0 12px; color: #9ca9bb; white-space: nowrap; overflow: hidden; }.panel-meta strong, .panel-meta span, .panel-meta .state-tag { flex: none; }.panel-meta strong { color: var(--el-text-color-primary, #d7dee9); }
/* 状态标签使用自身的 Element Plus 变量，避免暗色主题的全局标签规则覆盖状态色。 */
.flow-oi-panel :deep(.state-tag) { font-weight: 500; }
.flow-oi-panel :deep(.state-tag.long-build) { color: #22c55e !important; border-color: #22c55e66 !important; background-color: #22c55e1a !important; }
.flow-oi-panel :deep(.state-tag.short-build) { color: #ef4444 !important; border-color: #ef444466 !important; background-color: #ef44441a !important; }
.flow-oi-panel :deep(.state-tag.short-cover) { color: #f59e0b !important; border-color: #f59e0b66 !important; background-color: #f59e0b1a !important; }
.flow-oi-panel :deep(.state-tag.long-liquidation) { color: #a855f7 !important; border-color: #a855f766 !important; background-color: #a855f71a !important; }
.flow-oi-panel :deep(.state-tag.neutral) { color: #94a3b8 !important; border-color: #94a3b866 !important; background-color: #94a3b81a !important; }
.flow-oi-panel :deep(.state-tag.unavailable) { color: #64748b !important; border-color: #64748b66 !important; background-color: #64748b1a !important; }
.plots { width: 100%; height: 188px; }
@media (max-width: 640px) {
  .panel-meta {
    gap: 6px 12px;
    align-items: flex-start;
    flex-wrap: wrap;
    white-space: normal;
    overflow: visible;
  }

  .panel-meta span {
    min-width: 0;
    flex: 0 1 auto;
    overflow-wrap: anywhere;
  }
}
.buy { background: #22c55e; color: #22c55e; }.sell { background: #ef4444; color: #ef4444; }.oi-up { background: #3b82f6; color: #3b82f6; }.oi-down { background: #a16207; color: #a16207; }.missing { background: #64748b; opacity: .3; }.legend { margin-top: 6px; color: #94a3b8; }.legend span::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 4px; background: currentColor; }.empty { height: 76px; display: grid; place-items: center; color: #64748b; }
.flow-oi-panel.dark .summary { color: #9ca9bb; }.flow-oi-panel.dark .plot { border-bottom-color: #2b2b43; }.flow-oi-panel.dark .legend { color: #94a3b8; }.flow-oi-panel.dark .empty { color: #64748b; }
.flow-oi-panel.light .summary { color: #5f6368; }.flow-oi-panel.light .plot { border-bottom-color: #d7dce2; }.flow-oi-panel.light .legend { color: #667085; }
.plot { position: relative; padding-right: 72px; }.axis-label { position: absolute; right: 4px; font-size: 10px; color: #94a3b8; pointer-events: none; }.axis-top { top: 0; }.axis-bottom { bottom: 0; }.plot i.selected { outline: 1px solid #f8fafc; outline-offset: -1px; filter: brightness(1.35); }.flow-oi-panel.light .axis-label { color: #667085; }.flow-oi-panel.light .plot i.selected { outline-color: #1f2937; }
</style>
