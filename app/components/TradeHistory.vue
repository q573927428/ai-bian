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

    <!-- 订单列表 -->
    <div v-else class="history-list">
      <div v-for="order in orders" :key="order.id" class="history-item">
        <div class="order-header">
          <div class="order-left">
            <span class="symbol">{{ order.symbol }}</span>
            <el-tag
              :type="order.direction === 'LONG' ? 'success' : 'danger'"
              size="small"
              effect="dark"
            >
              {{ order.direction === 'LONG' ? '做多' : '做空' }}
            </el-tag>
            <el-tag v-if="order.strategyId" type="info" size="small" effect="plain">
              {{ order.strategyId }}
            </el-tag>
          </div>
          <div class="order-right">
            <span class="close-time">{{ formatHoldingTime(order.openTime, order.closeTime) }}</span>
          </div>
        </div>

        <div class="order-details">
          <div class="detail-row">
            <div class="detail-item">
              <span class="detail-label">入场价</span>
              <span class="detail-value">${{ order.entryPrice?.toFixed(2) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">出场价</span>
              <span class="detail-value">${{ order.exitPrice?.toFixed(2) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">数量</span>
              <span class="detail-value">{{ order.quantity }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">杠杆</span>
              <span class="detail-value">{{ order.leverage }}x</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">盈亏</span>
              <span
                :class="['detail-value', 'pnl-value', order.pnl >= 0 ? 'text-success' : 'text-danger']"
              >
                {{ order.pnl >= 0 ? '+' : '' }}{{ order.pnl?.toFixed(2) }}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">盈亏%</span>
              <span
                :class="['detail-value', 'pnl-value', order.pnlPercentage >= 0 ? 'text-success' : 'text-danger']"
              >
                {{ order.pnlPercentage >= 0 ? '+' : '' }}{{ order.pnlPercentage?.toFixed(2) }}%
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">开仓时间</span>
              <span class="detail-value">{{ formatTime(order.openTime) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">平仓时间</span>
              <span class="detail-value">{{ formatTime(order.closeTime) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">原因</span>
              <el-tag
                :type="getCloseCategoryType(order.closeCategory) as any"
                size="small"
              >
                {{ getCloseCategoryLabel(order.closeCategory) }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

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
const pageSize = ref(5)
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

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px;
  background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
  transition: all 0.3s ease;
}

.history-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.order-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.order-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.symbol {
  font-weight: 700;
  color: #1f2937;
  font-size: 15px;
}

.order-right {
  display: flex;
  align-items: center;
}

.close-time {
  font-size: 12px;
  color: #909399;
}

.order-details {
  background: #ffffff;
  border-radius: 8px;
  padding: 10px;
  border: 1px solid #e8e8e8;
}

.detail-row {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 8px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  text-align: center;
}

.detail-label {
  color: #909399;
  font-size: 11px;
  font-weight: 500;
}

.detail-value {
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}

.pnl-value {
  font-size: 15px;
}

.text-success {
  color: #10b981;
}

.text-danger {
  color: #ef4444;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

/* 手机端适配 */
@media (max-width: 768px) {
  .history-item {
    padding: 10px;
  }

  .detail-row {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .detail-value {
    font-size: 13px;
  }

  .order-left {
    flex-wrap: wrap;
  }
}
</style>
