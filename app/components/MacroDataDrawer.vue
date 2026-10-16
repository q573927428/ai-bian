<!-- ==================== 宏观数据抽屉 ==================== -->
<template>
  <el-drawer v-model="visible" class="macro-drawer" title="宏观数据" direction="rtl" size="96%" destroy-on-close>
    <div class="macro-toolbar">
      <span class="overview-title">全球流动性+市场风险偏好总览</span>
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
          <MacroKLineChart v-if="visible && dataSource === 'local'" :market="item" :period="selectedPeriods[item.symbol] || '1d'" />
          <iframe v-else-if="visible && dataSource === 'tradingview'" class="chart-frame" :title="`${item.name} K线图`" :src="chartUrl(item.tradingView, selectedPeriods[item.symbol] || '1d')"
            loading="lazy" referrerpolicy="origin" />
        </div>
      </section>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, watch, provide } from 'vue'
import { MACRO_MARKETS } from '../../types/macro-market'
import MacroKLineChart from './macro-data/MacroKLineChart.vue'
import { macroCrosshairKey, type MacroCrosshairPosition } from './macro-data/crosshair-sync'

// 通道仅在当前九宫格内广播，组件卸载时各自移除订阅。
const crosshairListeners = new Set<(position: MacroCrosshairPosition | null) => void>()
provide(macroCrosshairKey, {
  publish: position => crosshairListeners.forEach(listener => listener(position)),
  subscribe: listener => {
    crosshairListeners.add(listener)
    return () => { crosshairListeners.delete(listener) }
  },
})

const props = defineProps<{ modelValue: boolean }>()
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

/** 顶部周期切换同步更新九张图，单卡切换仍可独立覆盖。 */
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
.macro-toolbar { min-height: 34px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 0 5px 5px; box-sizing: border-box; background: #080808; }
.overview-title { color: #f3f4f6; font-size: 14px; font-weight: 600; line-height: 22px; }
.chart-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
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
@media (max-width: 1100px) { .chart-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .chart-panel { height: 300px; } }
@media (max-width: 680px) { .chart-grid { grid-template-columns: minmax(0, 1fr); } .chart-panel { height: 300px; } .panel-caption span { display: none; } }
</style>
