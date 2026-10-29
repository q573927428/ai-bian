<!-- ==================== 宏观市场独立页面 ==================== -->
<template>
  <main class="macro-page" aria-label="宏观数据">
    <ClientOnly>
      <MacroDataDrawer :model-value="true" embedded />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import MacroDataDrawer from '../components/MacroDataDrawer.vue'

// 显式声明页面元数据，确保开发服务同步更新客户端路由模块。
definePageMeta({ name: 'macro' })
</script>

<style scoped>
.macro-page {
  height: calc(100dvh - var(--app-header-height, 60px) - var(--app-footer-height, 27px));
  min-height: 0;
  overflow: auto;
  background: var(--bg-main);
}
</style>
