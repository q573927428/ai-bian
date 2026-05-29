<template>
  <el-card v-if="positions.length > 0" class="positions-card">
    <template #header>
      <div class="card-header">
        <span>📊 当前持仓 ({{ positions.length }})</span>
      </div>
    </template>
    <div class="positions-list">
      <div
        v-for="position in positions"
        :key="position.symbol"
        class="position-item"
        :class="getPositionItemClass(position)"
      >
        <!-- 顶部信息栏 -->
        <div class="position-header">
          <el-row :gutter="16">
            <!-- 左侧：交易对/标签、盈亏/平仓按钮 -->
            <el-col :xs="24" :md="24">
              <div class="left-section">
                <!-- 交易对和标签 -->
                <div class="symbol-info">
                  <div class="symbol-row">
                    <span class="symbol">{{ position.symbol }}</span>
                    <span class="leverage" >{{ position.leverage }}x</span>
                    <span class="open-time">{{ formatOpenTime(position.openTime) }}</span>
                  </div>
                  <div class="tag-row">
                    <el-tag :type="position.direction === 'long' ? 'success' : 'danger'" effect="dark">
                      {{ position.direction === 'long' ? '做多' : '做空' }}
                    </el-tag>
                    <el-tag :type="position.direction === 'long' ? 'success' : 'danger'">
                      {{ position.strategyId }}
                    </el-tag>
                    <el-tag>
                      {{ position.quantity }}
                    </el-tag>
                    <el-tag
                      type="warning"
                      size="small"
                      :loading="closingSymbols.includes(position.symbol)"
                      @click="handleClosePosition(position.symbol)"
                      class="close-btn"
                    >
                      平仓
                    </el-tag>
                  </div>
                </div>
                <!-- 盈亏和平仓按钮 -->
                <div class="pnl-close-section">
                  <div class="pnl-info">
                    <div class="pnl-amount" :class="{ 'text-success': calculateUnrealizedPnl(position) > 0, 'text-danger': calculateUnrealizedPnl(position) < 0 }">
                      ${{ calculateUnrealizedPnl(position) >= 0 ? '+' : '' }}{{ calculateUnrealizedPnl(position).toFixed(2) }}
                    </div>
                    <div class="pnl-percent" :class="{ 'text-success': calculateUnrealizedPnlPercentage(position) > 0, 'text-danger': calculateUnrealizedPnlPercentage(position) < 0 }">
                      {{ calculateUnrealizedPnlPercentage(position) >= 0 ? '+' : '' }}{{ calculateUnrealizedPnlPercentage(position).toFixed(1) }}%
                    </div>
                  </div>
                </div>
              </div>
            </el-col>
            <!-- 右侧：详细信息 -->
            <el-col :xs="24" :md="24">
              <div class="info-section">
                <div class="info-row">
                  <div class="info-item">
                    <span class="info-label">入场价</span>
                    <span class="info-value">${{ formatPrice(position.entryPrice) }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">当前价</span>
                    <span class="info-value">${{ getCurrentPrice(position.symbol) > 0 ? formatPrice(getCurrentPrice(position.symbol)) : '--' }}</span>
                  </div>
                  <!-- <div class="info-item">
                    <span class="info-label">数量</span>
                    <span class="info-value">{{ position.quantity }}</span>
                  </div> -->
                  <div class="info-item">
                    <span class="info-label">TP1</span>
                    <span class="info-value">${{ position.takeProfit1 ? formatPrice(position.takeProfit1) : '--' }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">TP2</span>
                    <span class="info-value">${{ position.takeProfit2 ? formatPrice(position.takeProfit2) : '--' }}</span>
                  </div>
                  <div class="info-item" v-if="isTrailingStopLoss(position)">
                    <span class="info-label">移动</span>
                    <span class="info-value">${{ position.stopLoss ? formatPrice(position.stopLoss) : '--' }}</span>
                  </div>
                  <div class="info-item" v-else>
                    <span class="info-label">初始</span>
                    <span class="info-value">${{ position.initialStopLoss ? formatPrice(position.initialStopLoss) : '--' }}</span>
                  </div>
                  <div class="info-item">
                    <div v-if="position.reasoning" class="ai-toggle-btn-inline" @click="toggleAISection(position.symbol)">
                      <el-icon class="toggle-icon" :class="{ 'rotated': expandedAISections.includes(position.symbol) }">
                        <ElIconArrowDown />
                      </el-icon>
                    </div>
                  </div>
                </div>
              </div>
            </el-col>
          </el-row>
        </div>


        <!-- AI推理和评分 - 可折叠 -->
        <div v-if="position.reasoning" class="ai-section">
          <!-- AI 内容区域 -->
          <div v-show="expandedAISections.includes(position.symbol)" class="ai-content">
            <div class="reasoning-box">
              <div class="reasoning-label">推理逻辑</div>
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
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'
import { formatPrice } from './kline-chart/utils/kline-formatters'

const botStore = useBotStore()
const positions = ref<any[]>([])
const closingSymbols = ref<string[]>([])
const expandedAISections = ref<string[]>([])

// 加载持仓信息
const loadPositions = async () => {
  try {
    const response = await $fetch('/api/positions')
    if (response.success) {
      positions.value = response.data
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

// 判断是否为移动止损（移动止损与初始止损不同）
function isTrailingStopLoss(position: any): boolean {
  if (!position.stopLoss || !position.initialStopLoss) return false
  return position.stopLoss !== position.initialStopLoss
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

// 手动平仓
const handleClosePosition = async (symbol: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要平仓 ${symbol} 吗？`,
      '确认平仓',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    closingSymbols.value.push(symbol)

    const response = await $fetch('/api/positions/close', {
      method: 'POST',
      body: { symbol }
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
.positions-card {
  margin-bottom: 20px;
}

.card-header {
  font-size: 18px;
  font-weight: 600;
}

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
}

.symbol-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}

.symbol {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 18px;
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
}

.close-btn {
  cursor: pointer;
}

.info-section {
  border-radius: 16px;
  padding: 12px;
  background: var(--position-scores-bg);
}

.info-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
  justify-content: center;
  align-items: center;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  text-align: center;
}

.info-label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
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


.text-success {
  color: var(--color-success);
}

.text-danger {
  color: var(--color-danger);
}

.text-warning {
  color: var(--color-warning);
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

  .info-row {
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .info-value {
    font-size: 14px;
  }

  .scores-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
