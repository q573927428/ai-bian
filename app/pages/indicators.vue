<!-- ==================== 独立指标看板与合约成交联动图 ==================== -->
<template>
  <main class="indicator-page">
    <ClientOnly>
      <div class="dashboard-grid">
        <IndicatorsList class="board" :model-value="true" :selected-symbol="selected" embedded @symbols-ready="initializeSymbol" @select-symbol="selectSymbol" @timeframe-change="chartTimeframe = $event" />
        <aside>
          <template v-if="selected">
            <IndicatorTrendChart :symbol="selected" :timeframe="chartTimeframe" @timeframe-change="chartTimeframe = $event" />
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
const selected = ref('')
const chartTimeframe = ref('1h')
/** 首次取表格第一行；刷新保留用户选择，移除的交易对自动回退。 */
function initializeSymbol(symbols: string[]) {
  if (!symbols.includes(selected.value)) selected.value = symbols[0] || ''
}
/** 点击表格交易对时同步其周期，图表随后可独立切换。 */
function selectSymbol(symbol: string, timeframe: string) { selected.value = symbol; chartTimeframe.value = timeframe }
</script>
<style scoped>
.indicator-page { padding: 10px 12px; color: var(--el-text-color-primary); height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px)); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
/* 表格内部滚动，右侧图表保持紧凑高度，不随左侧表格拉伸。 */
.dashboard-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 18fr) minmax(0, 6fr); grid-template-rows: minmax(0, 1fr); gap: 10px; }
.board { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.board :deep(.indicators-table) { flex: 1; min-height: 0; }
/* 单张联动图占满右栏，主图与 CVD 副图共用时间轴。 */
aside { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); overflow: hidden; }
/* 窄屏保留可读尺寸，仅内容区滚动，不撑高全局页面。 */
@media (max-width: 1000px) { .dashboard-grid { display: flex; flex-direction: column; overflow-y: auto; } .board { height: 60dvh; flex-shrink: 0; } aside { height: 800px; min-height: 800px; flex-shrink: 0; overflow: hidden; } }
</style>
