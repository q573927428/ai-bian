<template>
  <el-card v-if="positions.length > 0" class="positions-card">
    <template #header>
      <div class="card-header">
        <span>📊 当前持仓 ({{ positions.length }})</span>
      </div>
    </template>
    <div class="positions-list">
      <el-card v-for="pos in positions" :key="pos.orderId || pos.symbol" class="position-card" shadow="hover">
        <div class="position-header">
          <span class="symbol">
            {{ pos.symbol }} 
            <el-tag type="info" size="small" effect="plain">
              {{ pos.strategyId }}
            </el-tag>
          </span>
          <div class="header-tags">
            <el-tag :type="pos.direction === 'long' ? 'success' : 'danger'" size="small">
              {{ pos.direction === 'long' ? '做多' : '做空' }}
            </el-tag>
          </div>
        </div>
        <el-divider style="margin: 12px 0;" />
        <div class="position-info">
          <div class="info-item">
            <span class="label">入场价:</span>
            <span class="value">{{ pos.entryPrice.toFixed(2) }}</span>
          </div>
          <div class="info-item">
            <span class="label">当前价:</span>
            <span class="value">{{ getCurrentPrice(pos.symbol) > 0 ? getCurrentPrice(pos.symbol).toFixed(2) : '--' }}</span>
          </div>
          <div class="info-item">
            <span class="label">数量:</span>
            <span class="value">{{ pos.quantity }}</span>
          </div>
          <div class="info-item">
            <span class="label">杠杆:</span>
            <span class="value">{{ pos.leverage }}x</span>
          </div>
          <div class="info-item profit" :class="{ 'positive': calculateUnrealizedPnl(pos) > 0, 'negative': calculateUnrealizedPnl(pos) < 0 }">
            <span class="label">盈亏U:</span>
            <span class="value">{{ calculateUnrealizedPnl(pos).toFixed(2) }} USDT</span>
          </div>
          <div class="info-item profit" :class="{ 'positive': calculateUnrealizedPnlPercentage(pos) > 0, 'negative': calculateUnrealizedPnlPercentage(pos) < 0 }">
            <span class="label">盈亏%:</span>
            <span class="value">{{ calculateUnrealizedPnlPercentage(pos).toFixed(2) }}%</span>
          </div>
          <div class="info-item">
            <span class="label">TP1止盈:</span>
            <span class="value">{{ pos.takeProfit1 ? pos.takeProfit1.toFixed(2) : '--' }}</span>
          </div>
          <div class="info-item">
            <span class="label">TP2止盈:</span>
            <span class="value">{{ pos.takeProfit2 ? pos.takeProfit2.toFixed(2) : '--' }}</span>
          </div>
          <div class="info-item" :class="{ 'trailing': isTrailingStopLoss(pos) }">
            <span class="label">{{ isTrailingStopLoss(pos) ? '移动止损' : '初始止损' }}:</span>
            <span class="value">{{ pos.stopLoss ? pos.stopLoss.toFixed(2) : '--' }}</span>
          </div>
          <div class="info-item">
            <span class="label">开仓时间:</span>
            <span class="value">{{ formatOpenTime(pos.openTime) }}</span>
          </div>
        </div>
      </el-card>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'

const botStore = useBotStore()
const positions = ref<any[]>([])

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

// 判断是否为移动止损（移动止损与初始止损不同）
function isTrailingStopLoss(position: any): boolean {
  if (!position.stopLoss || !position.initialStopLoss) return false
  return position.stopLoss !== position.initialStopLoss
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

.empty-message {
  text-align: center;
  color: #909399;
  padding: 20px;
}

.positions-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.position-card {
  transition: all 0.3s;
}

.position-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.symbol {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.position-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  line-height: 1.5;
  flex-wrap: wrap;
}

.info-item .label {
  color: #606266;
}

.info-item .value {
  color: #303133;
  font-weight: 500;
  word-break: break-all;
}

.info-item.profit.positive .value {
  color: #67c23a;
}

.info-item.profit.negative .value {
  color: #f56c6c;
}

.info-item.stop-loss.trailing .label {
  color: #e6a23c;
}

.info-item.stop-loss.trailing .value {
  color: #e6a23c;
  font-weight: 600;
}

/* 小屏幕适配 */
@media (max-width: 768px) {
  .positions-list {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .symbol {
    font-size: 16px;
  }

  .position-info {
    gap: 8px;
  }

  .info-item {
    font-size: 12px;
  }
}

</style>