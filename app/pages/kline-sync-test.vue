<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-6">K线同步服务测试页面</h1>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- 状态卡片 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-4">同步状态</h2>
        <div v-if="loadingStatus" class="text-gray-500">加载中...</div>
        <div v-else-if="statusError" class="text-red-500">{{ statusError }}</div>
        <div v-else>
          <div v-for="item in syncStatus" :key="`${item.symbol}-${item.timeframe}`" 
               class="mb-3 p-3 border rounded">
            <div class="flex justify-between items-center">
              <span class="font-medium">{{ item.symbol }}/{{ item.timeframe }}</span>
              <span :class="{
                'bg-green-100 text-green-800': item.status === 'idle',
                'bg-blue-100 text-blue-800': item.status === 'syncing',
                'bg-red-100 text-red-800': item.status === 'error'
              }" class="px-2 py-1 rounded text-xs">
                {{ getStatusText(item.status) }}
              </span>
            </div>
            <div class="text-sm text-gray-600 mt-1">
              最后同步: {{ formatTime(item.lastSyncTime) }}
            </div>
            <div class="text-sm text-gray-600">
              总数据: {{ item.totalBars }} 条
            </div>
          </div>
        </div>
        <button @click="fetchStatus" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          刷新状态
        </button>
      </div>
      
      <!-- 控制卡片 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-4">控制面板</h2>
        
        <div class="space-y-4">
          <div>
            <button @click="triggerSync" :disabled="syncing" 
                    class="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300">
              {{ syncing ? '同步中...' : '手动触发同步' }}
            </button>
          </div>
          
          <div class="grid grid-cols-2 gap-2">
            <button @click="startAutoSync" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              启动定时同步
            </button>
            <button @click="stopAutoSync" class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
              停止定时同步
            </button>
          </div>
          
          <div v-if="syncResult" class="p-3 rounded" :class="{
            'bg-green-100 text-green-800': syncResult.success,
            'bg-red-100 text-red-800': !syncResult.success
          }">
            {{ syncResult.message }}
          </div>
        </div>
      </div>
      
      <!-- 配置卡片 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-4">服务配置</h2>
        <div v-if="loadingConfig" class="text-gray-500">加载中...</div>
        <div v-else-if="configError" class="text-red-500">{{ configError }}</div>
        <pre v-else class="bg-gray-50 p-3 rounded text-sm overflow-auto">{{ JSON.stringify(config, null, 2) }}</pre>
        <button @click="fetchConfig" class="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          刷新配置
        </button>
      </div>
      
      <!-- 历史同步卡片 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-4">历史数据同步</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">交易对</label>
            <select v-model="historySymbol" class="w-full px-3 py-2 border rounded">
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="BNBUSDT">BNBUSDT</option>
            </select>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">时间周期</label>
            <select v-model="historyTimeframe" class="w-full px-3 py-2 border rounded">
              <option value="15m">15分钟</option>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">1天</option>
              <option value="1w">1周</option>
            </select>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">数据条数</label>
            <input v-model.number="historyTotalBars" type="number" min="100" max="50000" 
                   class="w-full px-3 py-2 border rounded" placeholder="例如: 11000">
          </div>
          
          <button @click="syncHistory" :disabled="syncingHistory" 
                  class="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-300">
            {{ syncingHistory ? '同步中...' : '同步历史数据' }}
          </button>
          
          <div v-if="historyResult" class="p-3 rounded" :class="{
            'bg-green-100 text-green-800': historyResult.success,
            'bg-red-100 text-red-800': !historyResult.success
          }">
            {{ historyResult.message }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface SyncStatus {
  symbol: string
  timeframe: string
  lastSyncTime: number
  lastSyncCount: number
  totalBars: number
  status: 'idle' | 'syncing' | 'error'
  error?: string
}

interface SyncResult {
  success: boolean
  message: string
  data?: any
}

interface SyncConfig {
  symbols: string[]
  timeframes: string[]
  maxBars: number
  syncInterval: number
}

// 状态
const syncStatus = ref<SyncStatus[]>([])
const loadingStatus = ref(false)
const statusError = ref('')

const config = ref<SyncConfig | null>(null)
const loadingConfig = ref(false)
const configError = ref('')

const syncResult = ref<SyncResult | null>(null)
const syncing = ref(false)

const historySymbol = ref('BTCUSDT')
const historyTimeframe = ref('15m')
const historyTotalBars = ref(11000)
const historyResult = ref<SyncResult | null>(null)
const syncingHistory = ref(false)

// 获取状态文本
const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    'idle': '空闲',
    'syncing': '同步中',
    'error': '错误'
  }
  return map[status] || status
}

