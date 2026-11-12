<template>
  <div class="performance-panel">
    <div class="panel-header">
      <span class="refresh-hint"><span class="refresh-dot" />每 1 秒自动刷新</span>
      <el-button size="small" text :loading="manualRefreshing" @click="refresh(true)">
        <el-icon><ElIconRefresh /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 运行状态 -->
    <div class="section overview-section">
      <div class="info-grid overview-grid">
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
      </div>
    </div>

    <!-- Binance API 限流状态 -->
    <div class="section">
      <div class="section-title">
        <el-icon><ElIconConnection /></el-icon>
        Binance API 限流状态
        <div v-if="rateLimitData && !botStore.rateLimitError" class="api-errors">
          <el-tag size="small" type="warning" v-if="rateLimitData.recent429 > 0">限流 429×{{ rateLimitData.recent429 }}</el-tag>
          <el-tag size="small" type="danger" v-if="rateLimitData.recent418 > 0">封禁 418×{{ rateLimitData.recent418 }}</el-tag>
          <span v-if="!rateLimitData.recent429 && !rateLimitData.recent418" class="api-normal"><span class="refresh-dot" />无限流错误</span>
        </div>
      </div>
      <div v-if="botStore.rateLimitLoading && !rateLimitData" class="loading-text">加载中...</div>
      <div v-else-if="botStore.rateLimitError" class="error-text">{{ botStore.rateLimitError }}</div>
      <div v-else-if="rateLimitData" class="rate-limit-detail">
        <div class="api-headline">
          <div class="weight-metric">
            <div class="weight-stat">
              <span class="info-label">1分钟 API 权重</span>
              <strong :class="['weight-value', weightStatus]">{{ rateLimitData.usedWeight1m || 0 }}</strong>
              <span class="weight-peak" title="服务启动以来记录的最高分钟 API 权重，跨分钟保留，服务重启后归零">峰值 {{ rateLimitData.peakUsedWeight1m ?? '-' }}</span>
            </div>
            <div class="weight-stat weight-estimate" title="根据本系统当前整分钟内发起的请求估算权重，每逢整分钟重置；接口权重估算与 Binance 返回值可能不同">
              <span class="info-label">本地估算</span>
              <strong class="estimate-value">{{ rateLimitData.localEstimatedWeight1m ?? '-' }}</strong>
              <span class="weight-peak" title="服务启动以来记录的最高分钟本地估算权重，跨分钟保留，服务重启后归零">峰值 {{ rateLimitData.peakLocalEstimatedWeight1m ?? '-' }}</span>
            </div>
            <div class="weight-stat order-metric" title="Binance 当前10秒 / 1分钟固定窗口内的订单计数，并非额度上限或成交笔数；统计缺失或跨窗口过期时显示 -">
              <span class="info-label">下单次数</span>
              <strong class="estimate-value">{{ rateLimitData.orderCount10s ?? '-' }} / {{ rateLimitData.orderCount1m ?? '-' }}</strong>
              <span class="weight-peak">10秒 / 1分钟</span>
            </div>
          </div>
        </div>
        <div class="request-pools">
          <div v-for="group in rateLimitGroups" :key="group" class="request-pool">
            <div class="request-pool-title">
              <span>{{ requestPoolLabels[group] }}</span>
              <span class="request-pool-limit">上限 {{ rateLimitData.maxConcurrency?.[group] || 0 }}</span>
            </div>
            <div class="request-pool-counts">
              <span>活跃 <b :class="{ 'text-primary': rateLimitData.active?.[group] > 0 }">{{ rateLimitData.active?.[group] || 0 }}</b></span>
              <span>队列 <b :class="{ 'text-warning': rateLimitData.queues?.[group] > 0 }">{{ rateLimitData.queues?.[group] || 0 }}</b></span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty-text">暂无数据</div>
    </div>

    <!-- 并发池状态 -->
    <div class="section">
      <div class="section-title">
        <el-icon><ElIconGrid /></el-icon>
        并发池状态
      </div>
      <div v-if="botStore.performanceLoading && !performanceData" class="loading-text">加载中...</div>
      <div v-else-if="botStore.performanceError" class="error-text">{{ botStore.performanceError }}</div>
      <table v-else-if="performanceData?.pools" class="stats-table pool-table">
        <colgroup>
          <col class="pool-name-column" />
          <col span="4" class="pool-number-column" />
        </colgroup>
        <thead>
          <tr><th>任务池</th><th>活跃</th><th>队列</th><th>累计完成</th><th>累计失败</th></tr>
        </thead>
        <tbody v-for="(pool, name) in performanceData.pools" :key="name">
          <tr class="pool-data-row">
            <td>
              <span class="pool-name">{{ taskPoolLabels[String(name)] || name }}</span>
            </td>
            <td class="live-count" :class="{ 'text-primary': pool.activeCount > 0 }">{{ pool.activeCount || 0 }}</td>
            <td class="live-count" :class="{ 'text-warning': pool.queueLength > 0 }">{{ pool.queueLength || 0 }}</td>
            <td class="live-count">{{ pool.completedTasks || 0 }}</td>
            <td class="live-count" :class="{ 'text-danger': pool.failedTasks > 0 }">{{ pool.failedTasks || 0 }}</td>
          </tr>
          <!-- 跨列展示并发占用，让用量条贯穿整个任务池数据行。 -->
          <tr class="pool-usage-row">
            <td colspan="5">
              <div class="pool-usage" :title="`并发占用：${pool.activeCount || 0} / ${pool.maxConcurrency || 1}，表示活跃任务占并发上限的比例`">
                <span class="pool-usage-label">并发占用</span>
                <div class="pool-bar">
                  <div class="pool-bar-fill" :style="{ width: poolPercent(pool) }" />
                </div>
                <span class="pool-usage-ratio">{{ pool.activeCount || 0 }} / {{ pool.maxConcurrency || 1 }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-text">暂无数据</div>
    </div>

    <!-- AI 状态 -->
    <div class="section" v-if="performanceData?.ai">
      <div class="section-title">
        <el-icon><ElIconCpu /></el-icon>
        AI 分析状态
      </div>
      <div class="ai-summary">
        <span class="ai-metric"><span class="info-label">最近1分钟请求</span><strong class="live-count">{{ performanceData.ai.recentRequestsInMinute || 0 }}</strong></span>
        <span class="ai-metric"><span class="info-label">累计</span><strong class="live-count">{{ performanceData.ai.totalRequests || 0 }}</strong><span class="info-label">次</span></span>
        <span class="ai-metric"><span class="info-label">错误</span><strong class="live-count" :class="{ 'text-danger': performanceData.ai.errorCount > 0 }">{{ performanceData.ai.errorCount || 0 }}</strong><span class="info-label">次</span></span>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBotStore } from '../stores/bot'

