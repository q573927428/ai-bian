<template>
  <el-card class="active-positions-card" shadow="hover">
    <template #header>
      <div class="positions-card-header">
        <span>📌 当前持仓 ({{ hasActiveFilters ? `${filteredPositions.length}/${positions.length}` : positions.length }})</span>
        <el-button size="small" text :type="hasActiveFilters ? 'primary' : 'default'" :aria-expanded="showFilter" aria-controls="positions-filter" @click="showFilter = !showFilter">
          <el-icon><ElIconFilter /></el-icon>
          筛选{{ hasActiveFilters ? '（已启用）' : '' }}
        </el-button>
      </div>
    </template>

    <div v-if="showFilter" id="positions-filter" class="positions-filter">
      <label class="filter-item">
        <span>交易对</span>
        <el-select v-model="filter.symbol" placeholder="全部" size="small" clearable filterable aria-label="筛选交易对">
          <el-option v-for="symbol in availableSymbols" :key="symbol" :label="symbol" :value="symbol" />
        </el-select>
      </label>
      <label class="filter-item">
        <span>方向</span>
        <el-select v-model="filter.direction" placeholder="全部" size="small" clearable aria-label="筛选方向">
          <el-option label="做多" value="long" />
          <el-option label="做空" value="short" />
        </el-select>
      </label>
      <label class="filter-item">
        <span>策略</span>
        <el-select v-model="filter.strategyId" placeholder="全部" size="small" clearable filterable aria-label="筛选策略">
          <el-option v-for="strategy in availableStrategies" :key="strategy" :label="strategy" :value="strategy" />
        </el-select>
      </label>
      <el-button size="small" text :disabled="!hasActiveFilters" @click="resetFilters">重置</el-button>
    </div>

    <div class="positions-list">
      <div
        v-for="position in filteredPositions"
        :key="position.symbol"
        class="position-item"
        :class="getPositionItemClass(position)"
      >
        <!-- 紧凑持仓卡片：价格来自共享行情订阅，会随行情实时刷新。 -->
        <div class="position-header">
          <div class="position-topline">
            <div class="symbol-row"><button type="button" class="symbol" :title="`查看 ${position.symbol} K线`" @click="selectChartSymbol(position.symbol, position.mainTimeframe)">{{ position.symbol }}</button><span class="leverage">{{ position.leverage }}x</span><span class="open-time">{{ formatOpenTime(position.openTime) }}</span></div>
            <div class="pnl-info"><strong class="pnl-amount" :class="{ 'text-success': calculateUnrealizedPnl(position) >= 0, 'text-danger': calculateUnrealizedPnl(position) < 0 }">${{ calculateUnrealizedPnl(position) >= 0 ? '+' : '' }}{{ calculateUnrealizedPnl(position).toFixed(2) }}</strong></div>
          </div>
          <div class="tag-row"><el-tag :type="position.direction === 'long' ? 'success' : 'danger'" effect="dark">{{ position.direction === 'long' ? '做多' : '做空' }}</el-tag><el-tag effect="plain">{{ position.strategyId }}</el-tag><el-tag type="danger" size="small" :loading="closingSymbols.includes(position.symbol)" @click="requestClosePosition(position.symbol)" class="close-btn" plain>平仓</el-tag><div v-if="position.reasoning" class="ai-toggle-btn-inline" @click="toggleAISection(position.symbol)"><el-icon class="toggle-icon" :class="{ rotated: expandedAISections.includes(position.symbol) }"><ElIconArrowDown /></el-icon></div><span class="pnl-percent" :class="{ 'text-success': calculateUnrealizedPnlPercentage(position) >= 0, 'text-danger': calculateUnrealizedPnlPercentage(position) < 0 }">{{ calculateUnrealizedPnlPercentage(position) >= 0 ? '+' : '' }}{{ calculateUnrealizedPnlPercentage(position).toFixed(1) }}%</span></div>
          <div v-if="hasPriceTrack(position)" class="price-track" aria-label="持仓价格水平"><span class="track-line" /><span v-for="marker in priceMarkers(position)" :key="marker.label" :class="['price-marker', { 'marker-current': marker.label === '当前', 'marker-trailing': marker.label === '移动', 'marker-stop': marker.label === '止损' }]" :style="{ left: `${marker.position}%` }"><b v-if="marker.label !== '当前'">{{ marker.label }}</b><small>{{ marker.displayValue }}</small><i /></span></div>
        </div>


        <!-- AI推理和评分 - 可折叠 -->
        <div v-if="position.reasoning" class="ai-section">
          <!-- AI 内容区域 -->
          <div v-show="expandedAISections.includes(position.symbol)" class="ai-content">
            <div class="reasoning-box">
              <div class="reasoning-label">推理逻辑 <a v-if="position.entryAnalysisId" :href="getPositionPromptUrl(position)" target="_blank" rel="noopener noreferrer">（提示词）</a></div>
              <div class="reasoning-text">{{ position.reasoning }}</div>
            </div>
            <div class="scores-section">
              <div class="scores-label">评分详情</div>
              <div class="scores-grid">
                <div class="score-item final">
                  <span class="score-label">置信度</span>
                  <span class="score-value">{{ position.confidence ? position.confidence : '--' }}</span>
                </div>
                <div class="score-item final">
                  <span class="score-label">最终分</span>
                  <span class="score-value">{{ position.scoreBreakdown?.finalScore !== undefined ? Math.round(position.scoreBreakdown.finalScore) : '--' }}</span>
                </div>
                <div class="score-item">
                  <span class="score-label">基础分</span>
                  <span class="score-value">{{ position.scoreBreakdown?.baseScore !== undefined ? Math.round(position.scoreBreakdown.baseScore) : '--' }}</span>
                </div>
                <div class="score-item">
                  <span class="score-label">硬性分</span>
                  <span class="score-value">{{ position.scoreBreakdown?.hardScore !== undefined ? Math.round(position.scoreBreakdown.hardScore) : '--' }}</span>
                </div>
                <div class="score-item">
                  <span class="score-label">软性分</span>
                  <span class="score-value">{{ position.scoreBreakdown?.softScore !== undefined ? Math.round(position.scoreBreakdown.softScore) : '--' }}</span>
                </div>
                <div class="score-item">
                  <span class="score-label">惩罚分</span>
                  <span class="score-value">{{ position.scoreBreakdown?.penaltyScore !== undefined ? Math.round(position.scoreBreakdown.penaltyScore) : '--' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
    <el-empty v-if="positions.length === 0" description="暂无当前持仓" />
    <el-empty v-else-if="filteredPositions.length === 0" description="暂无符合筛选条件的持仓">
      <el-button size="small" @click="resetFilters">重置筛选</el-button>
    </el-empty>

    <!-- 密码只保护平仓操作，不影响持仓信息的查看。 -->
    <PasswordDialog v-model="showClosePasswordDialog" @success="handlePasswordSuccess" />
  </el-card>
</template>

<script setup lang="ts">
// ==================== 当前持仓固定面板 ====================
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'
import { formatPrice } from './kline-chart/utils/kline-formatters'
import PasswordDialog from './PasswordDialog.vue'
import { usePositionChart, useChartPositions } from '../composables/usePositionChart'

const emit = defineEmits<{
  /** 通知首页将 K 线图切换到当前持仓的交易对及主周期。 */
  selectSymbol: [symbol: string, mainTimeframe?: string]
}>()

const botStore = useBotStore()
const positions = ref<any[]>([])

/** 读取开仓时已归档的原文，跨月持仓沿用请求月份，旧根目录档案不附加月份。 */
function getPositionPromptUrl(position: { entryAnalysisId?: string; entryAnalysisMonth?: string }): string {
  const query = new URLSearchParams({ analysisId: position.entryAnalysisId ?? '', format: 'text', role: 'user' })
  if (position.entryAnalysisMonth) query.set('month', position.entryAnalysisMonth)
  return `/api/ai/trade-decision?${query}`
}

const selectedChartPosition = usePositionChart()
const chartPositions = useChartPositions()
const showFilter = ref(false)
const filter = reactive({ symbol: '', direction: '', strategyId: '' })
const hasActiveFilters = computed(() => Boolean(filter.symbol || filter.direction || filter.strategyId))
// 选项始终来自完整持仓，避免组合筛选后其他可选值消失。
const availableSymbols = computed(() => [...new Set(positions.value.map(position => position.symbol).filter(Boolean))].sort())
const availableStrategies = computed(() => [...new Set(positions.value.map(position => position.strategyId).filter(Boolean))].sort())
const filteredPositions = computed(() => positions.value.filter(position =>
  (!filter.symbol || position.symbol === filter.symbol)
  && (!filter.direction || position.direction === filter.direction)
  && (!filter.strategyId || position.strategyId === filter.strategyId)
))

/** 清空全部筛选条件，恢复展示完整持仓列表。 */
function resetFilters() {
  filter.symbol = ''
  filter.direction = ''
  filter.strategyId = ''
}

const closingSymbols = ref<string[]>([])
const expandedAISections = ref<string[]>([])
const showClosePasswordDialog = ref(false)
const pendingCloseSymbol = ref('')

/**
 * 将持仓交易对转换为 Binance symbol，并携带持仓主周期通知父组件。
 */
function selectChartSymbol(symbol: string, mainTimeframe?: string) {
  selectedChartPosition.value = positions.value.find(position => position.symbol === symbol) ?? null
  emit('selectSymbol', symbol.replace('/', '').toUpperCase(), mainTimeframe)
}

// 加载持仓信息
const loadPositions = async () => {
  try {
    const response = await $fetch('/api/positions')
    if (response.success) {
      positions.value = response.data
      chartPositions.value = response.data
      // 以最新仓位替换选中数据，移动止损和平仓结果同步反映到图表。
      if (selectedChartPosition.value) {
        selectedChartPosition.value = positions.value.find(position => position.symbol === selectedChartPosition.value?.symbol) ?? null
      }
    }
  } catch (error) {
    console.error('加载持仓信息失败:', error)
  }
}

// 获取持仓的当前价格（从 bot store 共享价格中读取）
function getCurrentPrice(symbol: string): number {
  const cleanSymbol = symbol.replace('/', '')
  return botStore.prices[cleanSymbol]?.price || 0
}

// 计算未实现盈亏
function calculateUnrealizedPnl(position: any): number {
  const currentPrice = getCurrentPrice(position.symbol)
  if (currentPrice === 0) return 0
  
  const priceDiff = position.direction === 'long' 
    ? currentPrice - position.entryPrice 
    : position.entryPrice - currentPrice
  
  return priceDiff * position.quantity
}

// 计算未实现盈亏百分比
function calculateUnrealizedPnlPercentage(position: any): number {
  const currentPrice = getCurrentPrice(position.symbol)
  if (currentPrice === 0 || position.entryPrice === 0) return 0
  
  const percentage = position.direction === 'long'
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100
  
  return percentage * (position.leverage || 1)
}

// 格式化开仓时间
function formatOpenTime(openTime: string | number | Date): string {
  if (!openTime) return '--'
  
  const date = new Date(openTime)
  if (isNaN(date.getTime())) return '--'
  
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 根据盈亏获取持仓项的类名
function getPositionItemClass(position: any): string {
  const pnl = calculateUnrealizedPnl(position)
  if (pnl > 0) {
    return 'position-profit'
  } else if (pnl < 0) {
    return 'position-loss'
  }
  return 'position-neutral'
}

function hasPriceTrack(position: any) {
  return [position.takeProfit1, position.takeProfit2, position.entryPrice, position.stopLoss || position.initialStopLoss, getCurrentPrice(position.symbol)].every(value => Number(value) > 0)
}

/** 移动止损生效后，轨道标签使用“移动”区分初始止损价。 */
function getStopLabel(position: any): string {
  return Number(position.stopLoss) > 0 && Number(position.initialStopLoss) > 0 && Number(position.stopLoss) !== Number(position.initialStopLoss)
    ? '移动'
    : '止损'
}

/**
 * 按价格从小到大排列关键价位，并根据真实价差映射到横轴。
 * 相邻价格差越大，显示距离越大；当前价变化时所有位置会重新计算。
 */
function priceMarkers(position: any) {
  const markers = [
    { label: 'TP2', value: Number(position.takeProfit2) },
    { label: 'TP1', value: Number(position.takeProfit1) },
    { label: '当前', value: Number(getCurrentPrice(position.symbol)) },
    { label: '入场', value: Number(position.entryPrice) },
    { label: getStopLabel(position), value: Number(position.stopLoss || position.initialStopLoss) }
  ].sort((left, right) => left.value - right.value)

  const min = markers[0]?.value ?? 0
  const max = markers[markers.length - 1]?.value ?? min
  const range = max - min || 1

  // 标记两端保留 10% 空间，避免标签贴近卡片边界；轴线本身继续延伸到两侧。
  return markers.map(item => ({
    ...item,
    displayValue: `$${formatPrice(item.value)}`,
    position: 15 + ((item.value - min) / range) * 70
  }))
}

// 切换 AI 折叠区域
const toggleAISection = (symbol: string) => {
  const index = expandedAISections.value.indexOf(symbol)
  if (index > -1) {
    expandedAISections.value.splice(index, 1)
  } else {
    expandedAISections.value.push(symbol)
  }
}

/**
 * 请求手动平仓；先记录目标交易对，再要求完成本次操作的密码验证。
 */
const requestClosePosition = (symbol: string) => {
  pendingCloseSymbol.value = symbol
  showClosePasswordDialog.value = true
}

/**
 * 密码验证成功后执行二次确认，并将密码交给服务端再次校验。
 */
const handlePasswordSuccess = async (password: string) => {
  const symbol = pendingCloseSymbol.value
  pendingCloseSymbol.value = ''
  if (!symbol) return

  try {
    await ElMessageBox.confirm(
      `确定要平仓 ${symbol} 吗？`,
      '确认平仓',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
        appendTo: 'body',
        modalClass: 'strategy-confirm-overlay',
      }
    )

    closingSymbols.value.push(symbol)

    const response = await $fetch('/api/positions/close', {
      method: 'POST',
      body: { symbol, password }
    } as any) as any

    if (response.success) {
      ElMessage.success(response.message)
      await loadPositions()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '平仓失败')
      console.error('平仓失败:', error)
    }
  } finally {
    const index = closingSymbols.value.indexOf(symbol)
    if (index > -1) {
      closingSymbols.value.splice(index, 1)
    }
  }
}

onMounted(() => {
  loadPositions()
  
  // 订阅共享价格更新
  botStore.subscribeToPrices('active-positions')

  // 订阅共享轮询（只用于更新持仓信息）
  botStore.subscribeToPolling('active-positions', () => {
    loadPositions()
  })
})

onUnmounted(() => {
  // 取消订阅共享价格更新
  botStore.unsubscribeFromPrices('active-positions')
  // 取消订阅轮询
  botStore.unsubscribeFromPolling('active-positions')
})
</script>

<style scoped>
.positions-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.position-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  transition: all 0.3s ease;
}

