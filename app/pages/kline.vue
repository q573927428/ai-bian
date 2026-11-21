<!-- ==================== 独立三列 K 线工作台 ==================== -->
<template>
  <main class="kline-page" aria-label="K 线工作台">
    <ClientOnly>
      <div class="kline-grid">
        <aside class="price-column" aria-label="交易对价格">
          <CryptoPriceCards v-model:chart-symbol="symbol" standalone />
        </aside>

        <section class="chart-column" aria-label="K 线和指标">
          <KLineChartSimple v-if="symbol" :symbol="symbol" timeframe="1h" :indicator="indicator" @timeframe-change="selectTimeframe">
            <template #indicator-controls>
              <div class="indicator-buttons" role="group" aria-label="副图指标">
                <button v-for="option in KLINE_INDICATORS" :key="option" type="button" :aria-pressed="indicator === option" @click="indicator = option">
                  {{ option }}
                </button>
              </div>
            </template>
          </KLineChartSimple>
          <el-empty v-else description="等待交易对数据" />
        </section>

        <aside class="environment-column" aria-labelledby="kline-environment-title">
          <header class="environment-toolbar">
            <h2 id="kline-environment-title">环境详情</h2>
            <el-button size="small" :disabled="!symbol" :loading="environmentLoading" @click="refreshEnvironment">刷新</el-button>
          </header>
          <div class="environment-scroll" :aria-busy="environmentLoading">
            <p v-if="environmentError" class="environment-status" role="status">{{ environmentError }}</p>
            <EnvironmentDetails v-if="environment" :key="`${symbol}:${timeframe}`" v-bind="environment" :now="now" panel />
            <el-empty v-else-if="!environmentError" :description="environmentLoading ? '正在读取环境详情…' : '等待交易对数据'" :image-size="64" />
          </div>
        </aside>
      </div>
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import EnvironmentDetails from '../components/EnvironmentDetails.vue'
import KLineChartSimple from '../components/kline-chart/KLineChartSimple.vue'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import { useBotStore } from '../stores/bot'
import type { EnvironmentDetailsData } from '../utils/environment-display'
import { DEFAULT_KLINE_INDICATOR, KLINE_INDICATORS, KLINE_WORKSPACE_PERIODS, type KlineIndicator } from '../utils/kline-indicators'
import type { Timeframe } from '../../types/strategy'

/** 指标接口的环境字段直接交给详情组件展示，不在浏览器重复评分。 */
interface EnvironmentResponse {
  success: boolean
  initializing?: boolean
  data?: {
    environmentContext?: EnvironmentDetailsData['context']
    marketBreadthSummary?: EnvironmentDetailsData['summary']
    marketBreadthDescription?: string
  } | null
}

useHead({ title: 'K线工作台' })
const botStore = useBotStore()
const symbol = ref('')
const timeframe = ref<Timeframe>('1h')
const indicator = ref<KlineIndicator>(DEFAULT_KLINE_INDICATOR)
const now = ref(Date.now())
const environment = shallowRef<Omit<EnvironmentDetailsData, 'now'>>()
const environmentLoading = ref(false)
const environmentError = ref('')
let environmentRequest: AbortController | undefined
let clock: ReturnType<typeof setInterval> | undefined

watch(() => botStore.botConfig?.symbols, symbols => {
  const available = (symbols ?? []).map(value => value.replace('/', '').trim().toUpperCase()).filter(Boolean)
  if (!available.includes(symbol.value)) {
    symbol.value = available.includes('BTCUSDT') ? 'BTCUSDT' : (available[0] ?? '')
  }
}, { immediate: true })

/** 右侧只跟随主图当前周期，不受价格卡片涨跌统计周期影响。 */
function selectTimeframe(value: string) {
  const period = KLINE_WORKSPACE_PERIODS.find(period => period === value)
  if (period) timeframe.value = period
}

/** 按当前标的和周期加载单份快照；切换后取消旧请求并阻止迟到响应覆盖。 */
async function refreshEnvironment() {
  if (!import.meta.client || !symbol.value || environmentRequest) return
  const request = new AbortController()
  environmentRequest = request
  environmentLoading.value = true
  environmentError.value = ''
  const selectedSymbol = symbol.value
  const selectedTimeframe = timeframe.value
  try {
    const response = await $fetch<EnvironmentResponse>('/api/bot/indicators', {
      query: { symbol: selectedSymbol, timeframe: selectedTimeframe, includeSlowStats: 'false', structureOnly: 'true' },
      signal: request.signal
    })
    if (environmentRequest !== request) return
    if (!response.success || !response.data) {
      environmentError.value = response.initializing ? '行情初始化中，请稍后刷新。' : '当前交易对暂无环境详情。'
      return
    }
    environment.value = {
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      context: response.data.environmentContext,
      summary: response.data.marketBreadthSummary,
      breadthDescription: response.data.marketBreadthDescription
    }
    now.value = Date.now()
  } catch {
    if (environmentRequest === request) environmentError.value = '环境详情加载失败，请刷新重试。'
  } finally {
    if (environmentRequest === request) {
      environmentRequest = undefined
      environmentLoading.value = false
    }
  }
}

watch([symbol, timeframe], () => {
  environmentRequest?.abort()
  environmentRequest = undefined
  environmentLoading.value = false
  environmentError.value = ''
  environment.value = undefined
  void refreshEnvironment()
}, { immediate: true })
useGlobalPolling(refreshEnvironment, () => !!symbol.value)
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 10_000) })
onBeforeUnmount(() => {
  environmentRequest?.abort()
  environmentRequest = undefined
  clearInterval(clock)
})
</script>

<style scoped>
.kline-page {
  box-sizing: border-box;
  height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px));
  min-height: 440px;
  padding: 10px 12px;
}
.kline-grid {
  display: grid;
  grid-template-columns: minmax(200px, 16fr) minmax(0, 56fr) minmax(300px, 28fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 10px;
  height: 100%;
}
.price-column, .chart-column, .environment-column { min-width: 0; min-height: 0; }
.chart-column, .environment-column {
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}
.environment-column { display: flex; flex-direction: column; }
.environment-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 12px;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
}
.environment-toolbar h2 { margin: 0; color: var(--text-primary); font-size: 14px; }
.environment-scroll { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 10px 12px; }
.environment-status { margin: 0 0 8px; color: var(--text-secondary); font-size: 13px; }
.indicator-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  border-radius: 6px;
  /* 外框和选中项的底色会叠加；两层都用浅底，文字保留完整对比度。 */
  background: color-mix(in srgb, var(--bg-card) 12%, transparent);
}
.indicator-buttons button {
  border: 1px solid color-mix(in srgb, var(--el-border-color) 55%, transparent);
  border-radius: 4px;
  padding: 3px 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}
.indicator-buttons button:hover,
.indicator-buttons button[aria-pressed="true"] {
  border-color: var(--el-color-primary);
}
.indicator-buttons button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--el-color-primary) 26%, transparent);
}
@media (max-width: 1000px) {
  .kline-page { height: auto; min-height: 0; }
  .kline-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: 300px clamp(450px, 65dvh, 680px) auto; }
  .environment-scroll { overflow: visible; }
}
@media (max-width: 480px) {
  .indicator-buttons button { padding-inline: 4px; }
}
</style>
