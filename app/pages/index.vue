<template>
  <div class="container">
    <el-container>
      <!-- 头部 -->
      <el-header class="header">
        <div class="header-content">
          <h1>
            <img :src="currentTheme === 'light' ? '/logo-light.png' : '/logo.png'" alt="Logo" style="width: 1.5em; height: 1.5em; object-fit: contain; vertical-align: middle; margin-right: 8px" />
            AI自动交易
          </h1>
          <!-- 桌面直接显示导航，移动端通过右上角菜单展开同一组入口。 -->
          <nav id="header-navigation" class="header-navigation" :class="{ 'is-open': mobileNavOpen }" aria-label="行情导航">
            <div class="navigation-inner">
              <button v-for="item in navigationItems" :key="item.label" type="button" class="navigation-item" :class="{ 'is-active': item.isOpen() }" aria-haspopup="dialog" @click="item.open(); mobileNavOpen = false">
                <span class="navigation-icon">
                  <el-icon :size="18" aria-hidden="true">
                    <component :is="item.icon" />
                  </el-icon>
                </span>
                <span class="navigation-copy">
                  <span class="navigation-label">{{ item.label }}</span>
                  <span class="navigation-description">{{ item.description }}</span>
                </span>
              </button>
            </div>
          </nav>
          <div class="header-right">
            <!-- 运行状态 -->
            <button type="button" class="header-status" aria-label="查看系统运行状态与性能" @click="showPerformanceDialog = true">
              <div :class="['status-dot-sm', botStore.state?.isRunning ? 'status-running' : 'status-stopped']" />
              <span class="header-status-text">{{ botStore.state?.isRunning ? '运行中' : '已停止' }}</span>
            </button>
            <el-button text size="small" @click="toggleTheme" class="theme-toggle-btn" :aria-label="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'" :title="currentTheme === 'light' ? '切换暗色主题' : '切换亮色主题'">
              <el-icon :size="18">
                <ElIconMoon v-if="currentTheme === 'light'" />
                <ElIconSunny v-else />
              </el-icon>
            </el-button>
            <el-button text size="small" class="mobile-nav-toggle" :class="{ 'is-open': mobileNavOpen }" :aria-label="mobileNavOpen ? '收起行情导航' : '展开行情导航'" aria-controls="header-navigation" :aria-expanded="mobileNavOpen" @click="mobileNavOpen = !mobileNavOpen" @keydown.esc="mobileNavOpen = false">
              <el-icon :size="20" aria-hidden="true">
                <ElIconClose v-if="mobileNavOpen" />
                <ElIconExpand v-else />
              </el-icon>
            </el-button>
          </div>
        </div>
      </el-header>

      <!-- 主体 -->
      <el-main class="main">
        <el-row :gutter="20">
          <!-- 左侧 - 控制面板 -->
          <el-col class="overview-column" :xs="24" :sm="24" :md="6" :lg="6">
            <el-card class="card" shadow="hover">
              <template #header>
                <div class="card-header">
                  <span>🎛️ 状态面板</span>
                  <div class="card-header-actions">
                    <el-button v-if="!passwordVerified" type="primary" size="small" text @click="handleUnlock">
                      <el-icon><ElIconUnlock /></el-icon>
                      解锁
                    </el-button>
                    <el-button v-if="passwordVerified && hasPassword" type="primary" size="small" text @click="clearPassword">
                      <el-icon><ElIconLock /></el-icon>
                      锁定
                    </el-button>
                  </div>
                </div>
              </template>
              
              <div class="control-panel">
                <!-- 将常用入口放在控制面板正文内，避免标题栏操作过于拥挤。 -->
                <div class="control-panel-actions">
                  <el-button class="control-panel-action" type="primary" size="small" text @click="handleOpenProtectedPanel('config')">
                    <el-icon><ElIconSetting /></el-icon>
                    配置
                  </el-button>
                  <el-button class="control-panel-action" type="primary" size="small" text @click="handleOpenProtectedPanel('strategies')">
                    <el-icon><ElIconOperation /></el-icon>
                    策略
                  </el-button>
                </div>
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
                      <div class="stat-card-label">💰 总盈亏</div>
                      <div :class="['stat-card-value', totalPnLClass]">{{ formatPnLShort(totalPnL) }}</div>
                      <div class="stat-card-sub">今日 <span :class="[pnlClass]">{{ formatPnLShort(dailyPnL) }}</span></div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">🎯 总胜率</div>
                      <div class="stat-card-value">{{ formatWinRate(winRate) }}</div>
                      <div class="stat-card-sub">总体</div>
                    </div>
                    <div class="stat-card">
                      <div class="stat-card-label">📈 年化</div>
                      <div :class="['stat-card-value', annualizedReturnClass]">{{ formatAnnualizedReturn(annualizedReturn) }}</div>
                      <div class="stat-card-sub">收益率</div>
                    </div>
                  </div>
                    <div class="balance-details-large">
                      <div class="balance-row-large">
                        <span class="balance-label-large">💰 本金</span>
                        <span class="balance-capital-large">$ {{ formatBalance(initialCapital) }}</span>
                      </div>
                      <div class="balance-row-large">
                        <span class="balance-label-large">💵 总余额</span>
                        <span class="balance-total-large">$ {{ formatBalance(usdtBalance?.total || 0) }}</span>
                      </div>
                      <div class="balance-row-large">
                        <span class="balance-label-large">💎 可用</span>
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

            <!-- 盈亏胜率走势图表 -->
            <ClientOnly>
              <ProfitWinRateChart />
            </ClientOnly>

          </el-col>

          <!-- 右侧 - 持仓和交易历史 -->
          <el-col class="market-column" :xs="24" :sm="24" :md="12" :lg="12">
            
            <!-- 加密货币价格卡片组件 -->
            <ClientOnly>
              <CryptoPriceCards v-model:chart-symbol="selectedChartSymbol" :chart-timeframe="selectedChartTimeframe" />
            </ClientOnly>

            <!-- 技术指标抽屉由顶部导航打开 -->
            <ClientOnly>
              <IndicatorsList v-model="showIndicatorsDrawer" @select-symbol="handlePositionChartSelect" />
            </ClientOnly>

            <!-- 系统日志抽屉由顶部导航打开 -->
            <ClientOnly>
              <SystemLogs v-model="showLogsDrawer" @select-symbol="handlePositionChartSelect" />
            </ClientOnly>

            <ClientOnly>
              <MacroDataDrawer v-model="showMacroDataDrawer" />
              <CryptoTrendsDrawer v-model="showCryptoTrendsDrawer" />
            </ClientOnly>

            <!-- 密码验证对话框 -->
            <ClientOnly>
              <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
            </ClientOnly>

            <!-- 策略组件 -->
            <ClientOnly v-if="passwordVerified">
              <Strategies v-model="showStrategiesDrawer" />
            </ClientOnly>

            <!-- 顶部订单入口需先解锁，验证成功后再挂载订单抽屉。 -->
            <ClientOnly v-if="passwordVerified">
              <TradeHistory v-model="showOrdersDrawer" @select-symbol="handlePositionChartSelect" />
            </ClientOnly>

            <ClientOnly>
              <TopSymbolsTable v-model="showTopSymbolsDialog" :selectable="false" />
            </ClientOnly>

          </el-col>

          <el-col class="positions-news-column" :xs="24" :sm="24" :md="6" :lg="6">
            <!-- 当前持仓固定显示，查看持仓无需解锁。 -->
            <ClientOnly>
              <ActivePositions @select-symbol="handlePositionChartSelect" />
              <LatestNews />
            </ClientOnly>
          </el-col>
          
        </el-row>
      </el-main>
      
      <!-- 配置对话框 -->
      <ClientOnly>
        <BotConfigDialog v-model="showConfigDialog" @success="handleConfigSuccess" />
      </ClientOnly>

      <!-- 性能面板对话框 -->
      <ClientOnly>
        <el-dialog v-model="showPerformanceDialog" title="系统性能面板" :style="{ width: '90%', maxWidth: '600px' }" draggable destroy-on-close>
          <PerformancePanel />
        </el-dialog>
      </ClientOnly>
    </el-container>
    <MarketOverview />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElIconDataAnalysis, ElIconStar, ElIconPlatform, ElIconTrendCharts, ElIconDocument, ElIconTickets } from '#components'
