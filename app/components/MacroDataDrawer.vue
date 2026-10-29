<!-- ==================== 宏观数据抽屉 ==================== -->
<template>
  <component :is="embedded ? 'section' : ElDrawer" v-model="visible" :class="embedded ? 'macro-content' : 'macro-drawer'" title="宏观数据" direction="rtl" size="90%" destroy-on-close>
    <div class="macro-toolbar">
      <span class="overview-title">全球流动性+市场风险偏好总览</span>
      <div class="macro-toolbar-actions">
      <button v-if="pinnedCrosshair" type="button" class="crosshair-unpin" @click="clearPinnedCrosshair">光标已固定 · 解除</button>
      <button v-if="pinnedCrosshair" type="button" class="crosshair-unpin" @click="showPinnedSummary = true">查看汇总</button>
      <el-switch v-model="timeSyncEnabled" :disabled="dataSource !== 'local'" active-text="时间联动" size="small" :title="dataSource === 'local' ? '同步同周期图表的横向缩放和拖动，价格轴保持独立' : '时间联动仅支持本地图表'" />
      <div class="periods" aria-label="数据源">
        <button type="button" :class="{ active: dataSource === 'local' }" :aria-pressed="dataSource === 'local'" @click="dataSource = 'local'">本地数据</button>
        <button type="button" :class="{ active: dataSource === 'tradingview' }" :aria-pressed="dataSource === 'tradingview'" @click="dataSource = 'tradingview'">TradingView</button>
      </div>
      <div class="periods global-periods" aria-label="全部图表周期">
        <button v-for="period in periods" :key="period.value" type="button"
          :class="{ active: globalPeriod === period.value }"
          :aria-pressed="globalPeriod === period.value"
          @click="setGlobalPeriod(period.value)">{{ period.label }}</button>
      </div>
      </div>
    </div>

    <div class="chart-grid">
      <section v-for="item in markets" :key="item.symbol" class="chart-panel">
        <header class="panel-header">
          <div class="panel-caption">
            <strong>{{ item.name }}</strong>
            <span>{{ item.description }}</span>
          </div>
          <div class="periods panel-periods" :aria-label="`${item.name}周期`">
            <button v-for="period in periods" :key="period.value" type="button"
              :class="{ active: selectedPeriods[item.symbol] === period.value }"
              :aria-pressed="selectedPeriods[item.symbol] === period.value"
              @click="selectedPeriods[item.symbol] = period.value">{{ period.label }}</button>
          </div>
        </header>
        <div class="chart-viewport">
          <MacroKLineChart v-if="visible && dataSource === 'local'" :market="item" :period="selectedPeriods[item.symbol] || '1d'" @pinned-summary="updatePinnedSummary" />
          <iframe v-else-if="visible && dataSource === 'tradingview'" class="chart-frame" :title="`${item.name} K线图`" :src="chartUrl(item.tradingView, selectedPeriods[item.symbol] || '1d')"
            loading="lazy" referrerpolicy="origin" />
        </div>
      </section>
    </div>
    <el-dialog v-model="showPinnedSummary" title="固定光标 · 全市场涨跌汇总" width="min(1180px, 96vw)" draggable append-to-body :close-on-click-modal="false">
      <div v-if="pinnedCrosshair" class="summary-description">
        <div>固定{{ pinnedCrosshair.period === '1d' || pinnedCrosshair.period === '1w' ? '交易日期' : '时间' }}：{{ pinnedTimeLabel }} · 周期 {{ pinnedCrosshair.period }}</div>
        <div>{{ overallDuration }}</div>
        <small>各市场以固定 K 线收盘价对比自身最新 K 线收盘价；相隔时间包含休市，按 K 线时间戳计算。美债涨跌为收益率相对变化。</small>
      </div>
      <el-table :data="pinnedSummaryRows" max-height="55vh" size="small">
        <el-table-column prop="name" label="市场" min-width="145" fixed />
        <el-table-column prop="from" label="固定收盘" min-width="105"><template #default="{ row }">{{ row.from ?? '—' }}</template></el-table-column>
        <el-table-column prop="to" label="最新收盘" min-width="105"><template #default="{ row }">{{ row.to ?? '—' }}</template></el-table-column>
        <el-table-column label="至最新涨跌" min-width="100"><template #default="{ row }"><span :class="row.changeClass">{{ row.percent ?? '—' }}</span></template></el-table-column>
        <el-table-column prop="duration" label="相隔时间" min-width="165"><template #default="{ row }">{{ row.duration ?? '—' }}</template></el-table-column>
        <el-table-column label="最新K线（北京时间）" min-width="175"><template #default="{ row }">{{ row.latestTime ? formatSummaryTime(row.latestTime) : '—' }}</template></el-table-column>
        <el-table-column prop="status" label="状态" min-width="160" />
      </el-table>
      <template #footer><el-button @click="showPinnedSummary = false">关闭窗口</el-button><el-button type="primary" @click="clearPinnedCrosshair">解除固定</el-button></template>
    </el-dialog>
  </component>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, watch, provide } from 'vue'
