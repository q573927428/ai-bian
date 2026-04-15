<!-- 策略管理页面 -->
<template>
  <div class="strategies-page">
    <div class="page-header">
      <h1>策略管理器</h1>
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

    <!-- 策略列表 -->
    <el-card>
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
        <el-table-column label="操作" fixed="right" width="280">
          <template #default="{ row }">
            <el-button size="small" @click="editStrategy(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.isActive ? 'warning' : 'success'"
              @click="toggleStrategy(row)"
            >
              {{ row.isActive ? '停用' : '激活' }}
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Strategy } from '../../types/strategy'
import StrategyEditor from '../components/StrategyEditor.vue'
import StrategyVersionHistory from '../components/StrategyVersionHistory.vue'

const strategies = ref<Strategy[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const showVersionHistoryDialog = ref(false)
const editingStrategy = ref<Strategy | null>(null)
const viewingStrategy = ref<Strategy | null>(null)

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
</style>
