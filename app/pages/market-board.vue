<template>
  <div class="market-board-container">
    <el-container>
      <!-- 头部 -->
      <el-header class="header">
        <div class="header-content">
          <h1>
            <el-icon style="vertical-align: middle; margin-right: 8px"
              ><ElIconDataAnalysis
            /></el-icon>
            币安USDT永续合约市场看板
            <span class="connection-indicator" :class="{
              connected: isPollingActive,
              disconnected: !isPollingActive
            }">
              <span class="connection-dot"></span>
              {{ isPollingActive ? '轮询更新中' : '已暂停' }}
            </span>
          </h1>
          <div class="header-actions">
            <!-- 搜索 -->
            <el-input
              v-model="searchQuery"
              placeholder="搜索交易对..."
              size="small"
              style="width: 200px"
              clearable
              @input="onSearchInput"
            >
              <template #prefix>
                <el-icon><ElIconSearch /></el-icon>
              </template>
            </el-input>

            <!-- 刷新按钮 -->
            <el-button
              type="primary"
              size="small"
              :loading="isLoading"
              @click="refreshData"
            >
              <el-icon><ElIconRefresh /></el-icon>
              刷新
            </el-button>

            <!-- 筛选按钮 -->
            <el-button
              type="default"
              size="small"
              @click="showFilterPanel = !showFilterPanel"
            >
              <el-icon><ElIconFilter /></el-icon>
              筛选
            </el-button>
          </div>
        </div>

        <!-- 筛选面板 -->
        <el-collapse-transition>
          <div v-show="showFilterPanel" class="filter-panel">
            <el-row :gutter="16">
              <!-- 涨跌幅筛选 -->
              <el-col :span="6">
                <div class="filter-group">
                  <span class="filter-label">涨跌幅</span>
                  <div class="filter-inputs">
                    <el-input-number
                      v-model="filters.priceChangeMin"
                      :placeholder="'最小'"
                      size="small"
                      :step="0.1"
                      :precision="2"
                      style="width: 100px"
                      controls-position="right"
                      clearable
                    />
                    <span class="filter-separator">~</span>
                    <el-input-number
                      v-model="filters.priceChangeMax"
                      :placeholder="'最大'"
                      size="small"
                      :step="0.1"
                      :precision="2"
                      style="width: 100px"
                      controls-position="right"
                      clearable
                    />
                  </div>
                </div>
              </el-col>

              <!-- 成交量/额筛选 -->
              <el-col :span="6">
                <div class="filter-group">
                  <span class="filter-label">成交</span>
                  <div class="filter-inputs">
                    <el-input-number
                      v-model="filters.volumeMin"
                      placeholder="成交量最小"
                      size="small"
                      style="width: 120px"
                      controls-position="right"
                      clearable
                    />
                  </div>
                </div>
              </el-col>

              <!-- 资金费率筛选 -->
              <el-col :span="6">
                <div class="filter-group">
                  <span class="filter-label">资金费率</span>
                  <div class="filter-inputs">
                    <el-input-number
                      v-model="filters.fundingRateMin"
                      placeholder="最小"
                      size="small"
                      :step="0.01"
                      :precision="4"
                      style="width: 100px"
                      controls-position="right"
                      clearable
                    />
                    <span class="filter-separator">~</span>
                    <el-input-number
                      v-model="filters.fundingRateMax"
                      placeholder="最大"
                      size="small"
                      :step="0.01"
                      :precision="4"
                      style="width: 100px"
                      controls-position="right"
                      clearable
                    />
                  </div>
                </div>
              </el-col>

              <!-- 快速筛选和操作 -->
              <el-col :span="6">
                <div class="filter-group">
                  <span class="filter-label">快速筛选</span>
                  <div class="filter-buttons">
                    <el-checkbox v-model="filters.onlyUp" size="small">仅上涨</el-checkbox>
                    <el-checkbox v-model="filters.onlyDown" size="small">仅下跌</el-checkbox>
                  </div>
                </div>
              </el-col>
            </el-row>

            <!-- 广场热度筛选 -->
            <el-row :gutter="16" style="margin-top: 12px">
              <el-col :span="12">
                <div class="filter-group">
                  <span class="filter-label">广场热度</span>
                  <div class="filter-inputs">
                    <el-slider
                      v-model="squareHeatSlider"
                      :min="0"
                      :max="100"
                      :step="5"
                      :show-tooltip="true"
                      :show-input="true"
                      input-size="small"
                      style="width: 200px"
                    />
                    <span class="filter-label" style="margin-left: 12px">≥ {{ squareHeatSlider }}%</span>
                  </div>
                </div>
              </el-col>

              <el-col :span="12">
                <div class="filter-actions">
                  <el-button size="small" @click="handleResetFilters">
                    <el-icon><ElIconRefresh /></el-icon>
                    重置
                  </el-button>
                </div>
              </el-col>
            </el-row>
          </div>
        </el-collapse-transition>
      </el-header>

      <!-- 主体 -->
      <el-main class="main">
        <!-- 顶部统计 -->
        <div class="stats-row" v-if="symbolsData.length > 0">
          <el-card class="stat-card" shadow="hover" size="small">
            <div class="stat-item">
              <span class="stat-label">交易对数量</span>
              <span class="stat-value">{{ totalSymbols }}</span>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover" size="small">
            <div class="stat-item">
              <span class="stat-label">上涨数量</span>
              <span class="stat-value text-green-500">{{ upCount }}</span>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover" size="small">
            <div class="stat-item">
              <span class="stat-label">下跌数量</span>
              <span class="stat-value text-red-500">{{ downCount }}</span>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover" size="small">
            <div class="stat-item">
              <span class="stat-label">最后更新</span>
              <span class="stat-value">{{ lastUpdateTime }}</span>
            </div>
          </el-card>
        </div>

        <!-- 错误提示 -->
        <el-alert
          v-if="error"
          type="error"
          :title="error"
          :closable="false"
          style="margin-bottom: 20px"
        />

        <!-- 加载状态 -->
        <div v-if="isLoading && symbolsData.length === 0" class="loading-container">
          <el-skeleton :rows="10" animated />
        </div>

        <!-- 表格容器 -->
        <div
          v-else-if="filteredSymbols.length > 0"
          class="table-container"
        >
           <el-table
             :data="filteredSymbols"
             style="width: 100%"
             height="700"
             row-key="symbol"
             :default-sort="{ prop: sortBy as string, order: sortOrder === 'desc' ? 'descending' : 'ascending' }"
             @sort-change="onSortChange"
             border
             stripe
              v-loading="isLoading"
            >
             <!-- 序号 -->
             <el-table-column type="index" label="序号" width="60" align="center" />
             
             <!-- 交易对 -->
            <el-table-column prop="symbol" label="交易对" width="220" sortable>
              <template #default="{ row }">
                <div class="symbol-cell">
                  <div class="symbol-with-icon">
                    <img 
                      :src="getSymbolIcon(row.baseAsset)" 
                      :alt="row.baseAsset"
                      class="symbol-icon"
                      @error="handleIconError"
                    />
                    <div class="symbol-text">
                      <span class="symbol-name">{{ row.symbol }} <span class="symbol-base text-gray-400">{{ row.baseAsset }}</span></span>
                    </div>
                  </div>
                </div>
              </template>
            </el-table-column>

            <!-- 当前价格 -->
            <el-table-column prop="currentPrice" label="当前价格" width="140" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'currentPrice')">
                  ${{ (row.currentPrice ?? 0).toFixed(
                    (row.currentPrice ?? 0) < 1 ? 6 : (row.currentPrice ?? 0) < 100 ? 4 : 2
                  ) }}
                </div>
              </template>
            </el-table-column>

            <!-- 涨跌幅 -->
            <el-table-column prop="priceChangePercent" :label="changeLabel" width="140" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'priceChangePercent')">
                  <span :class="getChangeColor(row.priceChangePercent ?? 0)">
                    {{ (row.priceChangePercent ?? 0) > 0 ? '+' : ''
                    }}{{ (row.priceChangePercent ?? 0).toFixed(2) }}%
                  </span>
                </div>
              </template>
            </el-table-column>

            <!-- 成交量 -->
            <el-table-column prop="volume" label="成交量" width="120" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'volume')">
                  {{ formatVolume(row.volume ?? 0) }}
                </div>
              </template>
            </el-table-column>

            <!-- 成交额 -->
            <el-table-column prop="quoteVolume" label="成交额" width="130" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'quoteVolume')">
                  ${{ formatVolume(row.quoteVolume ?? 0) }}
                </div>
              </template>
            </el-table-column>

            <!-- 未平仓量 -->
            <el-table-column prop="openInterest" label="未平仓量" width="120" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'openInterest')">
                  {{ formatVolume(row.openInterest ?? 0) }}
                </div>
              </template>
            </el-table-column>

            <!-- 持仓价值 -->
            <el-table-column prop="openInterestValue" label="持仓价值" width="120" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'openInterestValue')">
                  ${{ formatVolume(row.openInterestValue ?? 0) }}
                </div>
              </template>
            </el-table-column>

            <!-- 市值估算 -->
            <el-table-column prop="marketCapEstimate" label="市值估算" width="120" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'marketCapEstimate')">
                  ${{ formatVolume(row.marketCapEstimate ?? 0) }}
                </div>
              </template>
            </el-table-column>

            <!-- 资金费率 -->
            <el-table-column prop="fundingRate" label="资金费率" width="110" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'fundingRate')">
                  <span :class="(row.fundingRate ?? 0) > 0 ? 'text-green-500' : 'text-red-500'">
                    {{ (row.fundingRate ?? 0).toFixed(4) }}%
                  </span>
                </div>
              </template>
            </el-table-column>

            <!-- 广场热度 -->
            <el-table-column prop="squareHeat" label="广场热度"  width="250" sortable>
              <template #default="{ row }">
                <div :class="getCellClassName(row.symbol, 'squareHeat')">
                  <el-progress
                    :percentage="row.squareHeat ?? 0"
                    :color="getHeatColor(row.squareHeat ?? 0)"
                    :stroke-width="8"
                    :show-text="true"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 空状态 -->
        <el-empty v-else description="暂无数据" />
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useMarketBoardStore } from '../stores/marketBoard'
import type { MarketSymbolData } from '../../types/market-board'

