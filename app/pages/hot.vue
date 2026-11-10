<!-- ==================== 全量热门行情独立页面 ==================== -->
<template>
  <main class="hot-page">
    <ClientOnly>
      <div class="hot-grid">
        <el-card shadow="never" class="hot-table-card">
          <TopSymbolsTable ref="table" :model-value="true" :selectable="false" embedded @overview="overview = $event" />
        </el-card>
        <MarketOverviewPanel class="hot-sidebar" :rows="overview.rows" :selected="overview.selected" :scope-label="overview.scopeLabel" @select="table?.locateSymbol($event)" />
      </div>
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import TopSymbolsTable from '../components/TopSymbolsTable.vue'
import MarketOverviewPanel from '../components/MarketOverviewPanel.vue'
import { ref } from 'vue'
import type { MarketOverviewState } from '../../types/market-overview'

const table = ref<InstanceType<typeof TopSymbolsTable>>()
const overview = ref<MarketOverviewState>({ rows: [], scopeLabel: '热门全量 · 全部资产' })

definePageMeta({ name: 'hot' })
</script>

<style scoped>
.hot-page {
  height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px));
  box-sizing: border-box;
  min-height: 0;
  overflow: hidden;
  padding: 20px;
}
.hot-grid { display: grid; grid-template-columns: minmax(0, 7.5fr) minmax(320px, 2.5fr); gap: 16px; height: 100%; min-height: 0; }
.hot-table-card { min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; }
.hot-table-card :deep(.el-card__body) { height: 100%; min-height: 0; box-sizing: border-box; padding: 12px 16px; }
.hot-table-card :deep(.el-card__body > section) { height: 100%; min-height: 0; }
.hot-sidebar { min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }
/* 平板上下排列，仍保留视口内的分区滚动。 */
@media (max-width: 1200px) {
  .hot-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 3fr) minmax(0, 2fr); }
}
@media (max-width: 768px) {
  /* 手机按内容撑开整页，避免上下两块区域被视口高度截断。 */
  .hot-page { height: auto; overflow: visible; padding: 10px; }
  .hot-grid { height: auto; grid-template-rows: auto auto; }
  .hot-table-card,
  .hot-table-card :deep(.el-card__body),
  .hot-table-card :deep(.el-card__body > section) { height: auto; }
  .hot-sidebar { overflow-y: visible; overscroll-behavior-y: auto; scrollbar-gutter: auto; }
}
</style>
