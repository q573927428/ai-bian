<template>
  <el-card class="history-card">
    <template #header>
      <div class="card-header">
        <span>📋 历史订单 ({{ total }})</span>
        <div class="header-actions">
          <el-button size="small" text @click="showFilter = !showFilter">
            <el-icon><ElIconFilter /></el-icon>
            筛选
          </el-button>
          <el-button type="primary" size="small" text :loading="loading" @click="refreshHistory">
            <el-icon><ElIconRefresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>
    </template>

    <!-- 筛选栏 -->
    <div v-if="showFilter" class="filter-bar">
      <div class="filter-row">
        <div class="filter-item">
          <span class="filter-label">交易对</span>
          <el-select
            v-model="filter.symbol"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="s in tradeHistoryStore.availableSymbols"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">方向</span>
          <el-select
            v-model="filter.direction"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option label="做多" value="LONG" />
            <el-option label="做空" value="SHORT" />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">策略</span>
          <el-select
            v-model="filter.strategyId"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="s in tradeHistoryStore.availableStrategies"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">平仓原因</span>
          <el-select
            v-model="filter.closeCategory"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="c in tradeHistoryStore.availableCloseCategories"
              :key="c"
              :label="getCloseCategoryLabel(c)"
              :value="c"
            />
          </el-select>
        </div>

        <el-button size="small" type="primary" @click="handleResetFilter">
          重置
        </el-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && orders.length === 0" class="loading-state">
      <el-icon class="loading-icon"><ElIconLoading /></el-icon>
      <span>加载中...</span>
    </div>

    <!-- 空状态 -->
    <div v-else-if="orders.length === 0" class="empty-state">
      <el-icon class="empty-icon"><ElIconDataAnalysis /></el-icon>
      <span>暂无历史订单</span>
    </div>

    <!-- 表格 -->
    <el-table
      v-else
      :data="orders"
      stripe
      border
      size="small"
      style="width: 100%"
      :header-cell-style="{ background: '#f5f7fa', color: '#303133', fontWeight: 600 }"
      @sort-change="handleSortChange"
    >
      <el-table-column label="交易对" width="100" fixed>
        <template #default="{ row }">
          <span class="symbol">{{ row.symbol }}</span>
        </template>
      </el-table-column>

      <el-table-column label="方向" width="70" align="center">
        <template #default="{ row }">
          <el-tag
            :type="row.direction === 'LONG' ? 'success' : 'danger'"
            size="small"
            effect="dark"
          >
            {{ row.direction === 'LONG' ? '做多' : '做空' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="策略" min-width="110">
        <template #default="{ row }">
          <el-tag v-if="row.strategyId" type="info" size="small" effect="plain">
            {{ row.strategyId }}
          </el-tag>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column>

      <el-table-column
        label="入场价"
        width="80"
        align="right"
        prop="entryPrice"
        sortable="custom"
      >
        <template #default="{ row }">
          ${{ row.entryPrice?.toFixed(2) }}
        </template>
      </el-table-column>

      <el-table-column
        label="出场价"
        width="80"
        align="right"
        prop="exitPrice"
        sortable="custom"
      >
        <template #default="{ row }">
          ${{ row.exitPrice?.toFixed(2) }}
        </template>
      </el-table-column>

      <el-table-column
        label="数量"
        width="70"
        align="right"
        prop="quantity"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ row.quantity }}
        </template>
      </el-table-column>

      <el-table-column label="杠杆" width="60" align="center">
        <template #default="{ row }">
          {{ row.leverage }}x
        </template>
      </el-table-column>

      <el-table-column
        label="盈亏"
        width="70"
        align="right"
        prop="pnl"
        sortable="custom"
      >
        <template #default="{ row }">
          <span :class="row.pnl >= 0 ? 'text-success' : 'text-danger'">
            ${{ row.pnl >= 0 ? '+' : '' }}{{ row.pnl?.toFixed(2) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column
        label="盈亏%"
        width="80"
        align="right"
        prop="pnlPercentage"
        sortable="custom"
      >
        <template #default="{ row }">
          <span :class="row.pnlPercentage >= 0 ? 'text-success' : 'text-danger'">
            {{ row.pnlPercentage >= 0 ? '+' : '' }}{{ row.pnlPercentage?.toFixed(2) }}%
          </span>
        </template>
      </el-table-column>

      <el-table-column label="手续费" width="70" align="right">
        <template #default="{ row }">
          ${{ row.totalCommission != null ? row.totalCommission.toFixed(2) : '--' }}
        </template>
      </el-table-column>

      <el-table-column
        label="开仓时间"
        width="100"
        align="center"
        prop="openTime"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatTime(row.openTime) }}
        </template>
      </el-table-column>

      <el-table-column
        label="平仓时间"
        width="100"
        align="center"
        prop="closeTime"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatTime(row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column
        label="持仓"
        min-width="90"
        align="center"
        prop="holdingMinutes"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatHoldingTime(row.openTime, row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column label="原因" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            :type="getCloseCategoryType(row.closeCategory)"
            size="small"
          >
            {{ getCloseCategoryLabel(row.closeCategory) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        hide-on-single-page
        :page-size="pageSize"
        :total="total"
        :pager-count="5"
        layout="prev, pager, next, total"
        background
        size="small"
        @current-change="handlePageChange"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import type { TradeHistory } from '../../types'
import { useTradeHistoryStore, type FilterConfig } from '../stores/tradeHistory'

const tradeHistoryStore = useTradeHistoryStore()

const orders = ref<TradeHistory[]>([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const totalPages = ref(0)
const loading = ref(false)
const showFilter = ref(false)

// 本地筛选条件（与 store 同步）
const filter = reactive<FilterConfig>({
  symbol: '',
  direction: '',
  strategyId: '',
  closeCategory: '',
})

// 加载历史订单
const loadHistory = async () => {
  loading.value = true
  try {
    await tradeHistoryStore.fetchAllHistory(false)
    const paginated = tradeHistoryStore.getPaginatedHistory(currentPage.value, pageSize.value)
    orders.value = paginated.data
    total.value = paginated.total
    totalPages.value = paginated.totalPages
  } catch (error) {
    console.error('加载历史订单失败:', error)
  } finally {
    loading.value = false
  }
}

// 强制刷新
const refreshHistory = async () => {
  loading.value = true
  try {
    await tradeHistoryStore.fetchAllHistory(true)
    const paginated = tradeHistoryStore.getPaginatedHistory(currentPage.value, pageSize.value)
    orders.value = paginated.data
    total.value = paginated.total
    totalPages.value = paginated.totalPages
  } catch (error) {
    console.error('加载历史订单失败:', error)
  } finally {
    loading.value = false
  }
}

// 筛选条件变更
const handleFilterChange = () => {
  tradeHistoryStore.setFilter({ ...filter })
  currentPage.value = 1
  loadHistory()
}

// 重置筛选
const handleResetFilter = () => {
  filter.symbol = ''
  filter.direction = ''
  filter.strategyId = ''
  filter.closeCategory = ''
  tradeHistoryStore.resetFilter()
  currentPage.value = 1
  loadHistory()
}

// 排序变更
const handleSortChange = ({ prop, order }: { prop?: string; order?: string }) => {
  if (prop && order) {
    tradeHistoryStore.setSort(prop as any)
  }
  currentPage.value = 1
  loadHistory()
}

// 分页切换
const handlePageChange = (page: number) => {
  currentPage.value = page
  loadHistory()
}

// 格式化时间
function formatTime(timestamp: number): string {
  if (!timestamp) return '--'
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 格式化持仓时间
function formatHoldingTime(openTime: number, closeTime: number): string {
  if (!openTime || !closeTime) return '--'
  const diffMs = closeTime - openTime
  if (diffMs < 0) return '--'
  const totalMinutes = Math.floor(diffMs / 60000)
  if (totalMinutes < 60) return `${totalMinutes}分钟`
  const hours = Math.floor(totalMinutes / 60)
  const remainMinutes = totalMinutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainHours = hours % 24
    if (remainHours > 0 && remainMinutes > 0) {
      return `${days}天 ${remainHours}时 ${remainMinutes}分`
    }
    if (remainHours > 0) {
      return `${days}天 ${remainHours}小时`
    }
    if (remainMinutes > 0) {
      return `${days}天 ${remainMinutes}分`
    }
    return `${days}天`
  }
  return remainMinutes > 0 ? `${hours}小时 ${remainMinutes}分` : `${hours}小时`
}

// 获取平仓分类标签
function getCloseCategoryLabel(category?: string): string {
  const labels: Record<string, string> = {
    stop_loss: '止损',
    take_profit: '止盈',
    timeout: '超时',
    manual: '手动',
    trailing_stop: '移动止损',
    unknown: '未知',
  }
  return category ? labels[category] || category : '--'
}

// 获取平仓分类类型
function getCloseCategoryType(category?: string): 'danger' | 'success' | 'warning' | 'info' {
  const types: Record<string, 'danger' | 'success' | 'warning' | 'info'> = {
    stop_loss: 'danger',
    take_profit: 'success',
    timeout: 'warning',
    manual: 'info',
    trailing_stop: 'warning',
    unknown: 'info',
  }
  return category ? types[category] || 'info' : 'info'
}

// 轮询定时器
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  loadHistory()
  // 每30秒自动刷新
  pollTimer = setInterval(loadHistory, 30000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped>
.history-card {
  margin-top: 20px;
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 18px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.filter-bar {
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 8px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: #909399;
  gap: 12px;
}

.loading-icon {
  font-size: 32px;
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-icon {
  font-size: 48px;
  color: #c0c4cc;
}

.symbol {
  font-weight: 700;
  color: #1f2937;
  font-size: 13px;
}

.text-success {
  color: #10b981;
  font-weight: 600;
}

.text-danger {
  color: #ef4444;
  font-weight: 600;
}

.text-muted {
  color: #c0c4cc;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}
</style>