import { useBotStore } from '../stores/bot'
import { useStrategiesStore } from '../stores/strategies'
import { useTradeHistoryStore } from '../stores/tradeHistory'
import { useTheme } from '../composables/useTheme'

// 密码验证相关
const PASSWORD_STORAGE_KEY = 'page_password_verified'
const passwordVerified = ref(false)
const showPasswordDialog = ref(false)
const hasPassword = ref(false)
const pendingProtectedPanel = ref<'config' | 'strategies' | 'orders' | null>(null)

const handlePasswordSuccess = () => {
  passwordVerified.value = true
  hasPassword.value = true
  localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify({
    verified: true,
    timestamp: Date.now()
  }))

  // 只恢复本次验证对应的入口，避免解锁后需要用户再次点击。
  const panel = pendingProtectedPanel.value
  pendingProtectedPanel.value = null
  if (panel) {
    handleOpenProtectedPanel(panel)
  }
}

const clearPassword = () => {
  passwordVerified.value = false
  showConfigDialog.value = false
  showStrategiesDrawer.value = false
  showOrdersDrawer.value = false
  pendingProtectedPanel.value = null
  localStorage.removeItem(PASSWORD_STORAGE_KEY)
  hasPassword.value = false
}

const handleUnlock = () => {
  // 独立解锁不应恢复之前取消验证时留下的面板请求。
  pendingProtectedPanel.value = null
  showPasswordDialog.value = true
}

