<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useBotStore } from './stores/bot'

const botStore = useBotStore()

// 页面关闭/刷新时取消 WebSocket 订阅
onMounted(() => {
  window.addEventListener('beforeunload', botStore.cleanupOnUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', botStore.cleanupOnUnload)
})
</script>

<style>

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

#app {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  background: #f5f7fa;
}
</style>
