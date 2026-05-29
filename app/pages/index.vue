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
          <div class="header-right">
            <el-button text size="small" @click="toggleTheme" class="theme-toggle-btn">
              <el-icon :size="18">
                <ElIconMoon v-if="currentTheme === 'light'" />
                <ElIconSunny v-else />
              </el-icon>
              {{ currentTheme === 'light' ? '暗色' : '亮色' }}
            </el-button>
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
                  <span>🎛️ 状态面板</span>
                  <el-button type="primary" size="small" text @click="showConfigDialog = true">
                    <el-icon><ElIconSetting /></el-icon>
                    配置
                  </el-button>
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

            <!-- 盈亏胜率走势图表 -->
            <ClientOnly>
              <ProfitWinRateChart />
            </ClientOnly>

          </el-col>

          <!-- 右侧 - 持仓和交易历史 -->
          <el-col :xs="24" :sm="24" :md="16" :lg="16">
            
            <!-- 加密货币价格卡片组件 -->
            <ClientOnly>
              <CryptoPriceCards />
            </ClientOnly>

            <!-- 密码保护区域 -->
            <ClientOnly>
              <!-- 未验证：显示密码卡片 -->
              <div v-if="!passwordVerified" class="password-card">
                <div class="password-card-inner">
                  <el-icon :size="20" color="#409EFF"><ElIconLock /></el-icon>
                  <span class="password-title">请输入密码查看交易数据</span>
                  <div class="password-input-row">
                    <el-input
                      v-model="passwordInput"
                      type="password"
                      show-password
                      placeholder="请输入操作密码"
                      @keyup.enter="verifyPassword"
                      :disabled="verifying"
                      class="password-input"
                    />
                    <el-button type="primary" @click="verifyPassword" :loading="verifying" size="small">
                      验证
                    </el-button>
                  </div>
                  <p v-if="errorMsg" class="password-error">{{ errorMsg }}</p>
                </div>
              </div>
              
              <!-- 已验证：显示三个组件 -->
              <template v-else>
                <Strategies />
                <TradeHistory />
                <SystemLogs />
              </template>
            </ClientOnly>


          </el-col>
          
        </el-row>
      </el-main>
      
      <!-- 配置对话框 -->
      <ClientOnly>
        <BotConfigDialog v-model="showConfigDialog" @success="handleConfigSuccess" />
      </ClientOnly>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'
import { useStrategiesStore } from '../stores/strategies'
import { useTheme } from '../composables/useTheme'

// 密码验证相关
const PASSWORD_STORAGE_KEY = 'page_password_verified'
const passwordVerified = ref(false)
const passwordInput = ref('')
const verifying = ref(false)
const errorMsg = ref('')

const verifyPassword = async () => {
  if (!passwordInput.value.trim()) {
    errorMsg.value = '请输入密码'
    return
  }
  verifying.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch<any>('/api/bot/check-password', {
      method: 'POST',
      body: { password: passwordInput.value }
    })
    if (res.success) {
      passwordVerified.value = true
      localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify({
        verified: true,
        timestamp: Date.now()
      }))
    } else {
      errorMsg.value = res.message || '密码错误'
    }
  } catch (err: any) {
    errorMsg.value = '验证失败: ' + (err.message || '未知错误')
  } finally {
    verifying.value = false
  }
}

// 导入组件
import SystemLogs from '../components/SystemLogs.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import ActivePositions from '../components/ActivePositions.vue'
import Strategies from '../components/Strategies.vue'
import TradeHistory from '../components/TradeHistory.vue'
import BotConfigDialog from '../components/BotConfigDialog.vue'
import ProfitWinRateChart from '../components/ProfitWinRateChart.vue'

const botStore = useBotStore()
const strategiesStore = useStrategiesStore()
const { theme: currentTheme, toggleTheme } = useTheme()

// 配置对话框
const showConfigDialog = ref(false)

const handleConfigSuccess = () => {
  // 配置保存成功后的处理
  botStore.fetchStatus()
}

// 计算总交易次数（从 performance 读取）
const totalTrades = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.totalTrades || 0), 0)
})

// 计算今日交易次数
const todayTrades = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.todayTrades || 0), 0)
})

// 计算总盈亏（从 performance 读取）
const totalPnL = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.netProfit || 0), 0)
})

// 计算今日盈亏
const dailyPnL = computed(() => {
  return strategiesStore.strategies.reduce((sum, s) => sum + (s.performance?.dailyPnL || 0), 0)
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
  // 检查本地验证状态（24小时有效）
  const stored = localStorage.getItem(PASSWORD_STORAGE_KEY)
  if (stored) {
    try {
      const data = JSON.parse(stored)
      if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        passwordVerified.value = true
      } else {
        localStorage.removeItem(PASSWORD_STORAGE_KEY)
      }
    } catch {
      localStorage.removeItem(PASSWORD_STORAGE_KEY)
    }
  }

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
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  padding: 0 20px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
}

.theme-toggle-btn {
  color: var(--text-regular) !important;
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
  color: var(--color-success);
}

.text-danger {
  color: var(--color-danger);
}

/* 紧凑统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.stat-card {
  background: var(--stat-card-bg);
  border: 1px solid var(--stat-card-border);
  border-radius: 10px;
  padding: 12px 4px;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-card:hover {
  box-shadow: var(--shadow-card);
  transform: translateY(-1px);
}

.stat-card-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 3px;
  white-space: nowrap;
}

.stat-card-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-card-sub {
  font-size: 12px;
  color: var(--text-placeholder);
  margin-top: 3px;
}

/* 余额条 */
.balance-bar {
  display: flex;
  justify-content: space-between;
  background: var(--bg-main);
  border-radius: 4px;
  padding: 5px 6px;
  margin-top: 6px;
  font-size: 12px;
}

.balance-item {
  color: var(--text-regular);
}

.balance-label {
  color: var(--text-secondary);
}

/* 大余额卡片 */
.balance-card-large {
  background: var(--balance-card-bg);
  border: 1px solid var(--balance-card-border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: var(--shadow-card);
}

.balance-main-large {
  text-align: center;
  margin-bottom: 10px;
}

.balance-total-large {
  font-size: 16px;
  font-weight: 700;
  color: var(--balance-total-color);
  line-height: 1.2;
  padding-left: 5px;
}
.balance-usdt-large{
  font-size: 16px;
  color: var(--text-secondary);
  padding-left: 5px;
}

.balance-details-large {
  display: flex;
  justify-content: space-between;
  background: var(--balance-details-bg);
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
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.balance-free-large {
  font-size: 16px;
  font-weight: 600;
  color: var(--balance-free-color);
}

  .balance-locked-large {
    font-size: 16px;
    font-weight: 600;
    color: var(--balance-locked-color);
  }

/* 密码验证卡片 */
.password-card {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 50px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  margin-bottom: 20px;
  padding: 8px 16px;
}

.password-card-inner {
  text-align: center;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.password-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.password-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.password-input {
  width: 200px;
}

.password-error {
  color: var(--color-danger);
  font-size: 12px;
  width: 100%;
  margin: 0;
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
