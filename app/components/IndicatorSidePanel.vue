<!-- ==================== 指标页图表与环境详情切换面板 ==================== -->
<template>
  <section class="indicator-side-panel">
    <header class="panel-toolbar">
      <el-radio-group :model-value="view" size="small" aria-label="右侧视图" @update:model-value="emit('update:view', $event as IndicatorPanelView)">
        <el-radio-button value="chart">行情图表</el-radio-button>
        <el-radio-button value="environment">环境详情</el-radio-button>
      </el-radio-group>
      <el-button size="small" @click="emit('refresh-request')">刷新</el-button>
    </header>
    <IndicatorTrendChart v-if="symbol && view === 'chart'" ref="chartRef" class="panel-chart" :symbol="symbol" :timeframe="timeframe" :expandable="expandable" :show-refresh="false" coordinated-refresh @refresh-request="emit('refresh-request')" @timeframe-change="emit('timeframe-change', $event)" />
    <div v-else-if="symbol && view === 'environment'" class="environment-content">
      <EnvironmentDetails v-if="details" v-bind="details" panel />
      <el-empty v-else description="当前交易对环境数据加载中" />
    </div>
    <el-empty v-else description="等待看板数据，加载后默认显示第一个交易对" />
  </section>
</template>

<script setup lang="ts">
// ==================== 共享切换外壳，保持桌面与手机一致 ====================
import { ref } from 'vue'
import EnvironmentDetails from './EnvironmentDetails.vue'
import IndicatorTrendChart from './IndicatorTrendChart.vue'
import type { IndicatorPanelView } from '../composables/useIndicatorPanelView'
import type { EnvironmentDetailsData } from '../utils/environment-display'

/** 视图偏好由页面持有，切换交易对或重挂面板时不丢失。 */
interface Props {
  symbol: string
  timeframe: string
  view: IndicatorPanelView
  details?: EnvironmentDetailsData
  expandable?: boolean
}
defineProps<Props>()
const emit = defineEmits<{
  'update:view': [view: IndicatorPanelView]
  'refresh-request': []
  'timeframe-change': [timeframe: string]
}>()
const chartRef = ref<InstanceType<typeof IndicatorTrendChart>>()
/** 图表显示时转发刷新；环境详情随列表刷新，不另建请求或轮询。 */
async function refresh() { await chartRef.value?.refresh() }
defineExpose({ refresh })
</script>

<style scoped>
.indicator-side-panel { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.panel-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel-chart { flex: 1; min-height: 0; }
/* 面板铺满右栏，内部详情分配剩余高度；小窗口由这一层统一滚动。 */
.environment-content { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); }
</style>
