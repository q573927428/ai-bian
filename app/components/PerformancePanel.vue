<template>
  <div class="performance-panel">
    <div class="panel-header">
      <h3>📊 运行状态</h3>
      <el-button size="small" text @click="refresh">
        <el-icon><ElIconRefresh /></el-icon>
        刷新
      </el-button>
    </div>

    <el-divider style="margin: 8px 0" />

    <!-- 运行状态 -->
    <div class="section">
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">运行状态</span>
          <el-tag :type="botStore.state?.isRunning ? 'success' : 'danger'" size="small">
            {{ botStore.state?.isRunning ? '运行中' : '已停止' }}
          </el-tag>
        </div>
        <div class="info-item">
          <span class="info-label">策略总数</span>
          <span class="info-value-v">{{ botStore.state?.totalStrategies || 0 }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">激活策略</span>
          <span class="info-value-v">{{ botStore.state?.activeStrategies || 0 }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">当前持仓</span>
          <span class="info-value-v">{{ botStore.state?.currentPositions || 0 }}</span>
        </div>
        <!-- <div class="info-item" v-if="performanceData?.positions">
          <span class="info-label">多仓</span>
          <span class="info-value-v" style="color: var(--color-success);">{{ performanceData.positions.longPositions || 0 }}</span>
        </div>
        <div class="info-item" v-if="performanceData?.positions">
          <span class="info-label">空仓</span>
          <span class="info-value-v" style="color: var(--color-danger);">{{ performanceData.positions.shortPositions || 0 }}</span>
        </div> -->
      </div>
    </div>

    <!-- Binance API 限流状态 -->
    <div class="section">
      <div class="section-title">
        <el-icon><ElIconConnection /></el-icon>
        Binance API 限流状态
      </div>
      <div v-if="botStore.rateLimitLoading" class="loading-text">加载中...</div>
      <div v-else-if="botStore.rateLimitError" class="error-text">{{ botStore.rateLimitError }}</div>
      <div v-else-if="rateLimitData" class="rate-limit-detail">
        <div class="info-grid rate-limit-grid">
          <div class="info-item">
            <span class="info-label">1分钟权重</span>
            <span :class="['info-value-v', weightStatus]">
              {{ rateLimitData.usedWeight1m || 0 }}
              <span v-if="rateLimitData.localEstimatedWeight1m" class="weight-est">(本地估 {{ rateLimitData.localEstimatedWeight1m }})</span>
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">订单计数(10s/1m)</span>
            <span class="info-value-v">{{ rateLimitData.orderCount10s ?? '-' }} / {{ rateLimitData.orderCount1m ?? '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">错误统计</span>
            <div class="info-value-v">
              <el-tag size="small" type="warning" v-if="rateLimitData.recent429 > 0">429×{{ rateLimitData.recent429 }}</el-tag>
              <el-tag size="small" type="danger" v-if="rateLimitData.recent418 > 0">418×{{ rateLimitData.recent418 }}</el-tag>
              <span v-if="!rateLimitData.recent429 && !rateLimitData.recent418" style="font-weight: 400;">无</span>
            </div>
          </div>
        </div>
        <table class="stats-table">
          <thead>
            <tr>
              <th>请求池</th>
              <th>活跃</th>
              <th>队列</th>
              <th>最大并发</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in rateLimitGroups" :key="group">
              <td>{{ group }}</td>
              <td>{{ (rateLimitData.active || {})[group] || 0 }}</td>
              <td>{{ (rateLimitData.queues || {})[group] || 0 }}</td>
              <td>{{ (rateLimitData.maxConcurrency || {})[group] || 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-text">暂无数据</div>
    </div>

    <!-- 并发池状态 -->
    <div class="section">
      <div class="section-title">
        <el-icon><ElIconGrid /></el-icon>
        并发池状态
      </div>
      <div v-if="botStore.performanceLoading" class="loading-text">加载中...</div>
      <div v-else-if="botStore.performanceError" class="error-text">{{ botStore.performanceError }}</div>
      <div v-else-if="performanceData?.pools" class="pool-grid">
        <div v-for="(pool, name) in performanceData.pools" :key="name" class="pool-card">
          <div class="pool-name">{{ name }}</div>
          <div class="pool-stats">
            <span class="pool-stat">活跃: <b>{{ pool.activeCount || 0 }}</b></span>
            <span class="pool-stat">队列: <b>{{ pool.queueLength || 0 }}</b></span>
            <span class="pool-stat">完成: <b>{{ pool.completedTasks || 0 }}</b></span>
            <span class="pool-stat">失败: <b>{{ pool.failedTasks || 0 }}</b></span>
          </div>
          <div class="pool-bar">
            <div class="pool-bar-fill" :style="{ width: poolPercent(pool) }" />
          </div>
        </div>
      </div>
      <div v-else class="empty-text">暂无数据</div>
    </div>

    <!-- AI 状态 -->
    <div class="section" v-if="performanceData?.ai">
      <div class="section-title">
        <el-icon><ElIconCpu /></el-icon>
        AI 分析状态
      </div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">总请求数</span>
          <span class="info-value-v">{{ performanceData.ai.totalRequests || 0 }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">最近1分钟请求</span>
          <span class="info-value-v">{{ performanceData.ai.recentRequestsInMinute || 0 }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">错误次数</span>
          <span class="info-value-v">{{ performanceData.ai.errorCount || 0 }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'

const botStore = useBotStore()

const rateLimitData = computed(() => botStore.rateLimit)
const performanceData = computed(() => botStore.performance)

const rateLimitGroups = ['marketData', 'account', 'trade']

const weightStatus = computed(() => {
  if (!rateLimitData.value) return ''
  const used = rateLimitData.value.usedWeight1m
  if (!used) return ''
  // Binance USD-M Futures 权重上限通常为 2400
  const LIMIT = 2400
  const ratio = used / LIMIT
  if (ratio > 0.8) return 'text-danger'
  if (ratio > 0.5) return 'text-warning'
  return 'text-success'
})

function poolPercent(pool: any): string {
  const limit = pool.maxConcurrency || 1
  const active = pool.activeCount || 0
  return Math.min((active / limit) * 100, 100) + '%'
}

async function refresh() {
  await Promise.all([
    botStore.fetchRateLimit(),
    botStore.fetchPerformance()
  ])
}

onMounted(() => {
  refresh()
})

</script>

<style scoped>
.performance-panel {
  padding: 4px 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.section {
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

/* 上下布局信息卡片 */
.info-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.info-item {
  flex: 1;
  min-width: 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 6px 4px;
  background: var(--bg-main);
  border-radius: 6px;
}

.info-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  white-space: nowrap;
}

.info-value-v {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.info-value-v .el-tag {
  font-size: 11px;
}

.weight-est {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-placeholder);
  margin-top: 2px;
}

.text-success {
  color: var(--color-success);
}

.text-warning {
  color: var(--color-warning);
}

.text-danger {
  color: var(--color-danger);
}

.loading-text {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 8px 0;
}

.error-text {
  color: var(--color-danger);
  font-size: 13px;
  padding: 8px 0;
}

.empty-text {
  color: var(--text-placeholder);
  font-size: 13px;
  padding: 8px 0;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 12px;
}

.stats-table th {
  background: var(--bg-main);
  color: var(--text-secondary);
  padding: 4px 8px;
  text-align: left;
  font-weight: 500;
}

.stats-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--stat-card-border);
}

.pool-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pool-card {
  padding: 8px;
  background: var(--bg-main);
  border-radius: 6px;
}

.pool-name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  text-transform: capitalize;
}

.pool-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}

.pool-stat {
  color: var(--text-secondary);
}

.pool-stat b {
  color: var(--text-primary);
}

.pool-bar {
  height: 4px;
  background: var(--stat-card-border);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}

.pool-bar-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.scan-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>