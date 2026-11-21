<!-- ==================== 跟随 K 线交易对与周期的环境详情 ==================== -->
<template>
  <section class="environment-panel" aria-label="环境详情">
    <div class="environment-scroll" :aria-busy="loading">
      <!-- 首次请求失败时仍需在主周期旁保留手动重试。 -->
      <div v-if="!environment && symbol" class="environment-fallback-actions">
        <span class="environment-period-tag">主周期 {{ timeframe }}</span>
        <el-button size="small" :disabled="!canLoad" :loading="loading" @click="refreshEnvironment">刷新</el-button>
      </div>
      <p v-if="error" class="environment-status" role="status">{{ error }}</p>
      <EnvironmentDetails v-if="environment" :key="`${symbol}:${timeframe}`" v-bind="environment" :now="now" panel>
        <template #period-actions>
          <el-button size="small" :disabled="!canLoad" :loading="loading" @click="refreshEnvironment">刷新</el-button>
        </template>
      </EnvironmentDetails>
      <el-empty v-else-if="!error" :description="emptyDescription" :image-size="64" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import EnvironmentDetails from './EnvironmentDetails.vue'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import type { EnvironmentDetailsData } from '../utils/environment-display'
import type { KlineWorkspacePeriod } from '../utils/kline-indicators'

/** 指标接口返回的环境预计算数据，浏览器不重复评分。 */
interface EnvironmentResponse {
  success: boolean
  initializing?: boolean
  data?: {
    environmentContext?: EnvironmentDetailsData['context']
    marketBreadthSummary?: EnvironmentDetailsData['summary']
    marketBreadthDescription?: string
  } | null
}

/** 仅在首页的环境详情标签显示时请求数据。 */
const props = defineProps<{
  symbol: string
  timeframe: KlineWorkspacePeriod
  active: boolean
}>()

const now = ref(Date.now())
const environment = shallowRef<Omit<EnvironmentDetailsData, 'now'>>()
const loading = ref(false)
const error = ref('')
// 环境接口只支持到日线；周线不发请求，也不借用日线快照。
const canLoad = computed(() => props.active && !!props.symbol && props.timeframe !== '1w')
const emptyDescription = computed(() => {
  if (props.timeframe === '1w') return '周线暂无环境详情'
  return loading.value ? '正在读取环境详情…' : '等待交易对数据'
})
let environmentRequest: AbortController | undefined

/** 只接收当前标的和周期的快照，避免切换时迟到的旧响应覆盖新数据。 */
async function refreshEnvironment() {
  if (!import.meta.client || !canLoad.value || environmentRequest) return
  const request = new AbortController()
  environmentRequest = request
  loading.value = true
  error.value = ''
  const { symbol, timeframe } = props
  try {
    const response = await $fetch<EnvironmentResponse>('/api/bot/indicators', {
      query: { symbol, timeframe, includeSlowStats: 'false', structureOnly: 'true' },
      signal: request.signal
    })
    if (environmentRequest !== request) return
    if (!response.success || !response.data) {
      error.value = response.initializing ? '行情初始化中，请稍后刷新。' : '当前交易对暂无环境详情。'
      return
    }
    environment.value = {
      symbol,
      timeframe,
      context: response.data.environmentContext,
      summary: response.data.marketBreadthSummary,
      breadthDescription: response.data.marketBreadthDescription
    }
    now.value = Date.now()
  } catch {
    if (environmentRequest === request) error.value = '环境详情加载失败，请刷新重试。'
  } finally {
    if (environmentRequest === request) {
      environmentRequest = undefined
      loading.value = false
    }
  }
}

watch([() => props.symbol, () => props.timeframe, () => props.active], ([symbol, timeframe], [previousSymbol, previousTimeframe], onCleanup) => {
  // 切走即停止请求；标的或周期变化时清空快照，避免返回标签时短暂串数据。
  if (symbol !== previousSymbol || timeframe !== previousTimeframe) {
    environment.value = undefined
    error.value = ''
  }
  if (!import.meta.client || !canLoad.value) return
  now.value = Date.now()
  void refreshEnvironment()
  const clock = setInterval(() => { now.value = Date.now() }, 10_000)
  onCleanup(() => {
    clearInterval(clock)
    environmentRequest?.abort()
    environmentRequest = undefined
    loading.value = false
  })
}, { immediate: true })
useGlobalPolling(refreshEnvironment, () => canLoad.value)
</script>

<style scoped>
.environment-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.environment-scroll { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 10px 12px; }
.environment-fallback-actions { display: flex; flex-shrink: 0; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 8px; }
.environment-period-tag { padding: 2px 8px; border-radius: 5px; background: var(--bg-hover); color: var(--text-secondary); font-size: 12px; }
.environment-status { margin: 0 0 8px; color: var(--text-secondary); font-size: 13px; }
</style>
