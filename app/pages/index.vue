<template>
  <div class="container">
    <el-container>
      <!-- 头部 -->
      <el-header class="header">
        <div class="header-content">
          <h1>
            <el-icon style="vertical-align: middle; margin-right: 8px"><ElIconTrendCharts /></el-icon>
            币安永续合约AI自动交易系统
          </h1>
          <div class="header-actions">
            <el-tag v-if="botStore.isRunning" type="success" effect="dark">运行中</el-tag>
            <el-tag v-else-if="botStore.isHalted" type="danger" effect="dark">熔断停机</el-tag>
            <el-tag v-else type="info" effect="dark">已停止</el-tag>
          </div>
        </div>
      </el-header>

      <!-- 主体 -->
      <el-main class="main">
        <el-row :gutter="20">
          <!-- 左侧 - 控制面板 -->
          <el-col :xs="24" :sm="24" :md="8" :lg="8">
            <el-card class="card" shadow="hover">
              <template #header>
                <div class="card-header">
                  <span>🎛️ 控制面板</span>
                  <el-button
                    text
                    type="primary"
                  >
                    {{ statusText }}
                  </el-button>
                </div>
              </template>
              
              <div class="control-panel">
                <el-button
                  type="primary"
                  :loading="botStore.isLoading"
                  :disabled="botStore.isRunning"
                  @click="handleEditConfig"
                >
                  <el-icon style="margin-right: 8px"><ElIconVideoPlay /></el-icon>
                  启动
                </el-button>

                <el-button
                  type="danger"
                  :loading="botStore.isLoading"
                  :disabled="!botStore.isRunning"
                  @click="handleEditConfig"
                >
                  <el-icon style="margin-right: 8px"><ElIconVideoPause /></el-icon>
                  停止
                </el-button>

                <el-button
                  type="info"
                  @click="goToAnalysis"
                >
                  <el-icon style="margin-right: 8px"><ElIconTrendCharts /></el-icon>
                  分析
                </el-button>
                <!-- 余额信息 -->
                <div class="balance-card-large">
                  <!-- 紧凑统计卡片 -->
                  <div class="stats-grid">
                    <div class="stat-card">
                      <div class="stat-card-label">📊 交易</div>
                      <div class="stat-card-value">{{ botStore.state?.totalTrades || 0 }} </div>
                      <div class="stat-card-sub">今日 {{ botStore.state?.todayTrades || 0 }}</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">📈 今日盈亏</div>
                      <div :class="['stat-card-value', pnlClass]">{{ formatPnLShort(botStore.state?.dailyPnL || 0) }}</div>
                      <div class="stat-card-sub">USDT</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">💰 总盈亏</div>
                      <div :class="['stat-card-value', totalPnLClass]">{{ formatPnLShort(botStore.state?.totalPnL || 0) }}</div>
                      <div class="stat-card-sub">USDT</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">🎯 总胜率</div>
                      <div class="stat-card-value">{{ formatWinRate(botStore.state?.winRate || 0) }}</div>
                      <div class="stat-card-sub">总体</div>
                    </div>
                  </div>
                  <div class="balance-details-large">
                    <div class="balance-row-large">
                      <span class="balance-label-large">💵 总余额</span>
                      <span class="balance-total-large">$ {{ formatBalance(usdtBalance?.total || 0) }}</span>
                    </div>
                    <div class="balance-row-large">
                      <span class="balance-label-large">💚 可用</span>
                      <span class="balance-free-large">$ {{ formatBalance(usdtBalance?.free || 0) }}</span>
                    </div>
                    <div class="balance-row-large">
                      <span class="balance-label-large">🔐 锁定</span>
                      <span class="balance-locked-large">$ {{ formatBalance(usdtBalance?.locked || 0) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>
            <!-- 当前持仓组件 -->
            <ClientOnly>
              <CurrentPositions />
            </ClientOnly>
            <!-- 盈亏与胜率走势图 -->
            <ClientOnly>
              <PnLTrendChart />
            </ClientOnly>
            <!-- 手动开仓组件 -->
            <ManualOpenPosition />
            <!-- 系统配置组件 -->
            <SystemConfig />
          </el-col>

          <!-- 中间 - 持仓和交易历史 -->
          <el-col :xs="24" :sm="24" :md="16" :lg="16">
            <!-- 加密货币价格卡片组件 -->
            <ClientOnly>
              <CryptoPriceCards />
            </ClientOnly>


            <!-- 交易历史组件 -->
            <TradeHistory :has-position="botStore.hasPosition" />

            <!-- 系统日志组件 -->
            <ClientOnly>
              <SystemLogs />
            </ClientOnly>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

// 导入组件
import TradeHistory from '../components/TradeHistory.vue'
import SystemLogs from '../components/SystemLogs.vue'
import SystemConfig from '../components/SystemConfig.vue'
import CurrentPositions from '../components/CurrentPositions.vue'
import PnLTrendChart from '../components/PnLTrendChart.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import ManualOpenPosition from '../components/ManualOpenPosition.vue'

const botStore = useBotStore()

const statusText = computed(() => {
  const status = botStore.state?.status
  const statusMap: Record<string, string> = {
    IDLE: '空闲',
    MONITORING: '监控中',
    OPENING: '开仓中',
    POSITION: '持仓中',
    CLOSING: '平仓中',
    HALTED: '熔断停机',
  }
  return statusMap[status || 'IDLE'] || '未知'
})

const pnlClass = computed(() => {
  const pnl = botStore.state?.dailyPnL || 0
  return pnl >= 0 ? 'text-success' : 'text-danger'
})

const totalPnLClass = computed(() => {
  const totalPnL = botStore.state?.totalPnL || 0
  return totalPnL >= 0 ? 'text-success' : 'text-danger'
})

// 获取USDT余额
const usdtBalance = computed(() => {
  if (!botStore.cryptoBalances || botStore.cryptoBalances.length === 0) {
    return null
  }
  return botStore.cryptoBalances.find(balance => balance.asset === 'USDT')
})

function formatPnL(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`
}

function formatTotalPnL(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`
}

function formatPnLShort(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function formatWinRate(value: number): string {
  return `${value.toFixed(2)}%`
}

function formatBalance(value: number): string {
  if (value === 0) return '0'
  
  // 根据数值大小格式化显示
  if (value < 0.001) {
    return value.toFixed(5)
  } else if (value < 1) {
    return value.toFixed(4)
  } else if (value < 1000) {
    return value.toFixed(2)
  } else {
    return value.toFixed(2)
  }
}

// 跳转到策略分析页面
function goToAnalysis() {
  window.location.href = '/strategy-analysis'
}

// 处理编辑配置按钮点击
async function handleEditConfig() {
  // 检查是否需要密码验证
  try {
    const response = await $fetch<{ success: boolean; requiresPassword: boolean }>('/api/bot/check-password')
    if (response.success) {
      // 如果需要密码验证，显示密码输入对话框
      if (response.requiresPassword) {
        ElMessage.info('编辑配置需要密码验证，请点击配置面板中的"编辑"按钮')
        return
      }
    }
  } catch (error) {
    console.error('检查密码配置失败:', error)
  }
  
  // 不需要密码验证，直接打开配置对话框
  ElMessage.info('请点击配置面板中的"编辑"按钮打开配置对话框')
}

// 页面加载时获取状态
onMounted(async () => {
  await botStore.fetchStatus()
})
</script>

<style scoped>
.container {
  min-height: 100vh;
}

.header {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 0 20px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  display: flex;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.main {
  padding: 20px;
}

.card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.control-panel {
  padding: 4px 0;
}

.text-success {
  color: #67c23a;
}

.text-danger {
  color: #f56c6c;
}

/* 紧凑统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.stat-card {
  background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 4px;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.stat-card-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 3px;
  white-space: nowrap;
}

.stat-card-value {
  font-size: 15px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}

.stat-card-sub {
  font-size: 12px;
  color: #c0c4cc;
  margin-top: 3px;
}

/* 余额条 */
.balance-bar {
  display: flex;
  justify-content: space-between;
  background: #f5f7fa;
  border-radius: 4px;
  padding: 5px 6px;
  margin-top: 6px;
  font-size: 12px;
}

.balance-item {
  color: #606266;
}

.balance-label {
  color: #909399;
}

/* 大余额卡片 */
.balance-card-large {
  background: linear-gradient(135deg, #f0f9ff 0%, #e6f7ff 100%);
  border: 1px solid #91d5ff;
  border-radius: 8px;
  padding: 12px;
  margin-top: 10px;
  box-shadow: 0 2px 8px rgba(145, 213, 255, 0.15);
}

.balance-main-large {
  text-align: center;
  margin-bottom: 10px;
}

.balance-total-large {
  font-size: 16px;
  font-weight: 700;
  color: #1890ff;
  line-height: 1.2;
  padding-left: 5px;
}
.balance-usdt-large{
  font-size: 16px;
  color: #5c5e63;
  padding-left: 5px;
}

.balance-details-large {
  display: flex;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  padding: 8px;
  margin-top: 10px;
}

.balance-row-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.balance-label-large {
  font-size: 13px;
  color: #8c8c8c;
  margin-bottom: 4px;
}

.balance-free-large {
  font-size: 16px;
  font-weight: 600;
  color: #52c41a;
}

.balance-locked-large {
  font-size: 16px;
  font-weight: 600;
  color: #fa8c16;
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 16px;
  }

  .main {
    padding: 10px;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
  }
  
  .stat-card {
    padding: 8px 3px;
  }
  
  .balance-bar {
    flex-wrap: wrap;
    gap: 3px;
    font-size: 9px;
  }
  
  .balance-card-large {
    padding: 10px;
  }
  
  
  .balance-details-large {
    padding: 6px;
  }
}
</style>
