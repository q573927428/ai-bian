<!-- ==================== 全局头部导航与移动端菜单展示 ==================== -->
<template>
  <el-header class="header">
    <div class="header-content">
      <h1>
        <NuxtLink to="/" class="brand-link" aria-label="返回首页">
        <img :src="currentTheme === 'light' ? '/logo-light.png' : '/logo.png'" alt="Logo" style="width: 1.5em; height: 1.5em; object-fit: contain; vertical-align: middle; margin-right: 8px" />
        <span class="brand-name">AI自动交易</span>
        </NuxtLink>
      </h1>
      <!-- 桌面直接显示导航，移动端通过右上角菜单展开同一组入口。 -->
      <nav id="header-navigation" class="header-navigation" :class="{ 'is-open': mobileNavOpen }" aria-label="行情导航">
        <div class="navigation-inner">
          <button v-for="item in visibleNavigationItems" :key="item.label" type="button" class="navigation-item" :class="{ 'is-active': activePanels[item.id] }" :aria-current="activePanels[item.id] ? 'page' : undefined" @click="handleNavigate(item.id)">
            <span class="navigation-icon">
              <el-icon :size="18" aria-hidden="true">
                <component :is="item.icon" />
              </el-icon>
            </span>
            <span class="navigation-copy">
              <span class="navigation-label">{{ item.label }}</span>
              <span class="navigation-description">{{ item.description }}</span>
            </span>
          </button>
        </div>
      </nav>
      <div class="header-right">
      <!-- 状态与权重共享详情入口，与右侧按钮统一使用组内间距。 -->
        <button type="button" class="header-status" :aria-label="`${isRunning ? '运行中' : '已停止'}，1分钟 API 权重 ${apiWeight ?? '暂无数据'}，本地估算 ${estimatedWeight ?? '暂无数据'}，查看系统性能`" title="1分钟 API 权重 / 本地当前整分钟估算，整分钟重置，每2秒刷新；点击查看详情" @click="emit('performance')">
          <div :class="['status-dot-sm', isRunning ? 'status-running' : 'status-stopped']" />
          <span class="header-weight"><b>{{ apiWeight ?? '-' }}</b></span>
          <span class="header-weight"><span aria-hidden="true">/</span><b>{{ estimatedWeight ?? '-' }}</b></span>
        </button>
        <el-button text size="small" @click="toggleTheme" class="theme-toggle-btn" :aria-label="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'" :title="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'">
          <el-icon :size="18">
            <ElIconMoon v-if="currentTheme === 'light'" />
            <ElIconSunny v-else />
          </el-icon>
        </el-button>
        <!-- 使用配置的管理员账号登录，成功后由统一登录状态切换头像。 -->
        <div v-if="!passwordVerified" class="auth-actions" role="group" aria-label="账号登录">
          <button type="button" class="auth-button auth-login" @click="emit('unlock')">登录</button>
        </div>
        <el-dropdown v-else class="account-dropdown" trigger="click" placement="bottom-end" popper-class="account-menu-popper" :show-arrow="false" :offset="12" @command="handleAccountCommand">
          <button type="button" class="user-avatar" aria-label="用户菜单（已解锁）">
            <el-icon :size="17" aria-hidden="true"><ElIconUserFilled /></el-icon>
          </button>
          <template #dropdown>
            <div class="account-menu">
              <!-- 当前为单管理员账号，身份区展示角色和登录状态。 -->
              <div class="account-profile">
                <span class="account-profile-avatar" aria-hidden="true">
                  <el-icon :size="21"><ElIconUserFilled /></el-icon>
                </span>
                <div class="account-profile-info">
                  <span class="account-profile-name">管理员</span>
                  <span class="account-profile-status"><span class="account-status-dot" />已登录</span>
                </div>
              </div>
              <el-dropdown-menu class="account-menu-actions">
                <el-dropdown-item command="profile" class="account-menu-item">
                  <el-icon class="account-menu-icon" :size="18" aria-hidden="true"><ElIconUser /></el-icon>
                  <span>个人资料</span>
                </el-dropdown-item>
                <el-dropdown-item command="invite" class="account-menu-item">
                  <el-icon class="account-menu-icon" :size="18" aria-hidden="true"><ElIconPresent /></el-icon>
                  <span>邀请好友</span>
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided class="account-menu-item account-logout">
                  <el-icon class="account-menu-icon" :size="18" aria-hidden="true"><ElIconSwitchButton /></el-icon>
                  <span>退出登录</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </div>
          </template>
        </el-dropdown>
        <el-button text size="small" class="mobile-nav-toggle" :class="{ 'is-open': mobileNavOpen }" :aria-label="mobileNavOpen ? '收起行情导航' : '展开行情导航'" aria-controls="header-navigation" :aria-expanded="mobileNavOpen" @click="mobileNavOpen = !mobileNavOpen" @keydown.esc="mobileNavOpen = false">
          <el-icon :size="20" aria-hidden="true">
            <ElIconClose v-if="mobileNavOpen" />
            <ElIconExpand v-else />
          </el-icon>
        </el-button>
      </div>
    </div>
  </el-header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Component } from 'vue'
