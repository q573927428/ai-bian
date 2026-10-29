<!-- ==================== 全局导航、登录与公共行情面板 ==================== -->
<template>
  <div ref="headerRoot" class="app-header">
    <HomeHeader :is-running="!!botStore.state?.isRunning" :password-verified="passwordVerified" :active-panels="activePanels" @navigate="handleNavigate" @performance="showPerformance = true" @unlock="handleUnlock" />
    <ClientOnly>
      <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
      <el-dialog v-model="showPerformance" title="系统性能面板" :style="{ width: '90%', maxWidth: '600px' }" draggable destroy-on-close>
        <PerformancePanel />
      </el-dialog>
    </ClientOnly>
  </div>
</template>
<script setup lang="ts">
import type { HomeNavigationTarget } from '../../types/home'
import { useBotStore } from '../stores/bot'
import { usePageUnlock } from '../composables/usePageUnlock'
const route = useRoute()
const botStore = useBotStore()
const headerRoot = ref<HTMLElement>()
const showPerformance = ref(false)
const { passwordVerified, showPasswordDialog, handleUnlock, handlePasswordSuccess, handleOpenProtectedPanel } = usePageUnlock({
  onOpen: () => { void navigateTo('/orders') },
  onLock: () => {}
})
const activePanels = computed(() => ({ home: route.path === '/', indicators: route.path === '/indicators', orders: route.path === '/orders', macro: route.path === '/macro', trends: route.path === '/trends' }))
/** 行情入口跳转独立页面，订单入口沿用密码门禁。 */
function handleNavigate(target: HomeNavigationTarget) {
  if (target === 'orders') { handleOpenProtectedPanel('orders'); return }
  void navigateTo(target === 'home' ? '/' : `/${target}`)
}
let observer: ResizeObserver | undefined
onMounted(() => {
  // 移动端菜单会改变头部高度，页面扣除实际高度，保持与全局底部的可视区协调。
  observer = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--app-header-height', `${headerRoot.value?.offsetHeight || 60}px`)
  })
  if (headerRoot.value) observer.observe(headerRoot.value)
  botStore.subscribeToPolling('app-header')
})
onBeforeUnmount(() => { observer?.disconnect(); botStore.unsubscribeFromPolling('app-header') })
</script>
<style scoped>
.app-header { flex-shrink: 0; }
</style>
