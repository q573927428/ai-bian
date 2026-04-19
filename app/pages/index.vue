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
                  <span>🎛️ 状态面板</span>
                </div>
              </template>
              
              <div class="control-panel">
                <!-- 余额信息 -->
                <div class="balance-card-large">
                  <!-- 紧凑统计卡片 -->
                  <div class="stats-grid">
                    <div class="stat-card">
                      <div class="stat-card-label">📊 交易</div>
                      <div class="stat-card-value">{{ totalTrades }} </div>
                      <div class="stat-card-sub">今日 {{ todayTrades }}</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">📈 今日盈亏</div>
                      <div :class="['stat-card-value', pnlClass]">{{ formatPnLShort(dailyPnL) }}</div>
                      <div class="stat-card-sub">USDT</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">💰 总盈亏</div>
                      <div :class="['stat-card-value', totalPnLClass]">{{ formatPnLShort(totalPnL) }}</div>
                      <div class="stat-card-sub">USDT</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">🎯 总胜率</div>
                      <div class="stat-card-value">{{ formatWinRate(winRate) }}</div>
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
              <ActivePositions />
            </ClientOnly>
          </el-col>

          <!-- 中间 - 持仓和交易历史 -->
          <el-col :xs="24" :sm="24" :md="16" :lg="16">
            
            <!-- 加密货币价格卡片组件 -->
            <ClientOnly>
              <CryptoPriceCards />
            </ClientOnly>

            <!-- 策略组件 -->
            <ClientOnly>
              <Strategies />
            </ClientOnly>

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
import { useStrategiesStore } from '../stores/strategies'

// 导入组件
import SystemLogs from '../components/SystemLogs.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import ActivePositions from '../components/ActivePositions.vue'
import Strategies from '../components/Strategies.vue'

const botStore = useBotStore()
const strategiesStore = useStrategiesStore()

// 计算总交易次数（从 performance 读取）
const totalTrades = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.totalTrades || 0), 0)
})

// 计算今日交易次数
const todayTrades = computed(() => {
  const today = new Date().toDateString()
  let count = 0
  for (const strategy of strategiesStore.strategies) {
    if (strategy.tradeRecords) {
      count += strategy.tradeRecords.filter(trade => {
        if (!trade.closeTime) return false
        return new Date(trade.closeTime).toDateString() === today
      }).length
    }
  }
  return count
})

// 计算总盈亏（从 performance 读取）
const totalPnL = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.netProfit || 0), 0)
})

// 计算今日盈亏
const dailyPnL = computed(() => {
  const today = new Date().toDateString()
  let pnl = 0
  for (const strategy of strategiesStore.strategies) {
    if (strategy.tradeRecords) {
      pnl += strategy.tradeRecords
        .filter(trade => {
          if (!trade.closeTime) return false
          return new Date(trade.closeTime).toDateString() === today
        })
        .reduce((sum, trade) => sum + (trade.profitLoss || 0), 0)
    }
  }
  return pnl
})

// 计算总胜率（从 performance 读取）
const winRate = computed(() => {
  const totalTradesCount = strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.totalTrades || 0), 0)
  const totalWinsCount = strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.totalWins || 0), 0)
  return totalTradesCount > 0 ? (totalWinsCount / totalTradesCount) * 100 : 0
})

const pnlClass = computed(() => {
  return dailyPnL.value >= 0 ? 'text-success' : 'text-danger'
})

const totalPnLClass = computed(() => {
  return totalPnL.value >= 0 ? 'text-success' : 'text-danger'
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

// 跳转到策略管理页面
function goToStrategies() {
  window.location.href = '/strategies'
}

// 页面加载时获取状态
onMounted(async () => {
  await Promise.all([
    botStore.fetchStatus(),
    strategiesStore.loadStrategies()
  ])
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
