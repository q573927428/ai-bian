<!-- ==================== 首页顶部导航与移动端菜单 ==================== -->
<template>
  <el-header class="header">
    <div class="header-content">
      <h1>
        <img :src="currentTheme === 'light' ? '/logo-light.png' : '/logo.png'" alt="Logo" style="width: 1.5em; height: 1.5em; object-fit: contain; vertical-align: middle; margin-right: 8px" />
        AI自动交易
      </h1>
      <!-- 桌面直接显示导航，移动端通过右上角菜单展开同一组入口。 -->
      <nav id="header-navigation" class="header-navigation" :class="{ 'is-open': mobileNavOpen }" aria-label="行情导航">
        <div class="navigation-inner">
          <button v-for="item in navigationItems" :key="item.label" type="button" class="navigation-item" :class="{ 'is-active': activePanels[item.id] }" aria-haspopup="dialog" @click="handleNavigate(item.id)">
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
        <!-- 运行状态 -->
        <button type="button" class="header-status" aria-label="查看系统运行状态与性能" @click="emit('performance')">
          <div :class="['status-dot-sm', isRunning ? 'status-running' : 'status-stopped']" />
          <span class="header-status-text">{{ isRunning ? '运行中' : '已停止' }}</span>
        </button>
        <el-button text size="small" @click="toggleTheme" class="theme-toggle-btn" :aria-label="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'" :title="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'">
          <el-icon :size="18">
            <ElIconMoon v-if="currentTheme === 'light'" />
            <ElIconSunny v-else />
          </el-icon>
        </el-button>
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
import { ref } from 'vue'
import type { Component } from 'vue'
import { ElIconDataAnalysis, ElIconStar, ElIconPlatform, ElIconTrendCharts, ElIconDocument, ElIconTickets } from '#components'
import { useTheme } from '../composables/useTheme'
import type { HomeNavigationTarget } from '../../types/home'

/** 顶部只接收运行状态和面板激活状态，不直接操作页面弹窗。 */
interface Props {
  isRunning: boolean
  activePanels: Partial<Record<HomeNavigationTarget, boolean>>
}

/** 导航元数据；图标与文案由顶部组件统一维护。 */
interface NavigationItem {
  id: HomeNavigationTarget
  label: string
  description: string
  icon: Component
}

defineProps<Props>()
const emit = defineEmits<{
  navigate: [target: HomeNavigationTarget]
  performance: []
}>()
const { theme: currentTheme, toggleTheme } = useTheme()
const mobileNavOpen = ref(false)
const navigationItems: NavigationItem[] = [
  { id: 'indicators', label: '指标', description: '技术信号', icon: ElIconDataAnalysis },
  { id: 'hot', label: '热门', description: '市场焦点', icon: ElIconStar },
  { id: 'macro', label: '宏观', description: '全球市场', icon: ElIconPlatform },
  { id: 'trends', label: '趋势', description: '行情脉络', icon: ElIconTrendCharts },
  { id: 'logs', label: '日志', description: '系统动态', icon: ElIconDocument },
  { id: 'orders', label: '订单', description: '交易记录', icon: ElIconTickets }
]

/** 移动端选择入口后收起菜单，具体面板及权限由首页协调。 */
function handleNavigate(target: HomeNavigationTarget) {
  emit('navigate', target)
  mobileNavOpen.value = false
}
</script>

<style scoped>
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

@media (max-width: 768px) {
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
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 7px 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: transparent;
  font: inherit;
  border-radius: 20px;
  transition: background 0.2s ease;
}

.header-status:hover {
  background: var(--stat-card-bg);
}

.status-dot-sm {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-running {
  background: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
  animation: pulse 2s infinite;
}

.status-stopped {
  background: var(--color-danger);
  box-shadow: 0 0 6px var(--color-danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.header-status-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
  white-space: nowrap;
}

@media (max-width: 768px) {
  .header { padding: 0 12px; }

  .header-content { gap: 0 8px; padding: 10px 0; }

  .header-right { gap: 4px; }

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
@media (min-width: 769px) and (max-width: 1200px) {
  .header { padding: 0 16px; }
  .header-content { column-gap: 8px; }
  .header h1 { font-size: 18px; }
  .header-navigation { padding-left: 8px; }
  .navigation-inner { gap: 2px; }
  .navigation-item { gap: 5px; padding: 9px 6px; }
  .navigation-label { font-size: 13px; }
}

@media (min-width: 769px) and (max-width: 900px) {
  .navigation-item .navigation-icon { display: none; }
}
@media (max-width: 374px) {
  .header-status-text { display: none; }
  .header-status { padding: 10px; }
  .header-content { column-gap: 4px; }
}

@media (prefers-reduced-motion: reduce) {
  .header-navigation,
  .navigation-item,
  .navigation-icon { transition: none; }
}
</style>
