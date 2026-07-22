<!-- ==================== 全局 404 页面 ==================== -->
<template>
  <main class="not-found-page">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <p class="status-code">404</p>
      <h1 id="not-found-title">页面不存在</h1>
      <p class="description">请求的页面不存在或已被移除。</p>
      <NuxtLink class="home-link" to="/">返回首页</NuxtLink>
    </section>
  </main>
</template>

<script setup lang="ts">
// catch-all 路由保证未知路径有明确匹配，避免 Vue Router 输出 No match found 告警。
const requestEvent = useRequestEvent()

if (requestEvent) {
  setResponseStatus(requestEvent, 404, 'Page Not Found')
}

useHead({
  title: '页面不存在',
})
</script>

<style scoped>
.not-found-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--bg-main);
  color: var(--text-primary);
}

.not-found-content {
  width: min(100%, 480px);
  text-align: center;
}

.status-code {
  margin-bottom: 8px;
  color: var(--color-primary);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
}

h1 {
  margin-bottom: 12px;
  font-size: 28px;
  font-weight: 600;
}

.description {
  margin-bottom: 24px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 20px;
  border-radius: 4px;
  background: var(--color-primary);
  color: #fff;
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.home-link:hover {
  opacity: 0.88;
}

.home-link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
</style>