/**
 * 配置、策略和订单共用解锁门禁；验证成功后继续打开所选面板。
 */
const handleOpenProtectedPanel = (panel: 'config' | 'strategies' | 'orders') => {
  if (!passwordVerified.value) {
    pendingProtectedPanel.value = panel
    showPasswordDialog.value = true
    return
  }

  if (panel === 'config') showConfigDialog.value = true
  else if (panel === 'strategies') showStrategiesDrawer.value = true
  else showOrdersDrawer.value = true
}

// 导入组件
import PasswordDialog from '../components/PasswordDialog.vue'
import SystemLogs from '../components/SystemLogs.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import IndicatorsList from '../components/IndicatorsList.vue'
import MacroDataDrawer from '../components/MacroDataDrawer.vue'
import ActivePositions from '../components/ActivePositions.vue'
import LatestNews from '../components/LatestNews.vue'
import Strategies from '../components/Strategies.vue'
import TradeHistory from '../components/TradeHistory.vue'
import TopSymbolsTable from '../components/TopSymbolsTable.vue'
import BotConfigDialog from '../components/BotConfigDialog.vue'
import ProfitWinRateChart from '../components/ProfitWinRateChart.vue'
import PerformancePanel from '../components/PerformancePanel.vue'

const botStore = useBotStore()
const strategiesStore = useStrategiesStore()
const tradeHistoryStore = useTradeHistoryStore()
const { theme: currentTheme, toggleTheme } = useTheme()

// 配置对话框
const showConfigDialog = ref(false)
const showPerformanceDialog = ref(false)
const showIndicatorsDrawer = ref(false)
const showLogsDrawer = ref(false)
const showOrdersDrawer = ref(false)
const showTopSymbolsDialog = ref(false)
const showMacroDataDrawer = ref(false)
const showCryptoTrendsDrawer = ref(false)
const showStrategiesDrawer = ref(false)
const mobileNavOpen = ref(false)
// 导航共享入口，移动端选择后收起菜单，避免占用行情展示空间。
const navigationItems = [
  { label: '指标', description: '技术信号', icon: ElIconDataAnalysis, isOpen: () => showIndicatorsDrawer.value, open: () => { showIndicatorsDrawer.value = true } },
  { label: '热门', description: '市场焦点', icon: ElIconStar, isOpen: () => showTopSymbolsDialog.value, open: () => { showTopSymbolsDialog.value = true } },
  { label: '宏观', description: '全球市场', icon: ElIconPlatform, isOpen: () => showMacroDataDrawer.value, open: () => { showMacroDataDrawer.value = true } },
  { label: '趋势', description: '行情脉络', icon: ElIconTrendCharts, isOpen: () => showCryptoTrendsDrawer.value, open: () => { showCryptoTrendsDrawer.value = true } },
  { label: '日志', description: '系统动态', icon: ElIconDocument, isOpen: () => showLogsDrawer.value, open: () => { showLogsDrawer.value = true } },
  { label: '订单', description: '交易记录', icon: ElIconTickets, isOpen: () => showOrdersDrawer.value, open: () => { handleOpenProtectedPanel('orders') } }
]
// 首页负责在持仓列表与 K 线区域之间中转交易对和持仓主周期。
const selectedChartSymbol = ref('')
const selectedChartTimeframe = ref('')