.position-item {
  padding: 14px 14px 12px;
  border-radius: 12px;
  --position-surface: #dcf8ec;
  --position-surface-muted: rgb(78 78 78 / 36%);
  background: var(--position-surface);
  border: 1px solid var(--position-border);
  box-shadow: inset 4px 0 0 #08a873;
  color: var(--position-text);
}

.position-header { display: flex; flex-direction: column; gap: 8px; }
.position-topline { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.position-item .leverage, .position-item .open-time {font-size: 12px; }
.position-item .symbol { font-size: 17px; }
.position-item .tag-row { gap: 6px; align-items: center; padding: 5px 0px; }
.position-item :deep(.el-tag) { --el-tag-font-size: 11px; --el-tag-height: 24px; }
.position-item :deep(.el-button) { margin-left: auto; }
.pnl-info { align-items: flex-end; gap: 0; }
.pnl-amount { font-size: 18px; color: #62d83d; }
.pnl-percent { font-size: 14px; font-weight: 700; }
.price-track { position: relative; height: 82px; margin-top: 1px; padding: 22px 5px; border-radius: 18px; background: var(--position-surface-muted); }
.track-line { position: absolute; z-index: 0; top: 46px; left: 2%; right: 2%; height: 2px; background: linear-gradient(90deg, rgb(80 80 80 / 55%), rgb(129 129 129 / 90%), rgb(118 118 118 / 55%)); box-shadow: 0 0 5px rgba(167, 243, 208, .28); }
.price-marker { position: absolute; z-index: 1; top: 13px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: var(--position-muted); font-size: 10px; line-height: 1.05; white-space: nowrap; }
.price-marker b { order: 0; font-weight: 600; }
.price-marker small { order: 1; margin-top: 2px; color: var(--position-text); font-size: 12px; font-weight: 600; }
.price-marker i { order: 2; width: 11px; height: 11px; margin-top: 4px; border: 0; border-radius: 50%; background: #ffffff; box-shadow: 0 0 0 2px rgba(154, 212, 183, .16); }
.price-marker.marker-current { top: 42px; color: #facc15; }
.price-marker.marker-current i {
  order: 0;
  margin: 0 0 7px;
  background: #facc15;
  box-shadow: 0 0 0 3px rgba(250, 204, 21, .18);
  animation: current-price-pulse 1.6s ease-out infinite;
}

/* 当前价圆点用阴影向外扩散，避免缩放元素造成价格标记抖动。 */
@keyframes current-price-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(250, 204, 21, .72), 0 0 8px rgba(250, 204, 21, .8);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(250, 204, 21, 0), 0 0 14px rgba(250, 204, 21, .3);
  }
  100% {
    box-shadow: 0 0 0 12px rgba(250, 204, 21, 0), 0 0 4px rgba(250, 204, 21, .12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .price-marker.marker-current i {
    animation: none;
  }
}
.price-marker.marker-current small { order: 2; }
.price-marker.marker-current small { color: #facc15; }
.price-marker.marker-stop { color: #f87171; }
.price-marker.marker-stop small { color: #f87171; }
.price-marker.marker-stop i { background: #f87171; box-shadow: 0 0 0 2px rgba(248, 113, 113, .18); }
.price-marker.marker-trailing { color: #b45309; }
.price-marker.marker-trailing small { color: #b45309; }
.price-marker.marker-trailing i { background: #fb923c; box-shadow: 0 0 0 2px rgba(251, 146, 60, .2); }

.position-profit {
  background: var(--position-profit-bg);
  border: 1px solid var(--position-profit-border);
  box-shadow: inset 5px 0 0 var(--position-profit-border);
}

.position-loss {
  background: var(--position-loss-bg);
  border: 1px solid var(--position-loss-border);
  box-shadow: inset 5px 0 0 var(--position-loss-border);
}

.position-neutral {
  background: var(--position-neutral-bg);
  border: 1px solid var(--position-neutral-border);
  box-shadow: inset 5px 0 0 var(--position-neutral-border);
}

.position-item:hover {
  box-shadow: var(--shadow-card-hover), inset 5px 0 0 var(--position-profit-border);
  transform: translateY(-2px);
}

.position-profit:hover {
  box-shadow: var(--shadow-card-hover), inset 5px 0 0 var(--position-profit-border);
}

.position-loss:hover {
  box-shadow: var(--shadow-card-hover), inset 5px 0 0 var(--position-loss-border);
}

.position-neutral:hover {
  box-shadow: var(--shadow-card-hover), inset 5px 0 0 var(--position-neutral-border);
}

.left-section {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  gap: 16px;
  padding-bottom: 15px;
}

.symbol-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.symbol-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}

.symbol {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  font-weight: 700;
  color: var(--text-primary);
  font-size: 18px;
  font-family: inherit;
  line-height: inherit;
  cursor: pointer;
}

.symbol:hover,
.symbol:focus-visible {
  color: var(--el-color-primary);
}

.symbol:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
  border-radius: 2px;
}
.leverage{
  font-size: 18px;
  color: var(--text-secondary);
  font-weight: 600;
}

.open-time {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.strategy-tag {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pnl-close-section {
  display: flex;
  align-items: center;
  gap: 16px;
}

.pnl-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pnl-amount {
  font-size: 18px;
  font-weight: 700;
}

.pnl-percent {
  font-weight: 600;
  margin-left: auto;
  white-space: nowrap;
}

.close-btn {
  margin-left: 0;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.close-btn:hover {
  color: var(--el-color-danger);
  background-color: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 2px var(--el-color-danger-light-8);
}

.ai-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ai-content {
  width: 100%;
}

.ai-toggle-btn-inline {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 8px;
  background: var(--ai-toggle-bg);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  user-select: none;
}

.ai-toggle-btn-inline:hover {
  background: var(--ai-toggle-hover);
}

.toggle-icon {
  color: var(--ai-toggle-color);
  transition: transform 0.3s ease;
  font-size: 16px;
}

.toggle-icon.rotated {
  transform: rotate(180deg);
}

.reasoning-box {
  background: var(--position-scores-bg);
  border-radius: 12px 12px 0 0;
  padding: 16px;
  border: 1px solid var(--position-reasoning-border);
  border-bottom: none;
  margin-top: 10px;
}

.reasoning-label {
  color: var(--ai-toggle-color);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.reasoning-text {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.scores-section {
  background: var(--position-scores-bg);
  border-radius: 0 0 12px 12px;
  padding: 16px;
  border: 1px solid var(--position-reasoning-border);
  border-top: 1px dashed var(--position-scores-border);
}

.scores-label {
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}

.scores-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--position-scores-bg);
  border-radius: 6px;
  border-left: 3px solid #60a5fa;
}

.score-item.final {
  border-left-color: #8b5cf6;
  background: var(--position-scores-bg-final);
}

.score-label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.score-value {
  color: var(--position-score-color);
  font-size: 16px;
  font-weight: 700;
}

.score-item.final .score-value {
  color: var(--position-score-color-final);
  font-size: 18px;
}


@media (max-width: 768px) {
  .position-item {
    padding: 12px;
  }

  .left-section {
    padding-bottom: 16px;
  }

  .symbol {
    font-size: 16px;
  }

  .pnl-amount {
    font-size: 16px;
  }

  .scores-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.active-positions-card {
  display: flex;
  flex-direction: column;
  max-height: 486px;
  min-height: 0;
  margin-bottom: 20px;
  background: var(--bg-card);
  color: var(--text-regular);
}

.active-positions-card :deep(.el-card__header) {
  flex-shrink: 0;
}

.active-positions-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.active-positions-card :deep(.el-card__body::-webkit-scrollbar) {
  display: none;
}

.active-positions-card :deep(.el-card__body::-webkit-scrollbar-thumb:hover) {
  background: var(--text-secondary);
}

.positions-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-weight: 600;
}

.positions-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.filter-item .el-select {
  width: 130px;
}
</style>
