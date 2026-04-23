<template>
  <el-card class="card" shadow="hover" style="margin-top: 20px">
    <template #header>
      <div class="card-header">
        <div class="header-top">
          <el-tabs v-model="activeTab" class="log-tabs">
            <el-tab-pane label="全部" name="all" />
            <el-tab-pane label="扫描" name="scan" />
            <el-tab-pane label="持仓" name="position" />
          </el-tabs>
          <el-select v-model="selectedStrategy" placeholder="策略筛选" clearable class="strategy-select">
            <el-option label="全部" value="" />
            <el-option 
              v-for="strategy in strategies" 
              :key="strategy.id" 
              :label="strategy.name" 
              :value="strategy.id" 
            />
          </el-select>
        </div>
      </div>
    </template>

    <div class="logs-container">
      <div
        v-for="(log, index) in filteredLogs"
        :key="`${log.timestamp}-${index}`"
        :class="['log-item', `log-${log.level.toLowerCase()}`]"
      >
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <div class="log-message">
          <template v-if="hasDetailedLog(log.message)">
            <div class="log-summary-line">
              <span><b>[{{ log.category }}]</b> {{ getLogSummary(log.message) }}</span>
              <el-link
                type="primary"
                :underline="false"
                class="toggle-btn"
                @click="toggleLog(index)"
              >
                <el-icon>
                  <ElIconArrowDown v-if="expandedLogs.has(index)" />
                  <ElIconArrowRight v-else />
                </el-icon>
                {{ expandedLogs.has(index) ? '收起' : '展开' }}
              </el-link>
            </div>
            <div v-if="expandedLogs.has(index)" class="detailed-log">
              <div class="detailed-log-header">=== 详细AI日志 ===</div>
              <div class="detailed-log-content">{{ getDetailedLog(log.message) }}</div>
            </div>
          </template>
          <span v-else><b>[{{ log.category }}]</b> {{ log.message }}</span>
        </div>
      </div>
      <el-empty v-if="filteredLogs.length === 0" description="暂无日志" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

const botStore = useBotStore()

// 当前选中的标签
const activeTab = ref<string>('all')
// 当前选中的策略
const selectedStrategy = ref<string>('')
// 策略列表
const strategies = ref<Array<{ id: string; name: string }>>([])

// 倒序显示日志，最新的在最上面
const reversedLogs = computed(() => [...botStore.logs].reverse())

// 筛选后的日志
const filteredLogs = computed(() => {
  let logs = reversedLogs.value
  
  // 先按标签筛选
  if (activeTab.value !== 'all') {
    logs = logs.filter(log => {
      if (activeTab.value === 'scan') {
        return log.category.toLowerCase().includes('扫描') || 
               log.category.toLowerCase().includes('信号') 
      }
      if (activeTab.value === 'position') {
        return log.category.toLowerCase().includes('持仓') || 
               log.category.toLowerCase().includes('监控') || 
               log.category.toLowerCase().includes('极值') || 
               log.category.toLowerCase().includes('移动') || 
               log.category.toLowerCase().includes('止盈') || 
               log.category.toLowerCase().includes('止损') 
      }
      return true
    })
  }
  
  // 再按策略筛选
  if (selectedStrategy.value) {
    const strategyName = strategies.value.find(s => s.id === selectedStrategy.value)?.name
    if (strategyName) {
      logs = logs.filter(log => 
        log.message.includes(strategyName) || 
        log.category.includes(strategyName) ||
        (log.data?.strategyId === selectedStrategy.value)
      )
    }
  }
  
  return logs
})

// 获取策略列表
async function fetchStrategies() {
  try {
    const response = await $fetch('/api/strategies')
    if (response.success && response.data) {
      strategies.value = response.data.map((s: any) => ({
        id: s.id,
        name: s.name
      }))
    }
  } catch (error) {
    console.error('获取策略列表失败:', error)
  }
}

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
  // 获取策略列表
  await fetchStrategies()
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
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: -18px;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
}

.strategy-select {
  width: 120px;
  flex-shrink: 0;
}

.card-header span {
  font-weight: 600;
  font-size: 15px;
}

.log-tabs {
  width: 100%;
}

.log-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.logs-container {
  max-height: 376px;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: #909399;
}

.log-item {
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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
  flex-basis: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 响应式优化 - 手机端 */
@media (max-width: 768px) {
  .log-item {
    flex-direction: column;
    gap: 4px;
  }

  .log-time,
  .log-category {
    font-size: 12px;
  }

  .log-message {
    flex-basis: auto;
    margin-top: 2px;
  }
}

/* 平板和桌面端 */
@media (min-width: 769px) {
  .log-message {
    flex-basis: 0;
  }
}

.log-summary-line {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
}

.log-summary-line > span {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.toggle-btn {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  white-space: nowrap;
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