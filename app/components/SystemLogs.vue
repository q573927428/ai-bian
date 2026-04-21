<template>
  <el-card class="card" shadow="hover" style="margin-top: 20px">
    <template #header>
      <div class="card-header">
        <span>📝 系统日志</span>
      </div>
    </template>

    <div class="logs-container">
      <div
        v-for="(log, index) in reversedLogs"
        :key="`${log.timestamp}-${index}`"
        :class="['log-item', `log-${log.level.toLowerCase()}`]"
      >
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <span class="log-category">[{{ log.category }}]</span>
        <div class="log-message">
          <template v-if="hasDetailedLog(log.message)">
            <div class="log-summary-line">
              <span>{{ getLogSummary(log.message) }}</span>
              <el-link
                type="primary"
                :underline="false"
                class="toggle-btn"
                @click="toggleLog(index)"
              >
                <el-icon><component :is="expandedLogs.has(index) ? 'ElIconArrowDown' : 'ElIconArrowRight'" /></el-icon>
                {{ expandedLogs.has(index) ? '收起' : '展开' }}详细
              </el-link>
            </div>
            <div v-if="expandedLogs.has(index)" class="detailed-log">
              <div class="detailed-log-header">=== 详细AI日志 ===</div>
              <div class="detailed-log-content">{{ getDetailedLog(log.message) }}</div>
            </div>
          </template>
          <span v-else>{{ log.message }}</span>
        </div>
      </div>
      <el-empty v-if="botStore.logs.length === 0" description="暂无日志" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

const botStore = useBotStore()

// 倒序显示日志，最新的在最上面
const reversedLogs = computed(() => [...botStore.logs].reverse())

// 记录展开状态的日志索引
const expandedLogs = ref<Set<number>>(new Set())

const DETAILED_LOG_SEPARATOR = '===详细AI日志==='

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('HH:mm:ss')
}

function hasDetailedLog(message: string): boolean {
  return message.includes(DETAILED_LOG_SEPARATOR)
}

function getLogSummary(message: string): string {
  const index = message.indexOf(DETAILED_LOG_SEPARATOR)
  return index > 0 ? message.substring(0, index).trim() : message
}

function getDetailedLog(message: string): string {
  const index = message.indexOf(DETAILED_LOG_SEPARATOR)
  return index > 0 ? message.substring(index + DETAILED_LOG_SEPARATOR.length).trim() : ''
}

function toggleLog(index: number): void {
  if (expandedLogs.value.has(index)) {
    expandedLogs.value.delete(index)
  } else {
    expandedLogs.value.add(index)
  }
}

// 组件加载时获取日志并订阅共享轮询
onMounted(async () => {
  // 订阅共享轮询
  botStore.subscribeToPolling('system-logs')
})

// 组件卸载时取消订阅共享轮询
onUnmounted(() => {
  botStore.unsubscribeFromPolling('system-logs')
})
</script>

<style scoped>
.card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.logs-container {
  max-height: 445px;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
  border-radius: 4px;
}

.log-item {
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  display: flex;
  gap: 8px;
}

.log-info {
  background: #f4f4f5;
}

.log-success {
  background: #f0f9ff;
  color: #67c23a;
}

.log-warn {
  background: #fdf6ec;
  color: #e6a23c;
}

.log-error {
  background: #fef0f0;
  color: #f56c6c;
}

.log-time {
  color: #909399;
  flex-shrink: 0;
}

.log-category {
  font-weight: 600;
  flex-shrink: 0;
}

.log-message {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-summary-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.toggle-btn {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  flex-shrink: 0;
}

.detailed-log {
  margin-top: 8px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
  border-left: 3px solid #409eff;
  width: 100%;
}

.detailed-log-header {
  font-weight: 600;
  color: #409eff;
  margin-bottom: 6px;
  font-size: 12px;
}

.detailed-log-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
}
</style>