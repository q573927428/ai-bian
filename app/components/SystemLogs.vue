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
        <span class="log-message">{{ log.message }}</span>
      </div>
      <el-empty v-if="botStore.logs.length === 0" description="暂无日志" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

const botStore = useBotStore()

// 倒序显示日志，最新的在最上面
const reversedLogs = computed(() => [...botStore.logs].reverse())

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('HH:mm:ss')
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
}
</style>
