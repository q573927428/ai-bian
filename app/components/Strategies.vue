<!-- 策略管理页面 -->
<template>
  <div class="strategies-page">

    <!-- 策略列表 -->
    <el-card>
    <template #header>
      <div class="card-header">
        <span>⚙️ 系统配置</span>
          <div class="header-actions">
            <el-button size="small" text type="primary" @click="createStrategy">
              <el-icon><ElIconPlus /></el-icon>
              创建
            </el-button>
            <el-button size="small" text @click="loadStrategies">
              <el-icon><ElIconRefresh /></el-icon>
              刷新
            </el-button>
            <el-button size="small" text type="warning" @click="clearAICache">
              <el-icon><ElIconDelete /></el-icon>
              清理
            </el-button>
          </div>
      </div>
    </template>

      <el-table :data="strategies" v-loading="loading" stripe>
        <el-table-column prop="name" label="策略" width="90" />
        <el-table-column label="交易对" width="230" >
          <template #default="{ row }">
            <el-tag
              v-for="symbol in row.marketData.symbols.slice(0, 2)"
              :key="symbol"
              size="small"
              class="symbol-tag"
            >
              {{ symbol }}
            </el-tag>
            <el-tag v-if="row.marketData.symbols.length > 2" size="small" class="symbol-tag">
              +{{ row.marketData.symbols.length - 2 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="K线周期" width="120">
          <template #default="{ row }">
            {{ row.marketData.timeframes.join(', ') }}
          </template>
        </el-table-column>
        <el-table-column label="EMA周期" width="110">
          <template #default="{ row }">
            {{ getEmaPeriods(row as Strategy) }}
          </template>
        </el-table-column>
        <el-table-column label="版本" width="60">
          <template #default="{ row }">
            v{{ row.version }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row as Strategy)">
              {{ getStatusText(row as Strategy) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="330">
          <template #default="{ row }">
            <el-button size="small" @click="viewStrategyDetail(row as Strategy)">详情</el-button>
            <el-button size="small" @click="editStrategy(row as Strategy)">编辑</el-button>
            <el-button
              size="small"
              :type="row.isActive ? 'warning' : 'success'"
              @click="toggleStrategy(row as Strategy)"
            >
              {{ row.isActive ? '停用' : '激活' }}
            </el-button>
            <!-- <el-button 
              size="small" 
              type="success" 
              @click="testStrategy(row)" 
              :disabled="!row.isActive"
              :loading="testingStrategies.has(row.id)"
            >
              分析
            </el-button> -->
            <el-button 
              size="small" 
              type="primary" 
              @click="openForcePosition(row as Strategy)" 
              :disabled="!row.isActive"
              :loading="forcingStrategies.has(row.id)"
            >
              开仓
            </el-button>
            <!-- <el-button size="small" @click="showVersionHistory(row)">版本</el-button> -->
            <el-button size="small" type="danger" @click="deleteStrategy(row as Strategy)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑策略对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingStrategy ? '编辑策略' : '创建新策略'"
      width="80%"
      class="strategy-dialog"
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
    <el-dialog v-model="showVersionHistoryDialog" title="版本历史" width="60%" append-to-body>
      <StrategyVersionHistory
        v-if="showVersionHistoryDialog && viewingStrategy"
        :strategy-id="viewingStrategy.id"
      />
    </el-dialog>

    <!-- 保存确认对话框 -->
    <el-dialog v-model="showSaveConfirmDialog" title="保存策略" width="500px">
      <div style="margin-bottom: 20px;">请选择保存方式：</div>
      <el-checkbox v-model="saveAsNewVersion" style="margin-bottom: 15px;">保存为新版本</el-checkbox>
      <el-input
        v-if="saveAsNewVersion"
        v-model="versionChanges"
        type="textarea"
        :rows="3"
        placeholder="请输入版本变更说明"
      />
      <template #footer>
        <el-button @click="showSaveConfirmDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmSaveStrategy" :disabled="saveAsNewVersion && !versionChanges.trim()">
          确认保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 密码验证对话框 -->
    <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />

    <!-- 强制开仓弹窗 -->
    <el-dialog v-model="showForceOpenDialog" title="强制开仓" width="420px" :close-on-click-modal="false">
      <div v-if="forceOpenStrategy">
        <div style="margin-bottom: 16px;">
          <div style="margin-bottom: 6px; font-weight: 500;">策略：{{ forceOpenStrategy.name }}</div>
          <div style="margin-bottom: 16px;">
            <div style="margin-bottom: 6px;">选择交易对</div>
            <el-select v-model="forceOpenSymbol" placeholder="请选择交易对" style="width: 100%;">
              <el-option
                v-for="sym in availableSymbols"
                :key="sym"
                :label="sym"
                :value="sym"
              />
            </el-select>
          </div>
          <div>
            <div style="margin-bottom: 6px;">选择方向</div>
            <el-radio-group v-model="forceOpenDirection">
              <el-radio-button value="long">做多 LONG</el-radio-button>
              <el-radio-button value="short">做空 SHORT</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <div style="color: #909399; font-size: 13px; margin-top: 8px;">
          将以置信度100%、finalScore100触发策略开仓。
        </div>
      </div>
      <template #footer>
        <el-button @click="showForceOpenDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmForceOpen" :disabled="!forceOpenSymbol">
          确认开仓
        </el-button>
      </template>
    </el-dialog>

    <!-- 策略详情对话框 -->
    <el-dialog v-model="showDetailDialog" :title="`${detailStrategy?.name} 运行详情`" width="80%" :close-on-click-modal="false">
      <div v-if="detailStrategy" v-loading="detailLoading">
            <el-row :gutter="20" style="margin-bottom: 20px;">
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总交易次数</div>
                    <div class="stat-value">{{ performance.totalTrades || 0 }}</div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">胜率</div>
                    <div class="stat-value" :class="performance.winRate >= 50 ? 'text-success' : 'text-danger'">
                      {{ (performance.winRate || 0).toFixed(2) }}%
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">净利润</div>
                    <div class="stat-value" :class="performance.netProfit >= 0 ? 'text-success' : 'text-danger'">
                      ${{ (performance.netProfit || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
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
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总盈利</div>
                    <div class="stat-value text-success">
                      ${{ (performance.totalProfit || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">总亏损</div>
                    <div class="stat-value text-danger">
                      ${{ (performance.totalLoss || 0).toFixed(2) }}
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大回撤</div>
                    <div class="stat-value" :class="performance.maxDrawdown <= 20 ? 'text-success' : 'text-danger'">
                      {{ (performance.maxDrawdown || 0).toFixed(2) }}%
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
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
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大连续盈利</div>
                    <div class="stat-value text-success">
                      {{ performance.maxConsecutiveWins || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">最大连续亏损</div>
                    <div class="stat-value text-danger">
                      {{ performance.maxConsecutiveLosses || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">当前连续盈利</div>
                    <div class="stat-value" :class="performance.consecutiveWins > 0 ? 'text-success' : 'text-secondary'">
                      {{ performance.consecutiveWins || 0 }}次
                    </div>
                  </div>
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
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
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { Strategy } from '../../types/strategy'
import StrategyEditor from '../components/StrategyEditor.vue'
import StrategyVersionHistory from '../components/StrategyVersionHistory.vue'
import PasswordDialog from '../components/PasswordDialog.vue'
import { useBotStore } from '../stores/bot'

const strategies = ref<Strategy[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const showVersionHistoryDialog = ref(false)
const showDetailDialog = ref(false)
const showSaveConfirmDialog = ref(false)
const editingStrategy = ref<Strategy | null>(null)
const viewingStrategy = ref<Strategy | null>(null)
const detailStrategy = ref<Strategy | null>(null)
const testingStrategies = ref<Set<string>>(new Set())
const forcingStrategies = ref<Set<string>>(new Set())
const detailLoading = ref(false)
// 保存确认对话框相关
const saveAsNewVersion = ref(false)
const versionChanges = ref('')
const pendingSaveData = ref<any>(null)

// 密码验证相关
const showPasswordDialog = ref(false)
const pendingAction = ref<{ type: string; data?: any } | null>(null)

// 强制开仓弹窗
const showForceOpenDialog = ref(false)
const forceOpenStrategy = ref<Strategy | null>(null)
const forceOpenSymbol = ref('')
const forceOpenDirection = ref<'long' | 'short'>('long')

// bot store（获取交易对列表）
const botStore = useBotStore()
const availableSymbols = computed(() => botStore.botConfig?.symbols || [])

// 详情数据
const performance = ref<any>({})
// 密码验证成功回调
const handlePasswordSuccess = () => {
  if (!pendingAction.value) return
  
  const { type, data } = pendingAction.value
  
  switch (type) {
    case 'create':
      showCreateDialog.value = true
      break
    case 'edit':
      editingStrategy.value = data as Strategy
      showCreateDialog.value = true
      break
    case 'toggle':
      doToggleStrategy(data as Strategy)
      break
    case 'test':
      doTestStrategy(data as Strategy)
      break
    case 'force':
      doForceOpenPosition(data as Strategy)
      break
    case 'version':
      viewingStrategy.value = data as Strategy
      showVersionHistoryDialog.value = true
      break
    case 'delete':
      doDeleteStrategy(data as Strategy)
      break
  }
  
  pendingAction.value = null
}

// 创建策略
const createStrategy = () => {
  pendingAction.value = { type: 'create' }
  showPasswordDialog.value = true
}

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
  pendingAction.value = { type: 'edit', data: strategy }
  showPasswordDialog.value = true
}

// 保存策略
const handleSaveStrategy = async (data: any) => {
  try {
    if (editingStrategy.value) {
      // 编辑现有策略：显示保存确认对话框
      pendingSaveData.value = data
      saveAsNewVersion.value = false
      versionChanges.value = ''
      showSaveConfirmDialog.value = true
    } else {
      // 创建新策略
      await $fetch('/api/strategies', {
        method: 'POST',
        body: data
      })
      ElMessage.success('策略已创建')
      showCreateDialog.value = false
      editingStrategy.value = null
      await loadStrategies()
    }
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  }
}

// 确认保存
const confirmSaveStrategy = async () => {
  try {
    await $fetch(`/api/strategies/${editingStrategy.value!.id}`, {
      method: 'PUT',
      body: {
        updates: pendingSaveData.value,
        saveAsNewVersion: saveAsNewVersion.value,
        changes: saveAsNewVersion.value ? versionChanges.value : '通过编辑器更新'
      }
    })

    ElMessage.success(saveAsNewVersion.value ? '策略已更新到新版本' : '策略已更新')
    showSaveConfirmDialog.value = false
    showCreateDialog.value = false
    editingStrategy.value = null
    pendingSaveData.value = null
    await loadStrategies()
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  }
}

// 切换策略状态
const toggleStrategy = (strategy: Strategy) => {
  pendingAction.value = { type: 'toggle', data: strategy }
  showPasswordDialog.value = true
}

// 实际执行切换策略状态
const doToggleStrategy = async (strategy: Strategy) => {
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
const deleteStrategy = (strategy: Strategy) => {
  pendingAction.value = { type: 'delete', data: strategy }
  showPasswordDialog.value = true
}

// 实际执行删除策略
const doDeleteStrategy = async (strategy: Strategy) => {
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
  pendingAction.value = { type: 'version', data: strategy }
  showPasswordDialog.value = true
}

// 查看策略详情
const viewStrategyDetail = async (strategy: Strategy) => {
  detailStrategy.value = strategy
  showDetailDialog.value = true
  detailLoading.value = true
  
  try {
    // 并行加载所有数据
    const perfRes = await $fetch(`/api/strategies/${strategy.id}/performance`)
    
    performance.value = perfRes.data || {}
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

// 获取 EMA 周期
const getEmaPeriods = (strategy: Strategy) => {
  const emaIndicator = strategy.indicators.find(ind => ind.type === 'EMA')
  if (emaIndicator && emaIndicator.params && emaIndicator.params.periods) {
    return emaIndicator.params.periods.join(', ')
  }
  return '-'
}

// 手动测试策略
const testStrategy = (strategy: Strategy) => {
  pendingAction.value = { type: 'test', data: strategy }
  showPasswordDialog.value = true
}

// 实际执行手动测试策略
const doTestStrategy = async (strategy: Strategy) => {
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

// 强制开仓 - 触发入口（先弹密码验证，通过后弹开仓选择窗）
const openForcePosition = (strategy: Strategy) => {
  pendingAction.value = { type: 'force', data: strategy }
  showPasswordDialog.value = true
}

// 密码验证通过后 → 打开强制开仓选择弹窗
const doForceOpenPosition = (strategy: Strategy) => {
  forceOpenStrategy.value = strategy
  forceOpenSymbol.value = availableSymbols.value[0] || strategy.marketData.symbols[0] || ''
  forceOpenDirection.value = 'long'
  showForceOpenDialog.value = true
}

// 确认强制开仓
const confirmForceOpen = async () => {
  if (!forceOpenStrategy.value || !forceOpenSymbol.value) {
    // @ts-ignore
    ElMessage.error('请选择交易对')
    return
  }
  
  const strategy = forceOpenStrategy.value
  const symbol = forceOpenSymbol.value
  const direction = forceOpenDirection.value
  
  showForceOpenDialog.value = false
  
  forcingStrategies.value.add(strategy.id)
  
  try {
    const res = await $fetch(`/api/strategies/${strategy.id}/force-open`, {
      method: 'POST' as any,
      body: { symbol, direction }
    }) as any

    if (res.success) {
      // @ts-ignore
      ElMessage.success(`强制开仓成功: ${symbol} ${direction === 'long' ? '做多' : '做空'}`)
    } else {
      // @ts-ignore
      ElMessage.error(res.error || '开仓失败')
    }
  } catch (error: any) {
    // @ts-ignore
    ElMessage.error(`开仓失败: ${error.message}`)
  } finally {
    forcingStrategies.value.delete(strategy.id)
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
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
}

.text-success {
  color: var(--color-success) !important;
}

.text-danger {
  color: var(--color-danger) !important;
}

.text-warning {
  color: var(--color-warning) !important;
}

.text-secondary {
  color: var(--text-secondary) !important;
}

</style>

<style>
/* 策略编辑对话框移动端全宽（非 scoped，穿透 el-dialog 根元素） */
@media (max-width: 768px) {
  .strategy-dialog {
    --el-dialog-width: 100% !important;
  }
}
</style>
