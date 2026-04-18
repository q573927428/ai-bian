<!-- 策略版本历史组件 -->
<template>
  <div class="strategy-version">
    <el-timeline v-loading="loading">
      <el-timeline-item
        v-for="version in versions"
        :key="version.version"
        :timestamp="formatDate(version.updatedAt)"
        placement="top"
      >
        <el-card>
          <div class="version-header">
            <el-tag type="primary" size="small">v{{ version.version }}</el-tag>
            <span class="changes">{{ version.changes }}</span>
          </div>
          <div class="version-actions">
            <el-button size="small" @click="showRollbackConfirmDialog(version)">
              回滚到此版本
            </el-button>
            <el-button size="small" @click="viewSnapshot(version.version)">
              查看配置
            </el-button>
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>

    <!-- 配置快照对话框 -->
    <el-dialog v-model="showSnapshotDialog" title="策略配置快照" width="70%" append-to-body>
      <pre class="snapshot-content">{{ JSON.stringify(snapshot, null, 2) }}</pre>
    </el-dialog>

    <!-- 回滚确认对话框 -->
    <el-dialog
      v-model="showRollbackConfirm"
      title="确认回滚"
      width="400px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div style="text-align: center; padding: 20px 0;">
        <p>确定要回滚到版本 v{{ confirmRollbackVersion }} 吗？</p>
      </div>
      <template #footer>
        <el-button @click="showRollbackConfirm = false">取消</el-button>
        <el-button type="primary" @click="handleRollback" :loading="rollingBack">确认回滚</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  strategyId: string
}>()

const versions = ref<any[]>([])
const loading = ref(false)
const showSnapshotDialog = ref(false)
const snapshot = ref<any>(null)
const showRollbackConfirm = ref(false)
const confirmRollbackVersion = ref<number | null>(null)
const rollingBack = ref(false)

// 显示回滚确认对话框
const showRollbackConfirmDialog = (version: any) => {
  confirmRollbackVersion.value = version.version
  showRollbackConfirm.value = true
}

// 加载版本历史
const loadVersions = async () => {
  loading.value = true
  try {
    const res = await $fetch<any>(`/api/strategies/${props.strategyId}/versions`)
    versions.value = res.data || []
  } catch (error: any) {
    ElMessage.error(`加载版本历史失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 回滚版本
const handleRollback = async () => {
  if (!confirmRollbackVersion.value) return
  
  try {
    rollingBack.value = true
    await $fetch(`/api/strategies/${props.strategyId}/rollback`, {
      method: 'POST',
      body: { targetVersion: confirmRollbackVersion.value }
    })

    ElMessage.success('策略已回滚')
    showRollbackConfirm.value = false
    await loadVersions()
  } catch (error: any) {
    ElMessage.error(`回滚失败: ${error.message}`)
  } finally {
    rollingBack.value = false
  }
}

// 查看配置快照
const viewSnapshot = async (version: number) => {
  try {
    const res = await $fetch<any>(`/api/strategies/${props.strategyId}`)
    const versionHistory = res.data.versionHistory
    const versionData = versionHistory.find((v: any) => v.version === version)

    if (versionData) {
      snapshot.value = versionData.snapshot
      showSnapshotDialog.value = true
    }
  } catch (error: any) {
    ElMessage.error(`加载配置快照失败: ${error.message}`)
  }
}

// 格式化日期
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadVersions()
})
</script>

<style scoped>
.strategy-version {
  padding: 10px;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.changes {
  color: #606266;
  font-size: 14px;
}

.version-actions {
  display: flex;
  gap: 10px;
}

.snapshot-content {
  background: #f5f7fa;
  padding: 20px;
  border-radius: 4px;
  max-height: 600px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}
</style>