// 格式化时间
const formatTime = (timestamp: number) => {
  if (!timestamp) return '从未同步'
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

// 获取同步状态
const fetchStatus = async () => {
  loadingStatus.value = true
  statusError.value = ''
  
  try {
    const response = await fetch('/api/kline-sync/status')
    const data = await response.json()
    
    if (data.success) {
      syncStatus.value = data.data
    } else {
      statusError.value = data.error || '获取状态失败'
    }
  } catch (error: any) {
    statusError.value = error.message || '请求失败'
  } finally {
    loadingStatus.value = false
  }
}

// 获取配置
const fetchConfig = async () => {
  loadingConfig.value = true
  configError.value = ''
  
  try {
    const response = await fetch('/api/kline-sync/config')
    const data = await response.json()
    
    if (data.success) {
      config.value = data.data
    } else {
      configError.value = data.error || '获取配置失败'
    }
  } catch (error: any) {
    configError.value = error.message || '请求失败'
  } finally {
    loadingConfig.value = false
  }
}

// 触发同步
const triggerSync = async () => {
  syncing.value = true
  syncResult.value = null
  
  try {
    const response = await fetch('/api/kline-sync/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ force: false })
    })
    
    const data = await response.json()
    syncResult.value = data
    
    // 刷新状态
    await fetchStatus()
  } catch (error: any) {
    syncResult.value = {
      success: false,
      message: error.message || '请求失败'
    }
  } finally {
    syncing.value = false
  }
}

// 启动定时同步
const startAutoSync = async () => {
  try {
    const response = await fetch('/api/kline-sync/auto-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'start' })
    })
    
    const data = await response.json()
    syncResult.value = data
    
    // 刷新状态
    await fetchStatus()
  } catch (error: any) {
    syncResult.value = {
      success: false,
      message: error.message || '请求失败'
    }
  }
}

// 停止定时同步
const stopAutoSync = async () => {
  try {
    const response = await fetch('/api/kline-sync/auto-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'stop' })
    })
    
    const data = await response.json()
    syncResult.value = data
    
    // 刷新状态
    await fetchStatus()
  } catch (error: any) {
    syncResult.value = {
      success: false,
      message: error.message || '请求失败'
    }
  }
}

// 同步历史数据
const syncHistory = async () => {
  syncingHistory.value = true
  historyResult.value = null
  
  try {
    const response = await fetch('/api/kline-sync/history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol: historySymbol.value,
        timeframe: historyTimeframe.value,
        totalBars: historyTotalBars.value,
        batchSize: 1000
      })
    })
    
    const data = await response.json()
    historyResult.value = data
    
    // 刷新状态
    await fetchStatus()
  } catch (error: any) {
    historyResult.value = {
      success: false,
      message: error.message || '请求失败'
    }
  } finally {
    syncingHistory.value = false
  }
}

// 初始化
onMounted(() => {
  fetchStatus()
  fetchConfig()
})
</script>

<style scoped>
/* 简单样式 */
.p-6 { padding: 1.5rem; }
.mb-6 { margin-bottom: 1.5rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.font-bold { font-weight: 700; }
.grid { display: grid; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.md\:grid-cols-2 { @media (min-width: 768px) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.gap-6 { gap: 1.5rem; }
.bg-white { background-color: white; }
.rounded-lg { border-radius: 0.5rem; }
.shadow { box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); }
.p-4 { padding: 1rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.font-semibold { font-weight: 600; }
.mb-4 { margin-bottom: 1rem; }
.text-gray-500 { color: #6b7280; }
.text-red-500 { color: #ef4444; }
.mb-3 { margin-bottom: 0.75rem; }
.border { border-width: 1px; border-style: solid; border-color: #e5e7eb; }
.rounded { border-radius: 0.25rem; }
.flex { display: flex; }
.justify-between { justify-content: space-between; }
.items-center { align-items: center; }
.font-medium { font-weight: 500; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.bg-green-100 { background-color: #d1fae5; }
.text-green-800 { color: #065f46; }
.bg-blue-100 { background-color: #dbeafe; }
.text-blue-800 { color: #1e40af; }
.bg-red-100 { background-color: #fee2e2; }
.text-red-800 { color: #991b1b; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-gray-600 { color: #4b5563; }
.mt-1 { margin-top: 0.25rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.bg-blue-500 { background-color: #3b82f6; }
.text-white { color: white; }
.hover\:bg-blue-600:hover { background-color: #2563eb; }
.mt-4 { margin-top: 1rem; }
.space-y-4 > * + * { margin-top: 1rem; }
.w-full { width: 100%; }
.bg-green-500 { background-color: #10b981; }
.hover\:bg-green-600:hover { background-color: #059669; }
.disabled\:bg-gray-300:disabled { background-color: #d1d5db; }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gap-2 { gap: 0.5rem; }
.bg-red-500 { background-color: #ef4444; }
.hover\:bg-red-600:hover { background-color: #dc2626; }
.bg-gray-50 { background-color: #f9fafb; }
.overflow-auto { overflow: auto; }
.bg-gray-500 { background-color: #6b7280; }
.hover\:bg-gray-600:hover { background-color: #4b5563; }
.space-y-3 > * + * { margin-top: 0.75rem; }
.block { display: block; }
.text-gray-700 { color: #374151; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.bg-purple-500 { background-color: #8b5cf6; }
.hover\:bg-purple-600:hover { background-color: #7c3aed; }
</style>