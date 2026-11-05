<!-- ==================== 全局导航、登录与公共行情面板 ==================== -->
<template>
  <div ref="headerRoot" class="app-header">
    <HomeHeader :is-running="!!botStore.state?.isRunning" :password-verified="passwordVerified" :active-panels="activePanels" @navigate="handleNavigate" @performance="showPerformance = true" @unlock="handleUnlock" @lock="clearPassword" />
    <ClientOnly>
      <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
      <el-dialog v-model="showPerformance" title="系统性能面板" :style="{ width: '90%', maxWidth: '600px' }" draggable destroy-on-close>
        <PerformancePanel v-if="showPerformance" />
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
const { passwordVerified, showPasswordDialog, handleUnlock, handlePasswordSuccess, handleOpenProtectedPanel, clearPassword } = usePageUnlock({
  onOpen: panel => { void navigateTo(`/${panel}`) },
  onLock: () => {}
})
const activePanels = computed(() => ({ home: route.path === '/', indicators: route.path === '/indicators', orders: route.path === '/orders', macro: route.path === '/macro', trends: route.path === '/trends' }))
/** 指标和订单共用密码门禁，验证成功后跳转到本次请求的页面。 */
function handleNavigate(target: HomeNavigationTarget) {
  if (target === 'orders' || target === 'indicators') { handleOpenProtectedPanel(target); return }
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