const botStore = useBotStore()
const refreshing = ref(false)
const manualRefreshing = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const rateLimitData = computed(() => botStore.rateLimit)
const performanceData = computed(() => botStore.performance)

const rateLimitGroups = ['marketData', 'account', 'trade']
const requestPoolLabels: Record<string, string> = { marketData: '行情数据', account: '账户查询', trade: '交易请求' }
const taskPoolLabels: Record<string, string> = { indicator: '指标计算', ai: 'AI 分析', tradeApi: '交易 API' }

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

/** 将当前活跃任务换算为并发容量占比，用于任务池用量条。 */
function poolPercent(pool: any): string {
  const limit = pool.maxConcurrency || 1
  const active = pool.activeCount || 0
  return Math.min((active / limit) * 100, 100) + '%'
}

/** 同步面板快照；慢请求期间跳过轮询，避免旧响应覆盖新数据。 */
async function refresh(manual = false) {
  // Store 的加载状态也覆盖关闭后立即重开的场景，避免重复请求。
  if (refreshing.value || botStore.rateLimitLoading || botStore.performanceLoading) return
  refreshing.value = true
  // 自动轮询保持按钮静止，仅手动刷新显示加载反馈。
  manualRefreshing.value = manual
  try {
    await Promise.all([
      botStore.fetchRateLimit(),
      botStore.fetchPerformance()
    ])
  } finally {
    refreshing.value = false
    manualRefreshing.value = false
  }
}

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(() => { void refresh() }, 1000)
})

onUnmounted(() => {
  // 父级在关闭弹窗时立即卸载面板，停止后续轮询。
  if (refreshTimer !== undefined) clearInterval(refreshTimer)
})

</script>

<style scoped>
.performance-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px 4px;
  font-variant-numeric: tabular-nums;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.refresh-hint {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
}

.refresh-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.section {
  padding: 12px 14px;
  border: 1px solid var(--stat-card-border);
  border-radius: 12px;
  background: var(--bg-card);
  min-width: 0;
}

.overview-section {
  background: var(--bg-main);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

/* 指标共享一组底色，用分隔线组织信息，减少重复卡片的视觉噪声。 */
.info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
}

.overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.info-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2px 10px;
  gap: 4px;
}

.info-item + .info-item {
  border-left: 1px solid var(--stat-card-border);
}