const marketBoardStore = useMarketBoardStore()

// 状态
const searchQuery = ref('')
const tableWidth = ref(0)
const tableHeight = ref(600)
const tableContainerRef = ref<HTMLElement | null>(null)
const showFilterPanel = ref(false)
const squareHeatSlider = ref(0)
const filters = ref({
  priceChangeMin: null as number | null,
  priceChangeMax: null as number | null,
  volumeMin: null as number | null,
  quoteVolumeMin: null as number | null,
  fundingRateMin: null as number | null,
  fundingRateMax: null as number | null,
  squareHeatMin: null as number | null,
  onlyUp: false,
  onlyDown: false,
})

// 计算属性
const changeLabel = computed(() => '24h涨跌幅')

  // 从Store获取状态
  const symbolsData = computed(() => marketBoardStore.symbolsData)
  const filteredSymbols = computed(() => marketBoardStore.filteredSymbols)
  const totalSymbols = computed(() => marketBoardStore.totalSymbols)
  const isLoading = computed(() => marketBoardStore.isLoading)
  const error = computed(() => marketBoardStore.error)
  const sortBy = computed(() => marketBoardStore.sortBy)
  const sortOrder = computed(() => marketBoardStore.sortOrder)
  const isPollingActive = computed(() => marketBoardStore.isPollingActive)