import { ElDrawer } from 'element-plus'
import { MACRO_MARKETS } from '../../types/macro-market'
import MacroKLineChart from './macro-data/MacroKLineChart.vue'
import { macroCrosshairKey, type MacroCrosshairPosition, type MacroPinnedSummary } from './macro-data/crosshair-sync'
import { macroViewportKey, type MacroViewport } from './macro-data/viewport-sync'
import type { MacroPeriod } from '../../types/macro-market'

const timeSyncEnabled = ref(true)
const viewportListeners = new Set<(viewport: MacroViewport) => void>()
const latestViewports = new Map<MacroPeriod, MacroViewport>()
provide(macroViewportKey, {
  enabled: timeSyncEnabled,
  latest: latestViewports,
  publish: viewport => {
    if (!timeSyncEnabled.value) return
    latestViewports.set(viewport.period, viewport)
    viewportListeners.forEach(listener => listener(viewport))
  },
  subscribe: listener => {
    viewportListeners.add(listener)
    return () => { viewportListeners.delete(listener) }
  },
})

// 通道仅在当前图表网格内广播，组件卸载时各自移除订阅。
const crosshairListeners = new Set<(position: MacroCrosshairPosition | null) => void>()
const pinnedCrosshair = ref<MacroCrosshairPosition | null>(null)
const showPinnedSummary = ref(false)
const pinnedSummaries = reactive<Record<string, MacroPinnedSummary>>({})
const summaryClock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** 日期型固定键按交易日期显示，分钟周期及各图时间按北京时间展示。 */
const formatSummaryTime = (time: number) => summaryClock.format(new Date(time * 1000))
const pinnedTimeLabel = computed(() => {
  const pinned = pinnedCrosshair.value
  if (!pinned) return ''
  return pinned.period === '1d' || pinned.period === '1w'
    ? new Date(pinned.key * 1000).toISOString().slice(0, 10) : `${formatSummaryTime(pinned.key)}（北京时间）`
})
const pinnedSummaryRows = computed(() => MACRO_MARKETS.map(market => {
  const pinned = pinnedCrosshair.value
  const summary = pinnedSummaries[market.id]
  return { name: market.name, ...(pinned && summary?.key === pinned.key && summary.period === pinned.period
    ? summary : { status: selectedPeriods[market.symbol] !== pinned?.period ? '周期不同' : '等待数据' }) }
}))
// 最新数据时点可能不同，汇总展示间隔范围而非将各市场时间相加。
const overallDuration = computed(() => {
  const durations = pinnedSummaryRows.value.flatMap(row => 'latestTime' in row && row.latestTime != null && row.selectedTime != null
    ? [Math.abs(row.latestTime - row.selectedTime)] : [])
  if (!durations.length) return '暂无可比较数据'
  const format = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    return `${Math.floor(minutes / 1440)}天${Math.floor(minutes % 1440 / 60)}小时${minutes % 60}分钟`
  }
  const min = Math.min(...durations), max = Math.max(...durations)
  return min === max ? `至最新相隔：${format(max)}` : `至各市场最新数据相隔：${format(min)} ～ ${format(max)}`
})
/** 只接收当前固定日期的报告，防止旧日期的延迟更新混入弹窗。 */
function updatePinnedSummary(summary: MacroPinnedSummary) {
  if (summary.key === pinnedCrosshair.value?.key) pinnedSummaries[summary.marketId] = summary
}
watch(pinnedCrosshair, position => {
  showPinnedSummary.value = !!position
  if (!position) Object.keys(pinnedSummaries).forEach(key => { delete pinnedSummaries[key] })
})
/** 主动解除时广播清空，避免其他图保留旧的固定日期。 */
function clearPinnedCrosshair() {
  pinnedCrosshair.value = null
  crosshairListeners.forEach(listener => listener(null))
}
provide(macroCrosshairKey, {
  pinned: pinnedCrosshair,
  // 固定期间忽略其他图的移出、加载或周期切换产生的清空事件。
  publish: position => crosshairListeners.forEach(listener => listener(pinnedCrosshair.value ?? position)),
  subscribe: listener => {
    crosshairListeners.add(listener)
    return () => { crosshairListeners.delete(listener) }
  },
})