/** 点击持仓交易对时，同时定位图表交易对和该持仓的主周期。 */
function handlePositionChartSelect(symbol: string, mainTimeframe?: string) {
  selectedChartSymbol.value = symbol
  // 兼容未保存主周期的旧持仓，避免向图表传入无效周期。
  if (mainTimeframe) selectedChartTimeframe.value = mainTimeframe
}

const handleConfigSuccess = () => {
  // 配置保存成功后的处理
  botStore.fetchStatus()
}

// 首页与盈亏图表统一以交易历史为统计真源，避免策略文件中的 performance 缓存过期。
const totalTrades = computed(() => {
  return tradeHistoryStore.allHistory.length
})

// 计算今日交易次数
const todayTrades = computed(() => {
  const today = new Date().toDateString()
  return tradeHistoryStore.allHistory.filter(trade => new Date(trade.closeTime).toDateString() === today).length
})

// pnl 对新记录表示币安 realizedPnl 扣除真实开平仓手续费后的净收益。
const totalPnL = computed(() => {
  return tradeHistoryStore.allHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0)
})

// 计算今日盈亏
const dailyPnL = computed(() => {
  const today = new Date().toDateString()
  return tradeHistoryStore.allHistory
    .filter(trade => new Date(trade.closeTime).toDateString() === today)
    .reduce((sum, trade) => sum + (trade.pnl || 0), 0)
})

// 计算总胜率
const winRate = computed(() => {
  const totalTradesCount = tradeHistoryStore.allHistory.length
  const totalWinsCount = tradeHistoryStore.allHistory.filter(trade => trade.pnl > 0).length
  return totalTradesCount > 0 ? (totalWinsCount / totalTradesCount) * 100 : 0
})

const pnlClass = computed(() => {
  return dailyPnL.value >= 0 ? 'text-success' : 'text-danger'
})

const totalPnLClass = computed(() => {
  return totalPnL.value >= 0 ? 'text-success' : 'text-danger'
})

// 从配置中读取初始本金
const initialCapital = computed(() => {
  return botStore.botConfig?.initialCapital || 0
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

// 计算年化收益率
const annualizedReturn = computed(() => {
  const netProfit = totalPnL.value

  // 从配置中读取用户设置的初始本金
  const initialCapital = botStore.botConfig?.initialCapital || 0

  // 未设置初始本金时显示提示
  if (initialCapital <= 0) {
    return 0
  }

  // 获取最早策略创建时间作为起始运行时间
  const creationTimes = strategiesStore.strategies
    .map(s => s.createdAt ? new Date(s.createdAt).getTime() : 0)
    .filter(t => t > 0)

  if (creationTimes.length === 0) return 0

  const earliestTime = Math.min(...creationTimes)
  const now = Date.now()
  const daysElapsed = (now - earliestTime) / (1000 * 60 * 60 * 24)

  if (daysElapsed <= 0) return 0

  // 年化收益率 = (总净收益 / 初始本金) * (365 / 运行天数) * 100%
  return (netProfit / initialCapital) * (365 / daysElapsed) * 100
})

const annualizedReturnClass = computed(() => {
  return annualizedReturn.value >= 0 ? 'text-success' : 'text-danger'
})

function formatAnnualizedReturn(value: number): string {
  if (!isFinite(value)) {
    return value > 0 ? '> +999%' : '0.00%'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
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
        hasPassword.value = true
      } else {
        localStorage.removeItem(PASSWORD_STORAGE_KEY)
      }
    } catch {
      localStorage.removeItem(PASSWORD_STORAGE_KEY)
    }
  }

  await Promise.all([
    botStore.fetchStatus(),
    strategiesStore.loadStrategies(),
    tradeHistoryStore.fetchAllHistory()
  ])
})
</script>