// 计算统计数据
const upCount = computed(() => {
  return filteredSymbols.value.filter(
    (s) => (s.priceChangePercent ?? 0) > 0
  ).length
})

const downCount = computed(() => {
  return filteredSymbols.value.filter(
    (s) => (s.priceChangePercent ?? 0) < 0
  ).length
})

const lastUpdateTime = computed(() => {
  if (marketBoardStore.lastUpdated) {
    return new Date(marketBoardStore.lastUpdated).toLocaleTimeString()
  }
  return '-'
})

// 辅助函数
function getChangeColor(change: number) {
  if (change > 0) return 'text-green-500'
  if (change < 0) return 'text-red-500'
  return 'text-gray-500'
}

function getHeatColor(heat: number) {
  if (heat >= 70) return '#f56c6c'
  if (heat >= 40) return '#e6a23c'
  if (heat >= 20) return '#409eff'
  return '#909399'
}

function formatVolume(num: number) {
  const safeNum = num ?? 0
  if (Math.abs(safeNum) >= 1e9) return (safeNum / 1e9).toFixed(2) + 'B'
  if (Math.abs(safeNum) >= 1e6) return (safeNum / 1e6).toFixed(2) + 'M'
  if (Math.abs(safeNum) >= 1e3) return (safeNum / 1e3).toFixed(2) + 'K'
  return safeNum.toFixed(0)
}

