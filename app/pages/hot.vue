<!-- ==================== 全量热门行情独立页面 ==================== -->
<template>
  <main class="hot-page">
    <el-card shadow="never">
      <ClientOnly>
        <TopSymbolsTable :model-value="true" :selectable="false" embedded />
      </ClientOnly>
    </el-card>
  </main>
</template>

<script setup lang="ts">
import TopSymbolsTable from '../components/TopSymbolsTable.vue'

definePageMeta({ name: 'hot' })
</script>

<style scoped>
.hot-page {
  height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px));
  box-sizing: border-box;
  overflow: auto;
  padding: 20px;
}
@media (max-width: 768px) {
  .hot-page { padding: 10px; }
}
</style>
