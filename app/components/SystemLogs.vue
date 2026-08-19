<template>
  <el-card class="card" shadow="hover" style="margin-top: 20px">
    <template #header>
      <div class="card-header">
        <div class="header-top">
          <div class="header-title-group">
            <span class="header-title">⚡ 运行日志</span>
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!hasDetailedLogs"
              @click="toggleAllDetailedLogs"
            >
              <el-icon>
                <ElIconArrowDown v-if="showDetailedLogs" />
                <ElIconArrowRight v-else />
              </el-icon>
              {{ showDetailedLogs ? '收起' : '展开' }}
            </el-button>
          </div>
          <div class="filter-group">
            <el-select v-model="activeTab" placeholder="扫描" class="filter-select">
              <el-option label="全部" value="all" />
              <el-option label="扫描" value="scan" />
              <el-option label="持仓" value="position" />
            </el-select>
            <el-select v-model="selectedStrategy" placeholder="策略" clearable class="filter-select">
              <el-option label="全部" value="" />
              <el-option 
                v-for="strategy in strategies" 
                :key="strategy.id" 
                :label="strategy.name" 
                :value="strategy.id" 
              />
            </el-select>
            <el-select v-model="selectedSymbol" placeholder="交易对" clearable class="filter-select">
              <el-option label="全部" value="" />
              <el-option 
                v-for="symbol in symbols" 
                :key="symbol" 
                :label="symbol" 
                :value="symbol" 
              />
            </el-select>
          </div>
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
            </div>
            <div v-if="showDetailedLogs" class="detailed-log">
              <!-- <div class="detailed-log-header">=== 详细AI日志 ===</div> -->
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
// 当前选中的交易对
const selectedSymbol = ref<string>('')
// 策略列表
const strategies = ref<Array<{ id: string; name: string }>>([])
// 交易对列表
const symbols = ref<string[]>([])


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
    const strategyId = selectedStrategy.value
    logs = logs.filter(log => 
      log.message.includes(strategyId) || 
      log.category.includes(strategyId) ||
      (log.data?.strategyId === strategyId)
    )
  }
  
  // 再按交易对筛选
  if (selectedSymbol.value) {
    const symbol = selectedSymbol.value
    logs = logs.filter(log => 
      log.message.includes(symbol) || 
      log.category.includes(symbol) ||
      (log.data?.symbol === symbol)
    )
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

const DETAILED_LOG_SEPARATOR = '===详细AI日志==='

// 详细 AI 日志默认收起，并由标题栏按钮统一控制全部日志。
const showDetailedLogs = ref(false)

// 当前筛选结果中是否存在详细 AI 日志，用于控制全局切换按钮状态。
const hasDetailedLogs = computed(() =>
  filteredLogs.value.some(log => hasDetailedLog(log.message))
)

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

/**
 * 统一展开或收起当前日志列表中的全部详细 AI 日志。
 */
function toggleAllDetailedLogs(): void {
  showDetailedLogs.value = !showDetailedLogs.value
}

// 获取交易对列表
function fetchSymbols() {
  if (botStore.botConfig?.symbols && Array.isArray(botStore.botConfig.symbols)) {
    symbols.value = botStore.botConfig.symbols
  }
}

// 组件加载时获取日志并订阅共享轮询
onMounted(async () => {
  // 获取策略列表
  await fetchStrategies()
  // 获取交易对列表
  fetchSymbols()
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
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
}

.filter-group {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.filter-select {
  width: 100px;
}

.card-header span {

  font-weight: 600;
  font-size: 15px;
}

.header-title {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
}

.header-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.logs-container {
  max-height: 576px;
  overflow-y: auto;
  padding: 10px;
  background: var(--bg-log);
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: var(--bg-main);
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: var(--text-placeholder);
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
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
  background: var(--log-info-bg);
}

.log-success {
  background: var(--log-success-bg);
  color: var(--color-success);
}

.log-warn {
  background: var(--log-warn-bg);
  color: var(--color-warning);
}

.log-error {
  background: var(--log-error-bg);
  color: var(--color-danger);
}

.log-time {
  color: var(--text-secondary);
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

@media (max-width: 768px) {
  .header-top {
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-group {
    width: 100%;
    flex-wrap: wrap;
  }

  .filter-select {
    flex: 1;
    min-width: 0;
  }

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

.detailed-log {
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-code-block);
  border-radius: 4px;
  border-left: 3px solid var(--color-primary);
  width: 100%;
}

.detailed-log-header {
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 6px;
  font-size: 12px;
}

.detailed-log-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-regular);
}
</style>