// 事件处理
function onSearchInput(query: string) {
  marketBoardStore.setSearchQuery(query)
}

// 筛选条件变化处理
function handleFilterChange(key: string, value: any) {
  marketBoardStore.setFilter(key, value)
}

// 重置筛选
function handleResetFilters() {
  filters.value = {
    priceChangeMin: null,
    priceChangeMax: null,
    volumeMin: null,
    quoteVolumeMin: null,
    fundingRateMin: null,
    fundingRateMax: null,
    squareHeatMin: null,
    onlyUp: false,
    onlyDown: false,
  }
  squareHeatSlider.value = 0
  marketBoardStore.resetFilters()
}

// 监听筛选条件变化
watch(filters.value, (newFilters) => {
  Object.entries(newFilters).forEach(([key, value]) => {
    marketBoardStore.setFilter(key, value)
  })
}, { deep: true })

// 监听广场热度滑块
watch(squareHeatSlider, (value) => {
  marketBoardStore.setFilter('squareHeatMin', value > 0 ? value : null)
})

function onSortChange(sortInfo: any) {
  if (sortInfo.prop) {
    const order = sortInfo.order === 'descending' ? 'desc' : sortInfo.order === 'ascending' ? 'asc' : null
    marketBoardStore.setSortBy(sortInfo.prop as keyof MarketSymbolData, order)
  }
}

function refreshData() {
  marketBoardStore.fetchData()
}

// 获取单元格类名 - 用于单个字段变化闪烁
function getCellClassName(symbol: string, field: string) {
  const symbolChanges = marketBoardStore.fieldChanges[symbol]
  if (!symbolChanges) return ''
  const change = symbolChanges[field]
  if (change === 'up') return 'cell-up-flash'
  if (change === 'down') return 'cell-down-flash'
  return ''
}

// 获取交易对图标
function getSymbolIcon(baseAsset: string) {
  // 使用多个备选图标源
  const base = baseAsset.toLowerCase()
  return `https://assets.coincap.io/assets/icons/${base}@2x.png`
}

// 处理图标加载错误 - 显示美观的占位符
function handleIconError(event: Event) {
  const img = event.target as HTMLImageElement
  const placeholder = document.createElement('div')
  placeholder.className = 'symbol-icon-placeholder'
  placeholder.textContent = img.alt?.substring(0, 2).toUpperCase() || ''
  placeholder.style.width = '28px'
  placeholder.style.height = '28px'
  placeholder.style.borderRadius = '50%'
  placeholder.style.backgroundColor = getRandomColor(img.alt || '')
  placeholder.style.display = 'flex'
  placeholder.style.alignItems = 'center'
  placeholder.style.justifyContent = 'center'
  placeholder.style.color = '#fff'
  placeholder.style.fontSize = '12px'
  placeholder.style.fontWeight = 'bold'
  
  img.parentNode?.replaceChild(placeholder, img)
}

// 为币种生成稳定的随机颜色
function getRandomColor(symbol: string) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i)
    hash |= 0
  }
  const color = Math.abs(hash).toString(16).substring(0, 6).padStart(6, '0')
  return `#${color}`
}