// 页面模式复用完整看板，抽屉模式保留给已有入口。
const props = withDefaults(defineProps<{ modelValue: boolean; embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const markets = MACRO_MARKETS
const dataSource = ref<'local' | 'tradingview'>('local')
onMounted(() => {
  try {
    if (localStorage.getItem('macro-data-source') === 'tradingview') dataSource.value = 'tradingview'
  } catch { /* 浏览器禁用存储时使用本地默认值。 */ }
})
watch(dataSource, value => {
  clearPinnedCrosshair()
  try { localStorage.setItem('macro-data-source', value) } catch { /* 存储失败不影响切换。 */ }
})

const periods = [
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
] as const

type Period = typeof periods[number]['value']
const globalPeriod = ref<Period>('1d')
const selectedPeriods = reactive<Record<string, Period>>(
  Object.fromEntries(markets.map(item => [item.symbol, '1d' as Period])),
)

/** 顶部周期切换同步更新全部图表，单卡切换仍可独立覆盖。 */
function setGlobalPeriod(period: Period) {
  globalPeriod.value = period
  markets.forEach(item => { selectedPeriods[item.symbol] = period })
}

/** 使用 TradingView 公开嵌入图表提供市场数据，周期变化时 iframe 会重新加载。 */
function chartUrl(symbol: string, period: Period): string {
  const params = new URLSearchParams({
    symbol, interval: { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' }[period], theme: 'dark', style: '1', locale: 'zh_CN',
    timezone: 'Etc/UTC', hidesidetoolbar: '1', hide_legend: '1',
    symboledit: '0', saveimage: '0', toolbarbg: '#111111',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}
</script>

<style scoped>
.macro-content { padding: 6px; background: #080808; }
.macro-toolbar { min-height: 34px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 0 5px 5px; box-sizing: border-box; background: #080808; }
.overview-title { color: #f3f4f6; font-size: 14px; font-weight: 600; line-height: 22px; }
.macro-toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.crosshair-unpin { border: 1px solid #2962ff; border-radius: 4px; padding: 3px 6px; background: #162440; color: #8bb8ff; font-size: 11px; cursor: pointer; }
.summary-description { display: grid; gap: 8px; margin-bottom: 14px; line-height: 1.5; color: var(--text-regular); }
.summary-description small { color: var(--text-secondary); }
.positive { color: #26a69a; }
.negative { color: #ef5350; }
.chart-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.chart-panel { min-width: 0; height: calc((100vh - 118px) / 3); min-height: 235px; border: 1px solid #343434; border-radius: 5px; overflow: hidden; background: #111; }
.panel-header { height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 0 8px; border-bottom: 1px solid #333; box-sizing: border-box; }
.panel-caption { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.panel-caption strong { color: #fff; font-size: 13px; margin-right: 8px; }
.panel-caption span { color: #a7a9ad; }
.periods { display: flex; align-items: center; flex: none; border: 1px solid #303038; border-radius: 5px; padding: 2px; }
.periods button { appearance: none; border: 0; border-radius: 4px; background: transparent; color: #aeb5c3; height: 21px; min-width: 28px; padding: 0 5px; font-size: 11px; cursor: pointer; }
.periods button:hover { color: #fff; }
.periods button.active { background: #2962ff; color: #fff; }
/* TradingView 的跨域 iframe 不接受隐藏顶部导航的 URL 参数，从视口裁去该行。 */
.chart-viewport { height: calc(100% - 32px); overflow: hidden; }
.chart-frame { display: block; width: 100%; height: calc(100% + 40px); transform: translateY(-40px); border: 0; background: #111; }
:global(.macro-drawer .el-drawer__header) { margin-bottom: 0; padding: 12px 16px; background: #111; color: #f3f4f6; }
:global(.macro-drawer .el-drawer__title) { color: #f3f4f6; }
:global(.macro-drawer .el-drawer__body) { padding: 6px; overflow: auto; background: #080808; }
/* 独立页面按实际可用高度分配三行，包含工具栏、间距和边框，避免轻微溢出。 */
@media (min-width: 1101px) {
  .macro-content { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
  .macro-content .macro-toolbar { flex-shrink: 0; }
  .macro-content .chart-grid { flex: 1; min-height: 0; grid-template-rows: repeat(3, minmax(235px, 1fr)); }
  .macro-content .chart-panel { height: auto; box-sizing: border-box; }
}
@media (max-width: 1100px) { .chart-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .chart-panel { height: 300px; } }
@media (max-width: 680px) { .chart-grid { grid-template-columns: minmax(0, 1fr); } .chart-panel { height: 300px; } .panel-caption span { display: none; } }
</style>
