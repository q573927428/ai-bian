<template>
  <div class="chart-engine-switcher">
    <!-- 自研K线引擎 -->
    <KLineChartSimple
      v-if="activeEngine === 'native'"
      :symbol="symbol"
      :timeframe="timeframe"
      :active-engine="activeEngine"
      @switch-engine="handleEngineChange"
    />

    <!-- TradingView引擎 -->
    <TradingViewKLinePanel
      v-else
      :symbol="symbol"
      :timeframe="timeframe"
      :active-engine="activeEngine"
      @switch-engine="handleEngineChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import KLineChartSimple from './KLineChartSimple.vue'
import TradingViewKLinePanel from './TradingViewKLinePanel.vue'

// ==================== 属性 ====================
const props = defineProps<{
  symbol: string
  timeframe?: string
}>()

// ==================== 引擎切换 ====================
const STORAGE_KEY = 'chart-engine-preference'

// 活动引擎：'native' | 'tradingview'
const activeEngine = ref<'native' | 'tradingview'>('native')

// 处理引擎切换
function handleEngineChange(engine: 'native' | 'tradingview') {
  activeEngine.value = engine
  // 持久化用户偏好
  try {
    localStorage.setItem(STORAGE_KEY, engine)
  } catch {
    // localStorage 不可用时静默失败
  }
}

// ==================== 初始化 ====================
onMounted(() => {
  // 从 localStorage 恢复用户偏好
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'native' || saved === 'tradingview') {
      activeEngine.value = saved
    }
  } catch {
    // localStorage 不可用时使用默认值
  }
})
</script>

<style scoped>
.chart-engine-switcher {
  margin-bottom: 20px;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}

.engine-switch-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e7ed);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
}
</style>
