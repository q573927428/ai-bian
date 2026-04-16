<template>
  <div v-if="positions.length > 0" class="positions-summary">
    <h3>📊 当前持仓 ({{ positions.length }})</h3>
    <div class="positions-list">
      <div v-for="pos in positions" :key="pos.id" class="position-card">
        <div class="position-header">
          <span class="symbol">{{ pos.symbol }}</span>
          <el-tag :type="pos.direction === 'long' ? 'success' : 'danger'" size="small">
            {{ pos.direction === 'long' ? '做多' : '做空' }}
          </el-tag>
        </div>
        <div class="position-info">
          <div class="info-item">
            <span class="label">入场价:</span>
            <span class="value">{{ pos.entryPrice.toFixed(2) }}</span>
          </div>
          <div class="info-item">
            <span class="label">当前价:</span>
            <span class="value">{{ pos.currentPrice?.toFixed(2) || '--' }}</span>
          </div>
          <div class="info-item">
            <span class="label">数量:</span>
            <span class="value">{{ pos.quantity }}</span>
          </div>
          <div class="info-item">
            <span class="label">杠杆:</span>
            <span class="value">{{ pos.leverage }}x</span>
          </div>
          <div class="info-item profit" :class="{ 'positive': (pos.unrealizedPnl || 0) > 0, 'negative': (pos.unrealizedPnl || 0) < 0 }">
            <span class="label">未实现盈亏:</span>
            <span class="value">{{ (pos.unrealizedPnl || 0).toFixed(2) }} USDT</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="positions-summary empty">
    <h3>📊 当前持仓</h3>
    <div class="empty-message">暂无持仓</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const positions = ref<any[]>([])
let refreshInterval: any = null

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

onMounted(() => {
  loadPositions()
  refreshInterval = setInterval(loadPositions, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style scoped>
.positions-summary {
  margin-bottom: 20px;
  padding: 20px;
  background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.positions-summary.empty {
  text-align: center;
}

.positions-summary h3 {
  margin: 0 0 16px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 18px;
}

.empty-message {
  color: rgba(255, 255, 255, 0.5);
  padding: 20px;
}

.positions-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.position-card {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.position-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.symbol {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.position-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.info-item .label {
  color: rgba(255, 255, 255, 0.6);
}

.info-item .value {
  color: #fff;
  font-weight: 500;
}

.info-item.profit.positive .value {
  color: #67c23a;
}

.info-item.profit.negative .value {
  color: #f56c6c;
}
</style>