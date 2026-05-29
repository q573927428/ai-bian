<template>
  <div class="chart-info" v-if="klineData.length > 0">
    <div class="info-row">
      <span class="info-label">数据量:</span>
      <span class="info-value">{{ klineData.length }} 条</span>
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
}

const props = withDefaults(defineProps<Props>(), {
  klineData: () => [],
  updated: 0
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
  
  .info-row {
    justify-content: space-between;
  }
}
</style>
