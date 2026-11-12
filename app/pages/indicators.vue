<!-- ==================== 独立指标看板与合约成交联动图 ==================== -->
<template>
  <main class="indicator-page">
    <ClientOnly>
      <div class="dashboard-grid">
        <IndicatorsList ref="listRef" class="board" :model-value="true" :selected-symbol="selected" :auto-height="isMobile" :refreshing="refreshing" embedded coordinated-refresh environment-panel @refresh-request="refreshDashboard" @symbols-ready="initializeSymbol" @select-symbol="selectSymbol" @show-environment="showEnvironment" @timeframe-change="chartTimeframe = $event" />
        <aside v-if="!isMobile">
          <IndicatorSidePanel ref="sidePanelRef" v-model:view="panelView" :symbol="selected" :timeframe="chartTimeframe" :details="environmentDetails" @refresh-request="refreshDashboard" @timeframe-change="chartTimeframe = $event" />
        </aside>
      </div>
      <el-dialog
        v-if="isMobile"
        v-model="chartDialogVisible"
        :title="`${selected} ${panelView === 'chart' ? '指标图表' : '环境详情'}`"
        fullscreen
        append-to-body
        destroy-on-close
      >
        <div v-if="chartDialogVisible && selected" class="mobile-chart-panel">
          <IndicatorSidePanel ref="sidePanelRef" v-model:view="panelView" :symbol="selected" :timeframe="chartTimeframe" :details="environmentDetails" :expandable="false" @refresh-request="refreshDashboard" @timeframe-change="chartTimeframe = $event" />
        </div>
      </el-dialog>
    </ClientOnly>
  </main>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import IndicatorsList from '../components/IndicatorsList.vue'
import IndicatorSidePanel from '../components/IndicatorSidePanel.vue'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import { useIndicatorPanelView } from '../composables/useIndicatorPanelView'
const selected = ref('')
const chartTimeframe = ref('1h')
const listRef = ref<InstanceType<typeof IndicatorsList>>()
const sidePanelRef = ref<InstanceType<typeof IndicatorSidePanel>>()
const panelView = useIndicatorPanelView()
const environmentDetails = computed(() => listRef.value?.getEnvironmentDetails(selected.value))
// 先不挂载桌面图表，避免手机首次进入时发起隐藏图表的行情请求。
const isMobile = ref(true)
const chartDialogVisible = ref(false)
let mobileQuery: MediaQueryList | undefined

/** 与响应式样式使用相同断点，切换屏幕尺寸时关闭移动端弹窗。 */
function updateLayout() {
  isMobile.value = mobileQuery?.matches ?? true
  chartDialogVisible.value = false
}
onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 1000px)')
  updateLayout()
  mobileQuery.addEventListener('change', updateLayout)
})
onBeforeUnmount(() => mobileQuery?.removeEventListener('change', updateLayout))
const refreshing = ref(false)

/** 同一计时器同时发起两侧刷新，整轮结束前不重入；列表刷新全部指标而非仅更新结构。 */
async function refreshDashboard() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.allSettled([listRef.value?.refresh(), sidePanelRef.value?.refresh()])
  } finally {
    refreshing.value = false
  }
}
// 初次加载及切换交易对仍立即请求；后续复用全局状态轮询的 60 秒节拍。
useGlobalPolling(refreshDashboard)
/** 首次取表格第一行；刷新保留用户选择，移除的交易对自动回退。 */
function initializeSymbol(symbols: string[]) {
  if (!symbols.includes(selected.value)) selected.value = symbols[0] || ''
}
/** 点击行才打开手机图表，默认选中第一行和轮询更新都不触发弹窗。 */
function selectSymbol(symbol: string, timeframe: string) {
  selected.value = symbol
  chartTimeframe.value = timeframe
  if (isMobile.value) chartDialogVisible.value = true
}
/** 点击多空分数直接打开环境视图，同时复用现有选中与手机弹窗逻辑。 */
function showEnvironment(symbol: string, timeframe: string) {
  panelView.value = 'environment'
  selectSymbol(symbol, timeframe)
}
</script>
<style scoped>
.indicator-page { padding: 10px 12px; color: var(--el-text-color-primary); height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px)); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
/* 表格内部滚动，右侧图表保持原有整体高度。 */
.dashboard-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 16fr) minmax(0, 8fr); grid-template-rows: minmax(0, 1fr); gap: 10px; }
.board { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.board :deep(.indicators-table) { flex: 1; min-height: 0; }
/* 单张联动图占满右栏，主图与 CVD 副图共用时间轴。 */
aside { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); overflow: hidden; }
.mobile-chart-panel { height: calc(100dvh - 110px); min-height: 0; display: flex; flex-direction: column; }
.mobile-chart-panel > :deep(.indicator-side-panel) { flex: 1; }
@media (max-width: 1000px) {
  /* 手机使用整页滚动，表格不再被页面、容器或百分比高度截断。 */
  .indicator-page { height: auto; overflow: visible; }
  .dashboard-grid { display: block; flex: none; overflow: visible; }
  .board { height: auto; min-height: 0; overflow: visible; }
  .board :deep(.indicators-table) { flex: none; }
  .board :deep(.el-scrollbar__bar) { display: none; }
}
</style>