import { ElIconHouse, ElIconDataAnalysis, ElIconTickets, ElIconPlatform, ElIconTrendCharts, ElIconUserFilled } from '#components'
import { useTheme } from '../composables/useTheme'
import type { HomeNavigationTarget } from '../../types/home'

/** 顶部接收运行、解锁和面板激活状态，通过事件请求页面操作。 */
interface Props {
  isRunning: boolean
  /** 最近一次 Binance 响应中的分钟权重；未加载时保持缺省。 */
  apiWeight?: number
  /** 本系统最近60秒请求的估算权重。 */
  estimatedWeight?: number
  passwordVerified: boolean
  activePanels: Partial<Record<HomeNavigationTarget, boolean>>
}

/** 导航元数据；图标与文案由顶部组件统一维护。 */
interface NavigationItem {
  id: HomeNavigationTarget
  label: string
  description: string
  icon: Component
}

const props = defineProps<Props>()
const emit = defineEmits<{
  navigate: [target: HomeNavigationTarget]
  performance: []
  unlock: []
  lock: []
}>()
const { theme: currentTheme, toggleTheme } = useTheme()
const mobileNavOpen = ref(false)
const navigationItems: NavigationItem[] = [
  { id: 'home', label: '首页', description: '交易总览', icon: ElIconHouse },
  { id: 'indicators', label: '指标', description: '技术信号', icon: ElIconDataAnalysis },
  { id: 'orders', label: '订单', description: '交易复盘', icon: ElIconTickets },
  { id: 'macro', label: '宏观', description: '全球市场', icon: ElIconPlatform },
  { id: 'trends', label: '趋势', description: '行情脉络', icon: ElIconTrendCharts }
]

// 桌面与移动端共用登录状态过滤，退出或凭证到期后同步隐藏受保护入口。
const visibleNavigationItems = computed(() => navigationItems.filter(item =>
  props.passwordVerified || (item.id !== 'indicators' && item.id !== 'orders')
))

/** 预设入口先提示待开放，只有退出命令会清除解锁状态。 */
function handleAccountCommand(command: string) {
  if (command === 'logout') {
    emit('lock')
    return
  }
  if (command === 'profile' || command === 'invite') {
    ElMessage.info(`${command === 'profile' ? '个人资料' : '邀请好友'}功能暂未开放`)
  }
}

/** 移动端选择入口后收起菜单，具体面板及权限由首页协调。 */
function handleNavigate(target: HomeNavigationTarget) {
  emit('navigate', target)
  mobileNavOpen.value = false
}
</script>

<style scoped>
.brand-link { display: flex; align-items: center; color: inherit; text-decoration: none; }
.header {
  flex-shrink: 0;
}

.header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 0 24px;
}

.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 8px 28px;
}

.header-content h1, .header-right { flex-shrink: 0; }

@media (max-width: 1024px) {
  .header { height: auto; min-height: 60px; }
  .header-content { flex-wrap: wrap; padding: 10px 0; }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.header-navigation {
  padding-left: 24px;
  border-left: 1px solid var(--el-border-color-lighter);
}

.auth-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  border: 1px solid #668dff;
  border-radius: 10px;
  background: #182d5b;
  box-shadow: 0 0 16px rgb(88 135 255 / 18%);
}

.auth-button {
  min-height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.auth-login { color: #edf4ff; background: transparent; }
.auth-login:hover { background: #2c467b; }
.auth-register { color: #10234a; background: #9cc5ff; }
.auth-register:hover { background: #c4deff; }
.auth-button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }

/* 分隔主题操作与用户入口，头像距左侧分隔线保留 15px 内边距。 */
.account-dropdown {
  padding-left: 15px;
  border-left: 1px solid var(--el-border-color-lighter);
}

.user-avatar {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid #8db7ff;
  border-radius: 50%;
  color: #edf4ff;
  background: linear-gradient(135deg, #568cff, #7959dc);
  box-shadow: 0 0 14px rgb(88 135 255 / 22%);
}

.user-avatar:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.account-menu {
  width: min(252px, calc(100vw - 32px));
  padding: 8px;
  color: var(--el-text-color-primary);
}

.account-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px 18px;
  margin: 0 4px 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.account-profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #7470ff, #9254e8);
}

.account-profile-info { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.account-profile-name { font-size: 14px; font-weight: 600; line-height: 20px; }
.account-profile-status { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--el-text-color-secondary); }
.account-status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--el-color-success); }
.account-menu-actions { padding: 0; background: transparent; }
.account-menu-actions :deep(.account-menu-item) {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  transition: color 0.15s ease, background-color 0.15s ease;
}
.account-menu-actions :deep(.account-logout:hover),
.account-menu-actions :deep(.account-logout:focus) {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.account-menu-icon { width: 18px; height: 18px; flex-shrink: 0; margin-right: 0; }

/* 下拉层挂载到 body，使用专属类控制外框，保持其他菜单样式不受影响。 */
:global(.el-popper.account-menu-popper) {
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-border-color), var(--el-text-color-primary) 16%);
  border-radius: 14px;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 12px 36px rgb(0 0 0 / 24%), 0 2px 8px rgb(0 0 0 / 10%);
}

.navigation-inner {
  display: flex;
  gap: 6px;
}

.navigation-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-regular);
  font: inherit;
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}

