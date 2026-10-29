<!-- ==================== 独立指标看板与三周期行情 ==================== -->
<template>
  <main class="indicator-page">
    <ClientOnly>
      <div class="dashboard-grid">
        <IndicatorsList class="board" :model-value="true" :selected-symbol="selected" embedded @symbols-ready="initializeSymbol" @select-symbol="selectSymbol" />
        <aside>
          <template v-if="selected">
            <IndicatorTrendChart v-for="period in periods" :key="period.timeframe" :symbol="selected" :timeframe="period.timeframe" :label="period.label" :viewport="viewport" @viewport-change="viewport = $event" />
          </template>
          <el-empty v-else description="等待看板数据，加载后默认显示第一个交易对" />
        </aside>
      </div>
    </ClientOnly>
  </main>
</template>
<script setup lang="ts">
import IndicatorsList from '../components/IndicatorsList.vue'
import IndicatorTrendChart from '../components/IndicatorTrendChart.vue'
import type { ChartViewport } from '../../types/chart-viewport'
const selected = ref('')
const viewport = ref<ChartViewport>()
const periods = [{ timeframe: '5m', label: '短期' }, { timeframe: '1h', label: '中期' }, { timeframe: '1d', label: '长期' }]
/** 首次取表格第一行；刷新保留用户选择，移除的交易对自动回退。 */
function initializeSymbol(symbols: string[]) {
  if (!symbols.includes(selected.value)) selected.value = symbols[0] || ''
}
/** 三张图共享交易对，分别保留短中长期观察窗口。 */
function selectSymbol(symbol: string) { selected.value = symbol }
</script>
<style scoped>
.indicator-page { padding: 10px 12px; color: var(--el-text-color-primary); height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px)); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
/* 整个内容区共享可用高度，表格内部滚动，右侧三个图表等分剩余空间。 */
.dashboard-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 18fr) minmax(0, 6fr); grid-template-rows: minmax(0, 1fr); gap: 10px; }
.board { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.board :deep(.indicators-table) { flex: 1; min-height: 0; }
aside { min-width: 0; min-height: 0; display: grid; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 8px; }
/* 窄屏保留可读尺寸，仅内容区滚动，不撑高全局页面。 */
@media (max-width: 1000px) { .dashboard-grid { display: flex; flex-direction: column; overflow-y: auto; } .board { height: 60dvh; flex-shrink: 0; } aside { min-height: 660px; flex-shrink: 0; } }
</style>
