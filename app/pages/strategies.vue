<!-- 策略管理页面 -->
<template>
  <div class="strategies-page">

    <!-- 策略列表 -->
    <el-card>
    <template #header>
      <div class="card-header">
        <span>⚙️ 系统配置</span>
          <div class="header-actions">
            <el-button type="primary" @click="showCreateDialog = true">
              <el-icon><ElIconPlus /></el-icon>
              创建新策略
            </el-button>
            <el-button @click="loadStrategies">
              <el-icon><ElIconRefresh /></el-icon>
              刷新
            </el-button>
            <el-button type="warning" @click="clearAICache">
              <el-icon><ElIconDelete /></el-icon>
              清理AI缓存
            </el-button>
          </div>
      </div>
    </template>

      <el-table :data="strategies" v-loading="loading" stripe>
        <el-table-column prop="name" label="策略名称" width="180" />
        <el-table-column label="交易对" width="200">
          <template #default="{ row }">
            <el-tag
              v-for="symbol in row.marketData.symbols.slice(0, 3)"
              :key="symbol"
              size="small"
              class="symbol-tag"
            >
              {{ symbol }}
            </el-tag>
            <el-tag v-if="row.marketData.symbols.length > 3" size="small">
              +{{ row.marketData.symbols.length - 3 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="周期" width="120">
          <template #default="{ row }">
            {{ row.marketData.timeframes.join(', ') }}
          </template>
        </el-table-column>
        <el-table-column label="版本" width="80">
          <template #default="{ row }">
            v{{ row.version }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row)">
              {{ getStatusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="560">
          <template #default="{ row }">
            <el-button size="small" @click="viewStrategyDetail(row)">详情</el-button>
            <el-button size="small" @click="editStrategy(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.isActive ? 'warning' : 'success'"
              @click="toggleStrategy(row)"
            >
              {{ row.isActive ? '停用' : '激活' }}
            </el-button>
            <el-button 
              size="small" 
              type="success" 
              @click="testStrategy(row)" 
              :disabled="!row.isActive"
              :loading="testingStrategies.has(row.id)"
            >
              手动分析
            </el-button>
            <el-button size="small" @click="showVersionHistory(row)">版本</el-button>
            <el-button size="small" type="danger" @click="deleteStrategy(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑策略对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingStrategy ? '编辑策略' : '创建新策略'"
      width="80%"
      :close-on-click-modal="false"
    >
      <StrategyEditor
        v-if="showCreateDialog"
        :strategy="editingStrategy"
        @save="handleSaveStrategy"
        @cancel="showCreateDialog = false"
      />
    </el-dialog>

    <!-- 版本历史对话框 -->
    <el-dialog v-model="showVersionHistoryDialog" title="版本历史" width="60%">
      <StrategyVersionHistory
        v-if="showVersionHistoryDialog && viewingStrategy"
        :strategy-id="viewingStrategy.id"
      />
    </el-dialog>

    <!-- 策略详情对话框 -->
    <el-dialog v-model="showDetailDialog" :title="`${detailStrategy?.name} 运行详情`" width="90%" :close-on-click-modal="false">
      <div v-if="detailStrategy" v-loading="detailLoading">
        <el-tabs v-model="activeDetailTab">
          <!-- 性能统计 -->
          <el-tab-pane label="性能统计" name="performance">
            <el-row :gutter="20" style="margin-bottom: 20px;">
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总交易次数</div>
                    <div class="stat-value">{{ performance.totalTrades || 0 }}</div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">胜率</div>
                    <div class="stat-value" :class="performance.winRate >= 50 ? 'text-success' : 'text-danger'">
                      {{ (performance.winRate || 0).toFixed(2) }}%
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">净利润</div>
                    <div class="stat-value" :class="performance.netProfit >= 0 ? 'text-success' : 'text-danger'">
                      ${{ (performance.netProfit || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">盈利因子</div>
                    <div class="stat-value" :class="performance.profitFactor >= 1.5 ? 'text-success' : 'text-warning'">
                      {{ (performance.profitFactor || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
            </el-row>
            <el-row :gutter="20" style="margin-bottom: 20px;">
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总盈利</div>
                    <div class="stat-value text-success">
                      ${{ (performance.totalProfit || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总亏损</div>
                    <div class="stat-value text-danger">
                      ${{ (performance.totalLoss || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大回撤</div>
                    <div class="stat-value" :class="performance.maxDrawdown <= 20 ? 'text-success' : 'text-danger'">
                      {{ (performance.maxDrawdown || 0).toFixed(2) }}%
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">平均持仓时间</div>
                    <div class="stat-value">
                      {{ (performance.averageHoldTime || 0).toFixed(1) }}分钟
                    </div>
                  </div>
                </el-card>
              </el-col>
            </el-row>
            <el-row :gutter="20">
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大连续盈利</div>
                    <div class="stat-value text-success">
                      {{ performance.maxConsecutiveWins || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大连续亏损</div>
                    <div class="stat-value text-danger">
                      {{ performance.maxConsecutiveLosses || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">当前连续盈利</div>
                    <div class="stat-value" :class="performance.consecutiveWins > 0 ? 'text-success' : 'text-secondary'">
                      {{ performance.consecutiveWins || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">当前连续亏损</div>
                    <div class="stat-value" :class="performance.consecutiveLosses > 0 ? 'text-danger' : 'text-secondary'">
                      {{ performance.consecutiveLosses || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
            </el-row>
          </el-tab-pane>

          <!-- 交易记录 -->
          <el-tab-pane label="交易记录" name="trades">
            <el-table :data="tradeRecords" stripe border>
              <el-table-column prop="symbol" label="交易对" width="120" />
              <el-table-column prop="direction" label="方向" width="80">
                <template #default="{ row }">
                  <el-tag :type="row.direction === 'long' ? 'success' : 'danger'">
                    {{ row.direction === 'long' ? '做多' : '做空' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="action" label="动作" width="80">
                <template #default="{ row }">
                  <el-tag :type="row.action === 'open' ? 'primary' : 'warning'">
                    {{ row.action === 'open' ? '开仓' : row.action === 'close' ? '平仓' : '持有' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="entryPrice" label="入场价" width="120" />
              <el-table-column prop="exitPrice" label="出场价" width="120" />
              <el-table-column prop="quantity" label="数量" width="100" />
              <el-table-column prop="leverage" label="杠杆" width="80" />
              <el-table-column prop="profitLoss" label="盈亏金额" width="120">
                <template #default="{ row }">
                  <span :class="(row.profitLoss || 0) >= 0 ? 'text-success' : 'text-danger'">
                    ${{ (row.profitLoss || 0).toFixed(2) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="profitLossPercentage" label="盈亏百分比" width="120">
                <template #default="{ row }">
                  <span :class="(row.profitLossPercentage || 0) >= 0 ? 'text-success' : 'text-danger'">
                    {{ (row.profitLossPercentage || 0).toFixed(2) }}%
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="openTime" label="开仓时间" width="180">
                <template #default="{ row }">
                  {{ formatDate(row.openTime) }}
                </template>
              </el-table-column>
              <el-table-column prop="closeTime" label="平仓时间" width="180">
                <template #default="{ row }">
                  {{ row.closeTime ? formatDate(row.closeTime) : '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'closed' ? 'success' : row.status === 'open' ? 'primary' : 'info'">
                    {{ row.status === 'closed' ? '已平仓' : row.status === 'open' ? '持仓中' : '已取消' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>

          <!-- 运行会话 -->
          <el-tab-pane label="运行历史" name="sessions">
            <el-table :data="sessions" stripe border>
              <el-table-column prop="id" label="会话ID" width="180" />
              <el-table-column prop="strategyVersion" label="版本" width="80">
                <template #default="{ row }">
                  v{{ row.strategyVersion }}
                </template>
              </el-table-column>
              <el-table-column prop="startTime" label="启动时间" width="180">
                <template #default="{ row }">
                  {{ formatDate(row.startTime) }}
                </template>
              </el-table-column>
              <el-table-column prop="endTime" label="停止时间" width="180">
                <template #default="{ row }">
                  {{ row.endTime ? formatDate(row.endTime) : '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'running' ? 'success' : row.status === 'error' ? 'danger' : 'info'">
                    {{ row.status === 'running' ? '运行中' : row.status === 'stopped' ? '已停止' : '错误' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="totalSignals" label="信号数" width="80" />
              <el-table-column prop="totalTrades" label="交易次数" width="100" />
              <el-table-column prop="sessionProfit" label="会话盈利" width="120">
                <template #default="{ row }">
                  <span :class="row.sessionProfit >= 0 ? 'text-success' : 'text-danger'">
                    ${{ row.sessionProfit.toFixed(2) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="errorMessage" label="错误信息" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Strategy } from '../../types/strategy'
import StrategyEditor from '../components/StrategyEditor.vue'
import StrategyVersionHistory from '../components/StrategyVersionHistory.vue'

const strategies = ref<Strategy[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const showVersionHistoryDialog = ref(false)
const showDetailDialog = ref(false)
const editingStrategy = ref<Strategy | null>(null)
const viewingStrategy = ref<Strategy | null>(null)
const detailStrategy = ref<Strategy | null>(null)
const testingStrategies = ref<Set<string>>(new Set())
const detailLoading = ref(false)
const activeDetailTab = ref('performance')

// 详情数据
const performance = ref<any>({})
const tradeRecords = ref<any[]>([])
const sessions = ref<any[]>([])


// 加载策略列表
const loadStrategies = async () => {
  loading.value = true
  try {
    const res = await $fetch<any>('/api/strategies')
    strategies.value = res.data || []
  } catch (error: any) {
    ElMessage.error(`加载策略失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 编辑策略
const editStrategy = (strategy: Strategy) => {
  editingStrategy.value = strategy
  showCreateDialog.value = true
}

// 保存策略
const handleSaveStrategy = async (data: any) => {
  try {
    if (editingStrategy.value) {
      await $fetch(`/api/strategies/${editingStrategy.value.id}`, {
        method: 'PUT',
        body: {
          updates: data,
          changes: '通过编辑器更新'
        }
      })
      ElMessage.success('策略已更新')
    } else {
      await $fetch('/api/strategies', {
        method: 'POST',
        body: data
      })
      ElMessage.success('策略已创建')
    }

    showCreateDialog.value = false
    editingStrategy.value = null
    await loadStrategies()
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  }
}

// 切换策略状态
const toggleStrategy = async (strategy: Strategy) => {
  try {
    await ElMessageBox.confirm(
      `确定要${strategy.isActive ? '停用' : '激活'}策略 "${strategy.name}" 吗？`,
      '确认操作',
      { type: 'warning' }
    )

    await $fetch(`/api/strategies/${strategy.id}/toggle`, {
      method: 'POST',
      body: { active: !strategy.isActive }
    })

    ElMessage.success(`策略已${strategy.isActive ? '停用' : '激活'}`)
    await loadStrategies()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`操作失败: ${error.message}`)
    }
  }
}

// 删除策略
const deleteStrategy = async (strategy: Strategy) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除策略 "${strategy.name}" 吗？此操作不可撤销。`,
      '确认删除',
      { type: 'error' }
    )

    await $fetch(`/api/strategies/${strategy.id}`, {
      method: 'DELETE'
    })

    ElMessage.success('策略已删除')
    await loadStrategies()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`删除失败: ${error.message}`)
    }
  }
}

// 显示版本历史
const showVersionHistory = (strategy: Strategy) => {
  viewingStrategy.value = strategy
  showVersionHistoryDialog.value = true
}

// 查看策略详情
const viewStrategyDetail = async (strategy: Strategy) => {
  detailStrategy.value = strategy
  showDetailDialog.value = true
  detailLoading.value = true
  activeDetailTab.value = 'performance'
  
  try {
    // 并行加载所有数据
    const [perfRes, tradesRes, sessionsRes] = await Promise.all([
      $fetch(`/api/strategies/${strategy.id}/performance`),
      $fetch(`/api/strategies/${strategy.id}/trades`),
      $fetch(`/api/strategies/${strategy.id}/sessions`)
    ])
    
    performance.value = perfRes.data || {}
    tradeRecords.value = (tradesRes.data as unknown as any[]) || []
    sessions.value = (sessionsRes.data as unknown as any[]) || []
  } catch (error: any) {
    ElMessage.error(`加载详情失败: ${error.message}`)
  } finally {
    detailLoading.value = false
  }
}

// 获取状态类型
const getStatusType = (strategy: Strategy) => {
  if (strategy.isActive) return 'success'
  return 'info'
}

// 获取状态文本
const getStatusText = (strategy: Strategy) => {
  if (strategy.isActive) return '运行中'
  return '已停止'
}

// 格式化日期
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('zh-CN')
}

// 手动测试策略
const testStrategy = async (strategy: Strategy) => {
  try {
    let symbol = strategy.marketData.symbols[0]
    
    // 如果有多个交易对，让用户选择
    if (strategy.marketData.symbols.length > 1) {
      // @ts-ignore
      const result = await ElMessageBox.prompt('请选择要测试的交易对', '手动分析', {
        inputPattern: /^[A-Z]+\/[A-Z]+$/,
        inputErrorMessage: '交易对格式不正确，例如 BTC/USDT'
      }).catch(() => null)
      
      if (!result || !result.value) return
      symbol = result.value
    }

    // 设置加载状态
    testingStrategies.value.add(strategy.id)
    
    const res = await $fetch(`/api/strategies/${strategy.id}/test`, {
      method: 'POST',
      body: { symbol }
    })

    if (res.success) {
      // @ts-ignore
      ElMessage.success(`分析完成: ${res.data.message}`)
    } else {
      // @ts-ignore
      ElMessage.error(res.error)
    }
  } catch (error: any) {
    // @ts-ignore
    ElMessage.error(`分析失败: ${error.message}`)
  } finally {
    testingStrategies.value.delete(strategy.id)
  }
}

// 清理AI缓存
const clearAICache = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清理所有AI缓存吗？清理后将重新获取最新的AI分析结果。',
      '确认清理',
      { type: 'warning' }
    )

    await $fetch('/api/ai/clear-cache', {
      method: 'POST'
    })

    ElMessage.success('AI缓存已清理完成')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`清理失败: ${error.message}`)
    }
  }
}

// 页面加载时获取数据
onMounted(() => {
  loadStrategies()
})
</script>

<style scoped>
.strategies-page {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.symbol-tag {
  margin-right: 5px;
  margin-bottom: 5px;
}

.stat-item {
  text-align: center;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
}

.text-success {
  color: #67C23A !important;
}

.text-danger {
  color: #F56C6C !important;
}

.text-warning {
  color: #E6A23C !important;
}

.text-secondary {
  color: #909399 !important;
}
</style>