<style scoped>
.container {
  /* 预留底部固定行情栏及安全区，页面高度始终跟随实际可视区域。 */
  height: 100vh;
  height: 100dvh;
  box-sizing: border-box;
  padding-bottom: calc(27px + env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.container > .el-container {
  flex: 1;
  min-height: 0;
}

.header {
  flex-shrink: 0;
}

/* 桌面三列共享剩余高度；长内容在列内滚动，不再撑高整页。 */
@media (min-width: 992px) {
  .main {
    min-height: 0;
    overflow: hidden;
  }

  .main > .el-row {
    height: 100%;
    min-height: 0;
  }

  .main > .el-row > .el-col {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* 最后一张卡片无需再留列底外边距，否则内容恰好放下时仍会溢出。 */
  .main > .el-row > .el-col > :deep(.el-card:last-child) {
    margin-bottom: 0;
  }

  .main > .el-row > .el-col::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  /* 用剩余空间分配图表高度，避免固定高度、外边距和负边距累加。 */
  .main > .el-row > .overview-column,
  .main > .el-row > .market-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .overview-column > :deep(.card),
  .market-column > :deep(.price-grid-card) {
    flex: 0 0 auto;
    margin-bottom: 0;
  }

  .overview-column > :deep(.chart-card),
  .market-column > :deep(.chart-card) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin-bottom: 0;
  }

  .overview-column :deep(.chart-card > .el-card__header) {
    flex-shrink: 0;
  }

  .overview-column :deep(.chart-card > .el-card__body) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .overview-column :deep(.chart-container) {
    flex: 1;
    min-height: 80px;
    height: auto;
  }

  .overview-column :deep(.filters),
  .overview-column :deep(.stats-container) {
    flex-shrink: 0;
  }

  .market-column :deep(.chart-card > .el-card__body) {
    flex: 1;
    min-height: 0;
    padding: 0;
  }

  .market-column :deep(.chart-engine-switcher) {
    height: 100%;
    margin: 0;
  }

  .market-column :deep(.kline-chart-simple-container:not(:fullscreen)) {
    display: flex;
    flex-direction: column;
    height: 100%;
    margin: 0;
    transition: none;
  }

  .market-column :deep(.chart-controls-wrapper) {
    flex-shrink: 0;
  }

  .market-column :deep(.kline-chart-simple-container > .chart-container) {
    flex: 1;
    min-height: 0;
  }

  .market-column :deep(.horizontal-line) {
    display: none;
  }

  .main > .el-row > .positions-news-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow: hidden;
  }

  .positions-news-column :deep(.active-positions-card) {
    flex: 0 1 auto;
    /* 较矮屏幕也要为快讯保留空间，持仓过多时在正文内滚动。 */
    max-height: min(486px, 65%);
    margin-bottom: 0;
  }

  .positions-news-column :deep(.latest-news-card) {
    flex: 1;
    min-height: 0;
    margin-bottom: 0;
  }

  .positions-news-column :deep(.news-list) {
    height: auto;
  }
}

.header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 0 24px;
}

.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 8px 28px;
}

.header-content h1, .header-right { flex-shrink: 0; }

@media (max-width: 768px) {
  .header { height: auto; min-height: 60px; }
  .header-content { flex-wrap: wrap; padding: 10px 0; }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.header-navigation {
  padding-left: 24px;
  border-left: 1px solid var(--el-border-color-lighter);
}

.navigation-inner {
  display: flex;
  gap: 6px;
}

.navigation-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-regular);
  font: inherit;
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}

.navigation-icon {
  display: inline-flex;
  color: var(--text-secondary);
  transition: color 0.18s ease;
}

.navigation-item:hover,
.navigation-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.navigation-item:hover .navigation-icon,
.navigation-item.is-active .navigation-icon {
  color: var(--el-color-primary);
}

.navigation-item:focus-visible,
.header-status:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.navigation-label {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

.navigation-description {
  display: none;
}

.mobile-nav-toggle {
  display: none;
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
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
}

.main {
  padding: 20px;
}

.card {
  margin-bottom: 20px;
}

.card-header {
  font-weight: 600;
}

.card-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-panel {
  padding: 4px 0;
}

.control-panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  margin-top: -15px;
  background: var(--stat-card-bg);
  border-radius: 8px;
}

