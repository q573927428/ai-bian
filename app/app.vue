<!-- ==================== 全局头部、页面与底部布局 ==================== -->
<template>
  <div id="app">
    <AppHeader />
    <NuxtPage />
    <AppFooter />
    <!-- 全局仅挂载一个日志实例，切换页面时保留通知、去重记录和倒计时。 -->
    <ClientOnly>
      <SystemLogs v-model="showLogsDrawer" @select-symbol="handleLogChartSelect" />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref } from 'vue'
import { PAGE_UNLOCK_KEY } from './composables/usePageUnlock'
import { useBotStore } from './stores/bot'
import { useTheme } from './composables/useTheme'
import SystemLogs from './components/SystemLogs.vue'

const botStore = useBotStore()
const { initTheme } = useTheme()
provide(PAGE_UNLOCK_KEY, { passwordVerified: ref(false), hasPassword: ref(false) })

const route = useRoute()
const showLogsDrawer = useState<boolean>('system-logs-visible', () => false)
const selectedChartSymbol = useState<string>('home-chart-symbol', () => '')
const selectedChartTimeframe = useState<string>('home-chart-timeframe', () => '')

/** 通知从任意页面定位首页图表；先保存目标，确保首页挂载时读取到交易对和周期。 */
function handleLogChartSelect(symbol: string, mainTimeframe?: string) {
  selectedChartSymbol.value = symbol.replace('/', '').toUpperCase()
  // 无历史周期时清除上次选择，避免把其他策略的周期带到本次通知。
  selectedChartTimeframe.value = mainTimeframe || ''
  if (route.path !== '/') void navigateTo('/')
}

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

<style>
:root {
  /* 行情栏单行高度及移动端安全区，供页面计算可用视口高度。 */
  --app-footer-height: calc(27px + env(safe-area-inset-bottom, 0px));
}
</style>
