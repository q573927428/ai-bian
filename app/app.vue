<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useBotStore } from './stores/bot'
import { useTheme } from './composables/useTheme'

const botStore = useBotStore()
const { initTheme } = useTheme()

// 全局设置浏览器标签页名称，首次渲染和页面切换时均使用项目名称。
useHead({
  title: 'AI 自动交易系统',
})

// 页面关闭/刷新时主动关闭 SSE，服务端会自动释放该浏览器连接。
onMounted(() => {
  window.addEventListener('beforeunload', botStore.cleanupOnUnload)
  // 初始化主题
  initTheme()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', botStore.cleanupOnUnload)
})
</script>
