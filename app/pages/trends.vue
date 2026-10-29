<!-- ==================== 加密市场趋势独立页面 ==================== -->
<template>
  <main class="trends-page" aria-label="加密市场趋势">
    <ClientOnly>
      <CryptoTrendsDrawer :model-value="true" embedded />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import CryptoTrendsDrawer from '../components/CryptoTrendsDrawer.vue'

// 显式声明页面元数据，确保开发服务同步更新客户端路由模块。
definePageMeta({ name: 'trends' })
</script>

<style scoped>
.trends-page {
  height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px));
  min-height: 0;
  overflow: auto;
  background: var(--bg-main);
}
</style>
