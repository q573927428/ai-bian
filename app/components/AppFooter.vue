<!-- ==================== 全站公共底部：行情栏及安全区占位 ==================== -->
<template>
  <footer class="app-footer" aria-label="公共底部行情">
    <MarketOverview />
  </footer>
</template>

<style scoped>
/* 固定行情栏脱离文档流，由公共底部统一占位，避免遮挡页面末尾内容。 */
.app-footer {
  height: var(--app-footer-height);
  flex-shrink: 0;
}
</style>
