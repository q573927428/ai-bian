<!-- ==================== K线扫描结果详情弹窗 ==================== -->
<template>
  <el-dialog
    v-model="visible"
    :title="`${symbol} · ${timeframe} 扫描结果`"
    width="min(760px, 94vw)"
    append-to-body
    destroy-on-close
    draggable
    class="scan-result-dialog"
  >
    <div class="dialog-meta">
      <span>{{ formattedKlineTime }}</span>
      <el-tag size="small" type="info">{{ results.length }} 条</el-tag>
    </div>

    <div class="result-list">
      <article v-for="(result, index) in results" :key="`${result.timestamp}-${index}`" class="result-item">
        <header class="result-header">
          <div class="result-time">
            <span>{{ formatScanTime(result.timestamp) }}</span>
            <el-tag size="small" :type="result.skipped ? 'info' : directionTagType(result.direction)">
              {{ result.skipped ? '预筛跳过' : (result.direction || '扫描') }}
            </el-tag>
            <el-tag v-if="result.level === 'SUCCESS'" size="small" type="success">通过</el-tag>
          </div>
          <span class="strategy-id">{{ result.strategyId }}</span>
        </header>

        <p class="result-summary">{{ result.summary }}</p>
        <div v-if="result.detail" class="result-detail">
          <p>{{ result.detail }}</p>
        </div>
      </article>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StrategyScanResult } from '../../../types/scan-result'

// 弹窗属性：展示用户点击的单根 K 线及其全部扫描记录。
interface Props {
  modelValue: boolean
  symbol: string
  timeframe: string
  klineTime: number
  results: StrategyScanResult[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const formattedKlineTime = computed(() => new Date(props.klineTime * 1000).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
}))

/**
 * 格式化单条扫描发生的精确时间，便于比较同一 K 线内的多次判断。
 */
const formatScanTime = (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

/**
 * 使用方向区分结果标签；IDLE 保持中性，避免被误认成交易信号。
 */
const directionTagType = (direction: StrategyScanResult['direction']) => {
  if (direction === 'LONG') return 'success'
  if (direction === 'SHORT') return 'danger'
  return 'warning'
}
</script>

<style scoped>
.dialog-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}

.result-item {
  border: 1px solid var(--border-color);
  border-left: 3px solid #d79b28;
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-card);
}

.result-header,
.result-time {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.result-header {
  justify-content: space-between;
}

.result-time {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.strategy-id {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 12px;
}

.result-summary,
.result-detail p {
  margin: 10px 0 0;
  color: var(--text-regular);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.result-detail {
  margin-top: 10px;
}

.result-detail p {
  margin-top: 0;
  color: var(--text-secondary);
}

@media (max-width: 576px) {
  .result-item {
    padding: 10px;
  }

  .result-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