// 调整表格大小
function resizeTable() {
  if (tableContainerRef.value) {
    tableWidth.value = tableContainerRef.value.clientWidth
    tableHeight.value = Math.max(400, window.innerHeight - 240)
  }
}

  // 生命周期
  onMounted(async () => {
    // 开始轮询 60秒
    marketBoardStore.startPolling(60000)

    // 调整表格大小
    await nextTick()
    resizeTable()
    window.addEventListener('resize', resizeTable)
  })

  onUnmounted(() => {
    marketBoardStore.stopPolling()
    window.removeEventListener('resize', resizeTable)
  })
</script>

<style scoped>
.market-board-container {
  min-height: 100vh;
  background: #f5f7fa;
}

.is-loading {
  animation: rotating 2s linear infinite;
  margin-right: 4px;
}

@keyframes rotating {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.header {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 0 20px;
  height: auto;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px 0;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  display: flex;
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.main {
  padding: 20px;
}

.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 160px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  color: #909399;
  font-size: 14px;
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.table-container {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 16px;
}

.loading-container {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
}

.symbol-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.symbol-name {
  font-weight: 600;
  font-size: 14px;
}

.symbol-base {
    font-size: 12px;
}

.symbol-with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
}

.symbol-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  background-color: #f5f7fa;
  flex-shrink: 0;
}

.symbol-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.filter-panel {
    background: #f5f7fa;
    padding: 16px 20px;
    border-top: 1px solid #e4e7ed;
}

.filter-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.filter-label {
    font-size: 12px;
    color: #606266;
    font-weight: 500;
}

.filter-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
}

.filter-separator {
    color: #909399;
    font-size: 14px;
}

.filter-buttons {
    display: flex;
    gap: 16px;
}

.filter-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    height: 100%;
}

.text-green-500 {
  color: #67c23a;
}

.text-red-500 {
  color: #f56c6c;
}

.text-gray-400 {
  color: #c0c4cc;
}

:deep(.el-input-number__clear) {
  right: 26px !important;
}

/* 单元格上涨闪烁 - 绿色渐变 */
.cell-up-flash {
  animation: cellFlashGreen 1.5s ease-out;
  border-radius: 4px;
  background-color: transparent;
}

@keyframes cellFlashGreen {
  0% {
    background-color: rgba(103, 194, 58, 0.5);
  }
  25% {
    background-color: rgba(103, 194, 58, 0.35);
  }
  50% {
    background-color: rgba(103, 194, 58, 0.2);
  }
  75% {
    background-color: rgba(103, 194, 58, 0.1);
  }
  100% {
    background-color: transparent;
  }
}

/* 单元格下跌闪烁 - 红色渐变 */
.cell-down-flash {
  animation: cellFlashRed 1.5s ease-out;
  border-radius: 4px;
  background-color: transparent;
}

@keyframes cellFlashRed {
  0% {
    background-color: rgba(245, 108, 108, 0.5);
  }
  25% {
    background-color: rgba(245, 108, 108, 0.35);
  }
  50% {
    background-color: rgba(245, 108, 108, 0.2);
  }
  75% {
    background-color: rgba(245, 108, 108, 0.1);
  }
  100% {
    background-color: transparent;
  }
}

/* 表格行悬停效果 */
:deep(.el-table__body tr:hover > td) {
  background-color: rgba(64, 158, 255, 0.08);
  transition: background-color 0.3s ease;
}

/* 统计卡片悬停效果 */
.stat-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* 连接状态指示器 */
.connection-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  transition: all 0.3s ease;
}

.connection-indicator.connected {
  background: rgba(103, 194, 58, 0.1);
  color: #67c23a;
}

.connection-indicator.disconnected {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.connection-indicator.connected .connection-dot {
  background: #67c23a;
}

.connection-indicator.disconnected .connection-dot {
  background: #f56c6c;
}

.connection-indicator.fallback .connection-dot {
  background: #e6a23c;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.1);
  }
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 16px;
  }

  .header-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .main {
    padding: 10px;
  }

  .table-container {
    padding: 8px;
  }
}
</style>