.control-panel-action {
  flex: 1;
  min-width: 0;
  height: 32px;
  margin: 0 !important;
  padding: 0 8px !important;
  border: 1px solid var(--el-border-color-lighter) !important;
  border-radius: 6px !important;
  background: var(--bg-card) !important;
  color: var(--text-regular) !important;
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.control-panel-action:hover {
  border-color: var(--el-color-primary) !important;
  background: var(--el-color-primary-light-9) !important;
  color: var(--el-color-primary) !important;
}

.control-panel-action :deep(.el-icon) {
  margin-right: 5px;
}

/* 头部运行状态指示器 */
.header-status {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 7px 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: transparent;
  font: inherit;
  border-radius: 20px;
  transition: background 0.2s ease;
}

.header-status:hover {
  background: var(--stat-card-bg);
}

.status-dot-sm {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-running {
  background: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
  animation: pulse 2s infinite;
}

.status-stopped {
  background: var(--color-danger);
  box-shadow: 0 0 6px var(--color-danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.header-status-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
  white-space: nowrap;
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
  font-size: 14px;
  font-weight: 700;
  color: var(--balance-total-color);
}
.balance-usdt-large{
  font-size: 14px;
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
  font-size: 14px;
  font-weight: 600;
  color: var(--balance-free-color);
}

.balance-capital-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.balance-locked-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--balance-locked-color);
}

@media (max-width: 768px) {
  .header { padding: 0 12px; }

  .header-content { gap: 0 8px; padding: 10px 0; }

  .header-right { gap: 4px; }

  .header-navigation {
    /* 用网格折叠平滑展开，隐藏时不留下可聚焦的导航入口。 */
    display: grid;
    grid-template-rows: 0fr;
    visibility: hidden;
    order: 3;
    width: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    transition: grid-template-rows 0.22s ease, opacity 0.22s ease, visibility 0.22s;
  }

  .header-navigation.is-open {
    grid-template-rows: 1fr;
    visibility: visible;
    opacity: 1;
  }

  .navigation-inner {
    min-height: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .header-navigation.is-open .navigation-inner {
    margin-top: 14px;
    padding-top: 12px;
    padding-bottom: 2px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .navigation-item {
    gap: 12px;
    padding: 12px;
    text-align: left;
    background: var(--bg-main);
    border-radius: 12px;
  }

  .navigation-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 10px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .navigation-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .navigation-description {
    display: block;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .mobile-nav-toggle {
    display: inline-flex;
    width: 36px;
    height: 36px;
    margin-left: 0 !important;
    padding: 0;
    border-radius: 10px;
    color: var(--text-regular);
    background: var(--bg-main);
  }

  .mobile-nav-toggle.is-open {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

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

  .control-panel-actions {
    gap: 4px;
    padding: 5px;
  }

  .control-panel-action {
    padding: 0 5px !important;
  }
  
  
  .balance-details-large {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    padding: 6px;
  }

  .balance-row-large {
    flex: none;
  }
}

/* 平板横屏压缩间距，保持品牌、导航和工具栏在同一行。 */
@media (min-width: 769px) and (max-width: 1200px) {
  .header { padding: 0 16px; }
  .header-content { column-gap: 8px; }
  .header h1 { font-size: 18px; }
  .header-navigation { padding-left: 8px; }
  .navigation-inner { gap: 2px; }
  .navigation-item { gap: 5px; padding: 9px 6px; }
  .navigation-label { font-size: 13px; }
}

@media (min-width: 769px) and (max-width: 900px) {
  .navigation-item .navigation-icon { display: none; }
}

/* 窄屏优先保留品牌与触控面积，运行状态仍可通过圆点查看。 */
@media (max-width: 374px) {
  .header-status-text { display: none; }
  .header-status { padding: 10px; }
  .header-content { column-gap: 4px; }
}

@media (prefers-reduced-motion: reduce) {
  .header-navigation,
  .navigation-item,
  .navigation-icon { transition: none; }
}
</style>
