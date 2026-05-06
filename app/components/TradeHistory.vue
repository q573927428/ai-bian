<template>
  <el-card class="history-card">
    <template #header>
      <div class="card-header">
        <span>📋 历史订单 ({{ total }})</span>
        <el-button type="primary" size="small" :loading="loading" @click="loadHistory">
          <el-icon><ElIconRefresh /></el-icon>
          刷新
        </el-button>
      </div>
    </template>

    <!-- 加载状态 -->
    <div v-if="loading && orders.length === 0" class="loading-state">
      <el-icon class="loading-icon"><ElIconLoading /></el-icon>
      <span>加载中...</span>
    </div>

    <!-- 空状态 -->
    <div v-else-if="orders.length === 0" class="empty-state">
      <el-icon class="empty-icon"><ElIconInbox /></el-icon>
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

      <el-table-column label="策略" min-width="90">
        <template #default="{ row }">
          <el-tag v-if="row.strategyId" type="info" size="small" effect="plain">
            {{ row.strategyId }}
          </el-tag>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column>

      <el-table-column label="入场价" width="80" align="right">
        <template #default="{ row }">
          ${{ row.entryPrice?.toFixed(2) }}
        </template>
      </el-table-column>

      <el-table-column label="出场价" width="80" align="right">
        <template #default="{ row }">
          ${{ row.exitPrice?.toFixed(2) }}
        </template>
      </el-table-column>

      <el-table-column label="数量" width="80" align="right">
        <template #default="{ row }">
          {{ row.quantity }}
        </template>
      </el-table-column>

      <el-table-column label="杠杆" width="60" align="center">
        <template #default="{ row }">
          {{ row.leverage }}x
        </template>
      </el-table-column>

      <el-table-column label="盈亏" width="70" align="right">
        <template #default="{ row }">
          <span :class="row.pnl >= 0 ? 'text-success' : 'text-danger'">
            ${{ row.pnl >= 0 ? '+' : '' }}{{ row.pnl?.toFixed(2) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="盈亏%" width="80" align="right">
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

      <el-table-column label="开仓时间" width="100" align="center">
        <template #default="{ row }">
          {{ formatTime(row.openTime) }}
        </template>
      </el-table-column>

      <el-table-column label="平仓时间" width="100" align="center">
        <template #default="{ row }">
          {{ formatTime(row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column label="持仓" width="100" align="center">
        <template #default="{ row }">
          {{ formatHoldingTime(row.openTime, row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column label="原因" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            :type="getCloseCategoryType(row.closeCategory) as any"
            size="small"
          >
            {{ getCloseCategoryLabel(row.closeCategory) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div v-if="totalPages > 1" class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        :pager-count="5"
        layout="prev, pager, next, total"
        background
        small
        @current-change="handlePageChange"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { TradeHistory } from '../../types'

const orders = ref<TradeHistory[]>([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const totalPages = ref(0)
const loading = ref(false)

// 加载历史订单
const loadHistory = async () => {
  loading.value = true
  try {
    const response = await $fetch('/api/bot/history', {
      params: {
        page: currentPage.value,
        pageSize: pageSize.value,
      },
    }) as any

    if (response.success) {
      orders.value = response.data || []
      total.value = response.pagination?.total || 0
      totalPages.value = response.pagination?.totalPages || 0
    }
  } catch (error) {
    console.error('加载历史订单失败:', error)
  } finally {
    loading.value = false
  }
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
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours}小时${remainMinutes}分钟` : `${hours}小时`
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
function getCloseCategoryType(category?: string): string {
  const types: Record<string, string> = {
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
