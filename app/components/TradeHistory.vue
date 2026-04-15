<template>
  <el-card class="card" shadow="hover" :style="{ marginTop: hasPosition ? '20px' : '0' }">
    <template #header>
      <div class="card-header">
        <span>📋 交易历史记录</span>
        <el-button text type="primary" @click="handleRefreshHistory">
          <el-icon><ElIconRefresh /></el-icon>
          刷新
        </el-button>
      </div>
    </template>

    <el-table :data="botStore.history" style="width: 100%" max-height="450">
      <el-table-column prop="symbol" label="交易对" width="110" />
      <el-table-column prop="direction" label="方向" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.direction === 'LONG' ? 'success' : 'danger'" size="small">
            {{ scope.row.direction }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="quantity" label="数量" />
      <el-table-column prop="leverage" label="杠杆" />
      <el-table-column prop="entryPrice" label="入场价" width="120">
        <template #default="scope">
          {{ scope.row.entryPrice.toFixed(3) }}
        </template>
      </el-table-column>
      <el-table-column prop="exitPrice" label="出场价" width="120">
        <template #default="scope">
          {{ scope.row.exitPrice.toFixed(3) }}
        </template>
      </el-table-column>
      <el-table-column prop="pnl" label="盈亏(U)" width="100">
        <template #default="scope">
          <span :class="scope.row.pnl >= 0 ? 'text-success' : 'text-danger'">
            {{ scope.row.pnl.toFixed(2) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="pnlPercentage" label="盈亏(%)" width="100">
        <template #default="scope">
          <span :class="scope.row.pnlPercentage >= 0 ? 'text-success' : 'text-danger'">
            {{ scope.row.pnlPercentage.toFixed(2) }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="100" />
      <el-table-column prop="openTime" label="开仓时间" width="150">
        <template #default="scope">
          {{ dayjs(scope.row.openTime).format('YYYY-MM-DD HH:mm') }}
        </template>
      </el-table-column>
      <el-table-column prop="closeTime" label="平仓时间" width="150">
        <template #default="scope">
          {{ dayjs(scope.row.closeTime).format('YYYY-MM-DD HH:mm') }}
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页组件 -->
    <div v-if="botStore.pagination && botStore.pagination.total > 0" class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="botStore.pagination.total"
        layout="total, prev, pager, next"
        :pager-count="3"
        @size-change="handlePageSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <el-empty v-if="botStore.history.length === 0" description="暂无交易记录" />
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

// Props
const props = defineProps<{
  hasPosition?: boolean
}>()

const botStore = useBotStore()

// 分页相关
const currentPage = ref(1)
const pageSize = ref(10)

// 组件加载时获取第一页数据
onMounted(() => {
  botStore.fetchHistory(currentPage.value, pageSize.value)
})

// 刷新历史记录
async function handleRefreshHistory() {
  await botStore.fetchHistory(currentPage.value, pageSize.value)
}

// 分页处理函数
function handlePageChange(page: number) {
  currentPage.value = page
  botStore.fetchHistory(page, pageSize.value)
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  botStore.fetchHistory(1, size)
}
</script>

<style scoped>
.card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.text-success {
  color: #67c23a;
}

.text-danger {
  color: #f56c6c;
}

.pagination-container {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
