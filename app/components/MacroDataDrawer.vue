<!-- ==================== 宏观数据抽屉 ==================== -->
<template>
  <component :is="embedded ? 'section' : ElDrawer" v-model="visible" :class="embedded ? 'macro-content' : 'macro-drawer'" title="宏观数据" direction="rtl" size="90%" destroy-on-close>
    <div class="macro-toolbar">
      <span class="overview-title">全球流动性+市场风险偏好总览</span>
      <div class="macro-toolbar-actions">
      <el-select v-model="marketToAdd" class="add-market-selector" size="small" filterable placeholder="添加图表" :disabled="markets.length >= 12" :loading="loadingMarkets" aria-label="添加图表" @visible-change="open => { if (open) loadLocalMarkets() }" @change="addMarket">
        <el-option v-for="option in addableMarkets" :key="option.id" :value="option.id" :label="`${option.name} · ${option.symbol}`" />
      </el-select>
      <button type="button" class="crosshair-unpin" @click="restoreDefaultMarkets">恢复默认12格</button>
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

    <div ref="gridContainer" class="chart-grid" :style="gridStyle">
      <section v-for="(item, index) in markets" :key="item.id" class="chart-panel">
        <header class="panel-header">
          <div class="panel-caption">
            <el-select :model-value="item.id" class="market-selector" size="small" filterable :loading="loadingMarkets" :aria-label="`第${index + 1}格交易对`" @visible-change="open => { if (open) loadLocalMarkets() }" @change="value => changeMarket(index, value)">
              <el-option v-for="option in localMarkets" :key="option.id" :value="option.id" :label="`${option.name} · ${option.symbol}`" :disabled="markets.some((market, slot) => slot !== index && market.id === option.id)" />
              <template #empty><span class="market-select-empty">{{ marketsError || '暂无本地 K 线数据' }}</span></template>
            </el-select>
            <span>{{ item.description }}</span>
          </div>
          <div class="periods panel-periods" :aria-label="`${item.name}周期`">
            <button v-for="period in periods" :key="period.value" type="button"
              :class="{ active: selectedPeriods[item.symbol] === period.value }"
              :aria-pressed="selectedPeriods[item.symbol] === period.value"
              :disabled="!supportsPeriod(item.id, period.value)"
              @click="selectedPeriods[item.symbol] = period.value">{{ period.label }}</button>
          </div>
          <button type="button" class="remove-market" :disabled="markets.length <= 1" :aria-label="`移除${item.name}图表`" title="移除此图表" @click="removeMarket(index)">×</button>
        </header>
        <div class="chart-viewport">
          <MacroKLineChart v-if="visible && dataSource === 'local'" :key="item.id" :market="item" :period="selectedPeriods[item.symbol] || '1d'" @pinned-summary="updatePinnedSummary" />
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
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch, provide } from 'vue'
import { ElDrawer } from 'element-plus'
import { MACRO_MARKETS } from '../../types/macro-market'
import MacroKLineChart from './macro-data/MacroKLineChart.vue'
import { macroCrosshairKey, type MacroCrosshairPosition, type MacroPinnedSummary } from './macro-data/crosshair-sync'
import { macroViewportKey, type MacroViewport } from './macro-data/viewport-sync'
import type { MacroPeriod, LocalMacroMarket } from '../../types/macro-market'
import { macroGridLayout } from '../utils/macro-grid'

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
const pinnedSummaryRows = computed(() => markets.value.map(market => {
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

// 首次使用默认十二格，用户可以保留一至十二个图表。
const selectedMarketIds = ref(MACRO_MARKETS.map(market => market.id))
const localMarkets = ref<LocalMacroMarket[]>([])
const markets = computed(() => selectedMarketIds.value.map((id, index) =>
  localMarkets.value.find(market => market.id === id) ?? MACRO_MARKETS.find(market => market.id === id) ?? MACRO_MARKETS[index]!))
const loadingMarkets = ref(false)
const marketsError = ref('')
const gridContainer = ref<HTMLElement>()
const gridWidth = ref(1200)
let gridObserver: ResizeObserver | undefined
const gridStyle = computed(() => {
  const layout = macroGridLayout(markets.value.length, gridWidth.value)
  return { gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(var(--macro-chart-min-height, 160px), 1fr))` }
})
const marketToAdd = ref('')
const addableMarkets = computed(() => localMarkets.value.filter(market => !selectedMarketIds.value.includes(market.id)))
/** 保存当前排列和数量，兼容原有十二格配置。 */
function saveMarkets() {
  try { localStorage.setItem('macro-market-slots', JSON.stringify(selectedMarketIds.value)) } catch { /* 存储不可用不影响操作。 */ }
}
/** 移除后其余图表自动均分容器，至少保留一个图表。 */
function removeMarket(index: number) {
  if (markets.value.length <= 1) return
  clearPinnedCrosshair()
  selectedMarketIds.value.splice(index, 1)
  saveMarkets()
}
/** 只添加本地已有数据的未展示市场，默认采用当前全局周期。 */
function addMarket(id: string) {
  const market = addableMarkets.value.find(item => item.id === id)
  if (!market || markets.value.length >= 12) return
  clearPinnedCrosshair()
  selectedPeriods[market.symbol] = market.periods.includes(globalPeriod.value) ? globalPeriod.value : market.periods[0]!
  selectedMarketIds.value.push(id)
  marketToAdd.value = ''
  saveMarkets()
}
/** 一键恢复最初十二个宏观市场，沿用当前全局周期。 */
function restoreDefaultMarkets() {
  clearPinnedCrosshair()
  selectedMarketIds.value = MACRO_MARKETS.map(market => market.id)
  setGlobalPeriod(globalPeriod.value)
  saveMarkets()
}
onMounted(() => {
  if (!gridContainer.value) return
  gridWidth.value = gridContainer.value.clientWidth
  gridObserver = new ResizeObserver(entries => {
    const entry = entries[0]
    if (entry) gridWidth.value = entry.contentRect.width
  })
  gridObserver.observe(gridContainer.value)
})
onBeforeUnmount(() => { gridObserver?.disconnect() })
/** 重新打开选择器时刷新本地目录，采集到的新交易对无需重启页面。 */
async function loadLocalMarkets() {
  if (loadingMarkets.value) return
  loadingMarkets.value = true
  try {
    localMarkets.value = await $fetch<LocalMacroMarket[]>('/api/macro/markets')
    marketsError.value = ''
  } catch { marketsError.value = '本地交易对读取失败，请重新打开重试' }
  finally { loadingMarkets.value = false }
}
/** 已知目录中的缺失周期禁用；目录未加载时不影响默认看板。 */
function supportsPeriod(id: string, period: MacroPeriod) {
  const market = localMarkets.value.find(item => item.id === id)
  return !market || market.periods.includes(period)
}
/** 保留槽位原周期；目标没有该周期时改用其已有周期，避免切换后出现空图。 */
function changeMarket(index: number, id: string) {
  const next = localMarkets.value.find(market => market.id === id)
  if (!next || markets.value.some((market, slot) => slot !== index && market.id === id)) return
  const previous = markets.value[index]!
  const period = selectedPeriods[previous.symbol] ?? globalPeriod.value
  clearPinnedCrosshair()
  selectedPeriods[next.symbol] = next.periods.includes(period) ? period : next.periods[0]!
  selectedMarketIds.value[index] = id
  saveMarkets()
}
const dataSource = ref<'local' | 'tradingview'>('local')
onMounted(async () => {
  await loadLocalMarkets()
  try {
    if (localStorage.getItem('macro-data-source') === 'tradingview') dataSource.value = 'tradingview'
    const saved: unknown = JSON.parse(localStorage.getItem('macro-market-slots') || 'null')
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 12) {
      const used = new Set<string>()
      selectedMarketIds.value = saved.map((id, index) => {
        const fallback = MACRO_MARKETS[index]!.id
        const candidate = typeof id === 'string' && localMarkets.value.some(market => market.id === id) && !used.has(id) ? id : fallback
        // 缓存被删除时退回未占用默认标的，保持用户保存的数量并避免身份冲突。
        const resolved = !used.has(candidate) ? candidate : MACRO_MARKETS.find(market => !used.has(market.id))!.id
        used.add(resolved)
        const market = localMarkets.value.find(item => item.id === resolved)
        if (market) selectedPeriods[market.symbol] = market.periods.includes('1d') ? '1d' : market.periods[0]!
        return resolved
      })
    }
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
  Object.fromEntries(MACRO_MARKETS.map(item => [item.symbol, '1d' as Period])),
)

/** 顶部周期切换同步更新全部图表，单卡切换仍可独立覆盖。 */
function setGlobalPeriod(period: Period) {
  globalPeriod.value = period
  markets.value.forEach(item => {
    if (supportsPeriod(item.id, period)) selectedPeriods[item.symbol] = period
  })
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
.macro-content { padding: 6px; background: #080808; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.macro-toolbar { flex-shrink: 0; }
.macro-toolbar { min-height: 34px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 0 5px 5px; box-sizing: border-box; background: #080808; }
.overview-title { color: #f3f4f6; font-size: 14px; font-weight: 600; line-height: 22px; }
.macro-toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.crosshair-unpin { border: 1px solid #2962ff; border-radius: 4px; padding: 3px 6px; background: #162440; color: #8bb8ff; font-size: 11px; cursor: pointer; }
.summary-description { display: grid; gap: 8px; margin-bottom: 14px; line-height: 1.5; color: var(--text-regular); }
.summary-description small { color: var(--text-secondary); }
.positive { color: #26a69a; }
.negative { color: #ef5350; }
.chart-grid { display: grid; flex: 1; min-height: 0; gap: 6px; }
.chart-panel { min-width: 0; min-height: 0; box-sizing: border-box; border: 1px solid #343434; border-radius: 5px; overflow: hidden; background: #111; }
.add-market-selector { width: 135px; }
.remove-market { flex-shrink: 0; border: 0; padding: 0 3px; background: transparent; color: #9299a5; font-size: 18px; line-height: 22px; cursor: pointer; }
.remove-market:hover { color: #ef5350; }
.remove-market:disabled { opacity: 0.3; cursor: not-allowed; }
.panel-header { height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 0 8px; border-bottom: 1px solid #333; box-sizing: border-box; }
.panel-caption { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.panel-caption strong { color: #fff; font-size: 13px; margin-right: 8px; }
.panel-caption span { color: #a7a9ad; }
.panel-caption { display: flex; align-items: center; gap: 6px; }
.market-selector { width: 150px; flex-shrink: 1; min-width: 85px; }
.market-selector :deep(.el-select__wrapper) { min-height: 24px; background: transparent; box-shadow: none; padding: 0 4px; }
.market-selector :deep(.el-select__selected-item) { color: #fff; font-size: 12px; font-weight: 600; }
.market-select-empty { display: block; padding: 10px; font-size: 12px; }
.periods button:disabled { opacity: 0.35; cursor: not-allowed; }
.periods { display: flex; align-items: center; flex: none; border: 1px solid #303038; border-radius: 5px; padding: 2px; }
.periods button { appearance: none; border: 0; border-radius: 4px; background: transparent; color: #aeb5c3; height: 21px; min-width: 28px; padding: 0 5px; font-size: 11px; cursor: pointer; }
.periods button:hover { color: #fff; }
.periods button.active { background: #2962ff; color: #fff; }
/* TradingView 的跨域 iframe 不接受隐藏顶部导航的 URL 参数，从视口裁去该行。 */
.chart-viewport { height: calc(100% - 32px); overflow: hidden; }
.chart-frame { display: block; width: 100%; height: calc(100% + 40px); transform: translateY(-40px); border: 0; background: #111; }
:global(.macro-drawer .el-drawer__header) { margin-bottom: 0; padding: 12px 16px; background: #111; color: #f3f4f6; }
:global(.macro-drawer .el-drawer__title) { color: #f3f4f6; }
:global(.macro-drawer .el-drawer__body) { padding: 6px; overflow: auto; background: #080808; display: flex; flex-direction: column; }
/* 行列数由实际网格容器宽度决定，抽屉、页面和侧栏变化均可自动适配。 */
@media (max-width: 680px) {
  /* 移动端增加单图可读高度，多图时通过页面滚动查看。 */
  .chart-grid { --macro-chart-min-height: 300px; }
  .panel-caption span { display: none; }
}
</style>
