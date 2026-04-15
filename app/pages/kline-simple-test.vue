<template>
  <!-- <div class="kline-simple-test-page">
    <KLineChartSimple symbol="BTCUSDT" />
  </div> -->
</template>

<script setup lang="ts">
import { ref } from 'vue'
import KLineChartSimple from '../components/kline-chart/KLineChartSimple.vue'

const testResult = ref<any>(null)
const syncStatus = ref<any>(null)
const syncing = ref(false)
const batchLoading = ref(false)
const manualSyncLoading = ref(false)
const isChartFullscreen = ref(false)

// 切换图表全屏
function toggleChartFullscreen() {
  isChartFullscreen.value = !isChartFullscreen.value
}

// 测试获取K线数据
const testGetKLineData = async () => {
  try {
    const response = await fetch('/api/kline-simple?symbol=BTCUSDT&timeframe=1h&limit=10')
    const result = await response.json()
    testResult.value = result
  } catch (error: any) {
    testResult.value = { error: error.message }
  }
}

// 测试获取已存储交易对
const testGetStoredSymbols = async () => {
  try {
    const response = await fetch('/api/kline-simple?action=stored-symbols')
    const result = await response.json()
    testResult.value = result
  } catch (error: any) {
    testResult.value = { error: error.message }
  }
}

// 测试同步数据
const testSyncData = async () => {
  syncing.value = true
  try {
    // 调用同步API获取状态
    const response = await fetch('/api/kline-simple-sync/status')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const result = await response.json()
    
    testResult.value = {
      success: true,
      message: '同步状态获取成功',
      data: result
    }
    
    syncStatus.value = result
  } catch (error: any) {
    testResult.value = { error: error.message }
  } finally {
    syncing.value = false
  }
}

</script>

<style scoped>
.kline-simple-test-page {
  max-width: 1400px;
  margin: 0 auto;
}

/* 页面标题 */
.page-header {
  margin-bottom: 30px;
  text-align: center;
}

.page-header h1 {
  margin: 0;
  color: #303133;
  font-size: 28px;
  font-weight: 600;
}

.page-description {
  margin-top: 10px;
  color: #606266;
  font-size: 16px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 图表区域 */
.chart-section {
  margin-bottom: 24px;
}

.chart-card {
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #303133;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* API测试区域 */
.api-test-section {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.api-test-section h2 {
  margin-bottom: 20px;
  color: var(--el-color-primary);
}

.test-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.test-result,
.sync-status {
  margin-top: 20px;
  padding: 15px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  overflow: auto;
}

.test-result h3,
.sync-status h3 {
  margin-bottom: 10px;
  color: var(--el-text-color-primary);
}

.test-result pre,
.sync-status pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 说明区域 */
.explanation {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.explanation h2 {
  color: var(--el-color-primary);
  margin-bottom: 15px;
}

.explanation h3 {
  color: var(--el-text-color-primary);
  margin: 20px 0 10px;
}

.explanation ul {
  margin: 10px 0;
  padding-left: 20px;
}

.explanation li {
  margin-bottom: 8px;
  line-height: 1.5;
}

.explanation code {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
}

/* 响应式设计 - 平板端 (768px以下) */
@media (max-width: 768px) {
  .kline-simple-test-page {
    padding: 16px;
  }
  
  .page-header h1 {
    font-size: 24px;
  }
  
  .page-description {
    font-size: 14px;
  }
  
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .card-actions {
    width: 100%;
    justify-content: flex-end;
  }
  
  .test-controls {
    flex-direction: column;
  }
  
  .test-controls .el-button {
    width: 100%;
  }
}

/* 响应式设计 - 手机端 (480px以下) */
@media (max-width: 480px) {
  .kline-simple-test-page {
    padding: 12px;
  }
  
  .page-header h1 {
    font-size: 20px;
  }
  
  .page-description {
    font-size: 13px;
  }
  
  .test-result pre,
  .sync-status pre {
    font-size: 11px;
  }
}

/* 响应式设计 - 超小屏幕 (360px以下) */
@media (max-width: 360px) {
  .kline-simple-test-page {
    padding: 8px;
  }
  
  .page-header h1 {
    font-size: 18px;
  }
  
  .page-description {
    font-size: 12px;
  }
  
  .test-result pre,
  .sync-status pre {
    font-size: 10px;
  }
}
</style>