.navigation-icon {
  display: inline-flex;
  color: var(--text-secondary);
  transition: color 0.18s ease;
}

.navigation-item:hover,
.navigation-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.navigation-item:hover .navigation-icon,
.navigation-item.is-active .navigation-icon {
  color: var(--el-color-primary);
}

.navigation-item:focus-visible,
.header-status:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.navigation-label {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

.navigation-description {
  display: none;
}

.mobile-nav-toggle {
  display: none;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
}

.theme-toggle-btn {
  color: var(--text-regular) !important;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
}
.header-status {
  margin-left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 6px 6px 6px 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: transparent;
  font: inherit;
  border-radius: 20px;
  transition: background 0.2s ease;
}

.header-weight {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.header-weight b { font-size: 14px; font-weight: 500; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
/* 实际权重略带蓝色，估算保留灰色，区分来源同时避免数字过亮。 */
.status-dot-sm + .header-weight b { color: color-mix(in srgb, var(--text-secondary) 75%, var(--color-primary)); }

.header-status:hover {
  background: var(--stat-card-bg);
}

.status-dot-sm {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: status-breathe 2s ease-in-out infinite;
}

.status-running {
  background: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
}

.status-stopped {
  background: var(--color-danger);
  box-shadow: 0 0 6px var(--color-danger);
}

/* 红绿圆点均显示呼吸效果，颜色区分运行状态；缩放不改变布局，避免文字抖动。 */
@keyframes status-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}


@media (max-width: 1024px) {
  .header { padding: 0 12px; }

  .header-content { gap: 0 8px; padding: 10px 0; }

  .header-right { gap: 8px; }
  .header-status {
    flex-shrink: 0;
    margin: 0;
    justify-content: flex-start;
    padding: 6px 6px 6px 8px;
    border-radius: 8px;
    box-sizing: border-box;
  }

  .header-navigation {
    /* 用网格折叠平滑展开，隐藏时不留下可聚焦的导航入口。 */
    display: grid;
    grid-template-rows: 0fr;
    visibility: hidden;
    order: 3;
    width: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    transition: grid-template-rows 0.22s ease, opacity 0.22s ease, visibility 0.22s;
  }

  .header-navigation.is-open {
    grid-template-rows: 1fr;
    visibility: visible;
    opacity: 1;
  }

  .navigation-inner {
    min-height: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .header-navigation.is-open .navigation-inner {
    margin-top: 14px;
    padding-top: 12px;
    padding-bottom: 2px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .navigation-item {
    gap: 12px;
    padding: 12px;
    text-align: left;
    background: var(--bg-main);
    border-radius: 12px;
  }

  .navigation-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 10px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .navigation-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .navigation-description {
    display: block;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .mobile-nav-toggle {
    display: inline-flex;
    width: 36px;
    height: 36px;
    margin-left: 0 !important;
    padding: 0;
    border-radius: 10px;
    color: var(--text-regular);
    background: var(--bg-main);
  }

  .mobile-nav-toggle.is-open {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .header h1 {
    font-size: 16px;
  }
}
@media (min-width: 1025px) and (max-width: 1200px) {
  .header { padding: 0 16px; }
  .header-content { column-gap: 8px; }
  .header h1 { font-size: 18px; }
  .header-navigation { padding-left: 8px; }
  .navigation-inner { gap: 2px; }
  .navigation-item { gap: 5px; padding: 9px 6px; }
  .navigation-label { font-size: 13px; }
}


@media (max-width: 480px) {
  .header { padding: 0 8px; }
  .header-content { column-gap: 4px; }
  .header h1 { font-size: 18px; }
  /* 压缩标签与间距，让权重和估算在手机顶部保持单行。 */
  .header-status {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 4px;
    padding: 3px 5px;
    height: 32px;
  }
  .header-status .status-dot-sm { width: 6px; height: 6px; }
  .header-weight { gap: 3px; font-size: 12px; line-height: 16px; }
  .header-weight b { font-size: 13px; }
  .auth-button { padding: 0 6px; }
  .header-right { gap: 8px; flex-wrap: nowrap; }
  .theme-toggle-btn, .mobile-nav-toggle { width: 28px; }
}
@media (max-width: 374px) {
  /* 极窄屏保留品牌图标，为权重和操作按钮让出空间。 */
  .brand-name { display: none; }
  .header-status { height: 32px; }
  .header-right { gap: 8px; }
  .theme-toggle-btn { width: 28px; }
  .mobile-nav-toggle { width: 32px; }
  .auth-button { padding: 0 6px; }
  .header-content { column-gap: 4px; }
}

@media (prefers-reduced-motion: reduce) {
  .header-navigation,
  .navigation-item,
  .navigation-icon { transition: none; }
}
</style>