.info-label {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.info-value-v {
  font-size: 18px;
  line-height: 1.25;
  font-weight: 600;
  color: var(--text-primary);
}

.info-value-v .el-tag {
  font-size: 11px;
}

.api-headline, .weight-metric, .api-errors, .ai-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.api-headline { justify-content: space-between; }
.weight-value { font-size: 28px; line-height: 1.15; font-weight: 600; }
/* 三列共享标题、数值和辅助信息的行高，避免峰值令下单次数和分隔线错位。 */
.weight-metric { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; width: 100%; }
.weight-stat { min-width: 0; display: flex; flex-direction: column; align-self: stretch; gap: 6px; padding: 2px 16px; }
.weight-stat:first-child { padding-left: 0; }
.weight-peak { font-size: 11px; line-height: 1.5; color: var(--text-secondary); }
.weight-estimate, .order-metric { border-left: 1px solid var(--stat-card-border); }
.api-errors { margin-left: auto; font-weight: 400; }
.estimate-value { font-size: 28px; line-height: 1.15; font-weight: 500; color: var(--text-regular); }
.api-normal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--bg-main);
  font-size: 11px;
  color: var(--text-secondary);
}
.ai-summary { justify-content: space-between; }
.ai-metric { display: inline-flex; align-items: baseline; gap: 8px; color: var(--text-primary); }
.live-count, .request-pool-counts b { font-size: 20px; font-weight: 600; }
.stats-table td.live-count { color: var(--text-primary); }
.text-primary { color: var(--color-primary) !important; }

/* 配置和总体状态保持紧凑，将视觉空间让给实时用量。 */
.overview-grid .info-item { flex-direction: row; justify-content: center; flex-wrap: wrap; gap: 4px 8px; }
.overview-grid .info-value-v { font-size: 13px; }

.request-pool-counts b {
  line-height: 1.15;
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
  margin-top: 10px;
  font-size: 12px;
  table-layout: fixed;
}

.stats-table th {
  background: var(--bg-main);
  color: var(--text-secondary);
  padding: 7px 8px;
  text-align: right;
  font-weight: 500;
}

.stats-table td {
  padding: 8px;
  text-align: right;
  color: var(--text-regular);
  border-bottom: 1px solid var(--stat-card-border);
}

.stats-table th:first-child,
.stats-table td:first-child {
  text-align: left;
}

.stats-table tbody tr:last-child td {
  border-bottom: 0;
}

.stats-table td.text-primary {
  color: var(--color-primary);
}

.pool-table {
  margin-top: 0;
}

/* 列宽统一由 colgroup 控制，避免名称列挤占数值列或影响跨列占用条。 */
.pool-name-column { width: 20%; }
.pool-number-column { width: 20%; }
.pool-table th:not(:first-child),
.pool-table .pool-data-row td:not(:first-child) {
  text-align: center;
}

.pool-table .pool-data-row td {
  border-bottom: 0;
  padding-bottom: 5px;
}

.pool-table .pool-usage-row td {
  padding-top: 3px;
  padding-bottom: 10px;
}

/* 请求池作为次要状态横向展示，避免三行表格撑高弹窗。 */
.request-pools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--stat-card-border);
}

.request-pool {
  min-width: 0;
  padding: 2px 16px;
}
.request-pool + .request-pool {
  border-left: 1px solid var(--stat-card-border);
}
.request-pool-title, .request-pool-counts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 10px;
  font-size: 11px;
}
.request-pool-title { color: var(--text-regular); }
.request-pool-limit, .request-pool-counts { color: var(--text-secondary); }
.request-pool-limit { font-size: 10px; }
.request-pool-counts { margin-top: 8px; }
.request-pool-counts > span { display: inline-flex; align-items: baseline; gap: 6px; }
.request-pool-counts b { color: var(--text-primary); font-weight: 600; }

.pool-name {
  font-weight: 500;
  color: var(--text-primary);
}

/* 用标签、胶囊轨道和容量数字表达用量，避免通栏横线被误认为表格边框。 */
.pool-usage {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pool-usage-label, .pool-usage-ratio {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.pool-usage-ratio { min-width: 5ch; text-align: right; }

.pool-bar {
  flex: 1;
  min-width: 0;
  height: 8px;
  background: color-mix(in srgb, var(--color-primary) 16%, var(--bg-main));
  border-radius: 999px;
  overflow: hidden;
}

.pool-bar-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.section-title > .el-icon {
  color: var(--color-primary);
}

/* 手机端保持列对齐，同时给较长的指标名称留出换行空间。 */
@media (max-width: 480px) {
  .section { padding: 10px; }
  .info-item { padding: 2px 5px; }
  .info-value-v { font-size: 18px; }
  .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 10px; }
  .overview-grid .info-item:nth-child(3) { border-left: 0; }
  .stats-table th, .stats-table td { padding: 7px 4px; }
  .request-pool { padding: 2px 8px; }
  .weight-stat { padding: 2px 10px; }
  .weight-value, .estimate-value { font-size: 24px; }
  .section-title { flex-wrap: wrap; }
}
</style>
