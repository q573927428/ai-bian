<template>
  <div class="chart-info" :class="{ 'chart-info-floating': floating }" v-if="klineData.length > 0">
    <div class="info-row">
      <span class="info-label">总K线:</span>
      <span class="info-value">{{ klineData.length }} 根</span>
    </div>
    <div class="info-row">
      <span class="info-label">时间范围:</span>
      <span class="info-value">{{ formatTime(klineData[0]?.t || 0) }} - {{ formatTime(klineData[klineData.length - 1]?.t || 0) }}</span>
    </div>
    <div class="info-row">
      <span class="info-label">最后更新:</span>
      <span class="info-value">{{ formatTime(updated) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SimpleKLineData } from '../../../types/kline-simple'
import { formatTime } from './utils/kline-formatters'

// 定义props
interface Props {
  klineData: SimpleKLineData[]
  updated?: number
  /** 在图表覆盖层中使用紧凑、透明的悬浮样式。 */
  floating?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  klineData: () => [],
  updated: 0,
  floating: false
})
</script>

<style scoped>
.chart-info {
  padding: 12px 20px;
  background: var(--bg-hover);
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 24px;
}

.chart-info-floating {
  padding: 4px 0;
  background: transparent;
  border-top: 0;
  gap: 16px;
  pointer-events: none;
}

.chart-info-floating .info-label,
.chart-info-floating .info-value {
  font-size: 11px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.info-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

@media (max-width: 480px) {
  .chart-info {
    padding: 10px 12px;
  }

  .chart-info-floating {
    padding: 4px 0;
    flex-wrap: wrap;
    gap: 2px 12px;
  }
  
  .info-row {
    justify-content: space-between;
  }
}
</style>
