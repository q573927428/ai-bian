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
            style="width: 110px"
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
      ref="tableRef"
      v-else
      :data="orders"
      stripe
      border
      size="small"
      style="width: 100%"
      :header-cell-style="{ background: 'var(--table-header-bg)', color: 'var(--table-header-color)', fontWeight: 600 }"
      @sort-change="handleSortChange"
      :row-key="(row: any) => row.id"
    >
      <!-- 展开行 -->
      <el-table-column type="expand" width="1">
        <template #default="{ row }">
          <div class="expand-detail">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">入场置信度</span>
                <span class="detail-value">{{ row.entryConfidence ?? '--' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">入场评分</span>
                <span class="detail-value">{{ row.entryScore ?? '--' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">风险等级</span>
                <span class="detail-value">
                  <el-tag
                    :type="getRiskLevelType(row.entryRiskLevel)"
                    size="small"
                  >
                    {{ row.entryRiskLevel ?? '--' }}
                  </el-tag>
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止损价</span>
                <span class="detail-value">${{ formatPrice(row.stopLossPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止盈1价</span>
                <span class="detail-value">${{ formatPrice(row.takeProfit1Price) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止盈2价</span>
                <span class="detail-value">${{ formatPrice(row.takeProfit2Price) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最高价</span>
                <span class="detail-value">${{ formatPrice(row.highestPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最低价</span>
                <span class="detail-value">${{ formatPrice(row.lowestPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮盈</span>
                <span class="detail-value text-success">${{ formatPrice(row.maxFloatingProfit) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮亏</span>
                <span class="detail-value text-danger">${{ formatPrice(row.maxFloatingLoss) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮盈%</span>
                <span class="detail-value text-success">{{ formatPrice(row.maxFloatingProfitPercent) }}%</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮亏%</span>
                <span class="detail-value text-danger">{{ formatPrice(row.maxFloatingLossPercent) }}%</span>
              </div>
            </div>
            <div v-if="row.entryIndicators" class="detail-section">
              <span class="detail-label">入场指标</span>
              <div class="indicators-tags">
                <el-tag
                  v-for="(val, key) in row.entryIndicators"
                  :key="key"
                  size="small"
                  effect="plain"
                >
                  {{ key }}: {{ formatIndicatorValue(String(key), val) }}
                </el-tag>
              </div>
            </div>
            <div v-if="row.aiReasoning" class="detail-section">
              <span class="detail-label">AI 推理</span>
              <span class="detail-value reason-text">平仓原因：{{ row.reason }}； {{ row.aiReasoning }}</span>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="交易对" width="116" fixed>
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

      <el-table-column label="策略" min-width="100">
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
          ${{ formatPrice(row.entryPrice) }}
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
          ${{ formatPrice(row.exitPrice) }}
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

      <el-table-column label="评分" width="65" align="center" prop="entryScore" sortable="custom">
        <template #default="{ row }">
          {{ row.entryScore != null ? row.entryScore : '--' }}
        </template>
      </el-table-column>

      <el-table-column label="置信度" width="80" align="center" prop="entryConfidence" sortable="custom">
        <template #default="{ row }">
          {{ row.entryConfidence != null ? row.entryConfidence : '--' }}
        </template>
      </el-table-column>

      <!-- <el-table-column label="风险" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            v-if="row.entryRiskLevel"
            :type="row.entryRiskLevel === 'LOW' ? 'success' : row.entryRiskLevel === 'HIGH' ? 'danger' : 'warning'"
            size="small"
            effect="dark"
          >
            {{ row.entryRiskLevel }}
          </el-tag>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column> -->

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
            class="close-category-tag"
            @click="toggleExpand(row as TradeHistory)"
          >
            <span class="tag-text">{{ getCloseCategoryLabel(row.closeCategory) }}</span>
            <el-icon class="tag-icon">
              <ElIconArrowRight />
            </el-icon>
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

// 表格实例引用
const tableRef = ref<any>(null)

// 切换展开/折叠（使用 el-table 的 toggleRowExpansion）
const toggleExpand = (row: TradeHistory) => {
  if (tableRef.value) {
    tableRef.value.toggleRowExpansion(row)
  }
}

// 获取风险等级类型
function getRiskLevelType(level?: string): 'success' | 'warning' | 'danger' | 'info' {
  const types: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    LOW: 'success',
    MEDIUM: 'warning',
    HIGH: 'danger',
  }
  return level ? types[level] || 'info' : 'info'
}

// 格式化价格（根据价格大小动态小数位）
function formatPrice(value: number | undefined | null): string {
  if (value == null || isNaN(value) || !isFinite(value)) return '--'
  if (value === 0) return '0'

  const absVal = Math.abs(value)
  let maxFractionDigits = 2

  if (absVal < 0.001) {
    maxFractionDigits = 6
  } else if (absVal < 0.01) {
    maxFractionDigits = 5
  } else if (absVal < 0.1) {
    maxFractionDigits = 4
  } else if (absVal < 1) {
    maxFractionDigits = 3
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  })
}

// 入场指标中以 Percent 结尾的字段本身已经是百分数值，需要补充百分号避免与普通数值混淆。
function formatIndicatorValue(key: string, value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '--')
  const formatted = formatPrice(value)
  return key.endsWith('Percent') ? `${formatted}%` : formatted
}

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
const handleSortChange = (data: { prop: string | null; order: 'ascending' | 'descending' | null }) => {
  if (data.prop && data.order) {
    tradeHistoryStore.setSort(data.prop as any)
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
    trailing_stop: '止损',
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
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}

:deep(.el-table__expand-icon) {
  display: none !important;
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
  color: var(--text-regular);
  white-space: nowrap;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: var(--text-secondary);
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
  color: var(--text-placeholder);
}

.symbol {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 13px;
}

.text-success {
  color: var(--color-success);
  font-weight: 600;
}

.text-warning {
  color: var(--color-warning);
  font-weight: 600;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}

.text-info {
  color: var(--color-info);
  font-weight: 600;
}

.text-muted {
  color: var(--text-placeholder);
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.expand-detail {
  background: var(--bg-expand);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 16px;
  margin: 10px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-value {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.detail-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.indicators-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reason-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-regular);
  word-break: break-all;
}

/* 平仓原因标签 - 文字和图标同行 */
.close-category-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}

.close-category-tag .tag-text {
  line-height: 1;
}

.close-category-tag .tag-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 1px;
}
</style>
