<!-- ==================== 首页布局、统计与面板协调 ==================== -->
<template>
  <div class="container">
    <!-- 头部封装后不再是直接的 ElHeader 子节点，需要显式指定纵向布局。 -->
    <el-container direction="vertical">

      <!-- 主体 -->
      <el-main class="main">
        <el-row :gutter="20">
          <!-- 左侧 - 控制面板 -->
          <el-col class="overview-column" :xs="24" :sm="24" :md="6" :lg="6">
            <HomeStatusPanel
              :password-verified="passwordVerified"
              :has-password="hasPassword"
              :total-trades="totalTrades"
              :today-trades="todayTrades"
              :total-pn-l="totalPnL"
              :daily-pn-l="dailyPnL"
              :win-rate="winRate"
              :today-win-rate="todayWinRate"
              :annualized-return="annualizedReturn"
              :daily-return="dailyReturn"
              :initial-capital="initialCapital"
              :usdt-balance="usdtBalance"
              @unlock="handleUnlock"
              @lock="clearPassword"
              @open="handleOpenProtectedPanel"
              @logs="showLogsDrawer = true"
              @hot="showTopSymbolsDialog = true"
            />

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

            <!-- 系统日志抽屉由状态面板打开 -->
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

    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'
import { useStrategiesStore } from '../stores/strategies'
import HomeStatusPanel from '../components/HomeStatusPanel.vue'
import { usePageUnlock } from '../composables/usePageUnlock'
import type { HomeNavigationTarget, HomeProtectedPanel } from '../../types/home'

// 导入组件
import PasswordDialog from '../components/PasswordDialog.vue'
import SystemLogs from '../components/SystemLogs.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import IndicatorsList from '../components/IndicatorsList.vue'
import MacroDataDrawer from '../components/MacroDataDrawer.vue'
import ActivePositions from '../components/ActivePositions.vue'
import LatestNews from '../components/LatestNews.vue'
import Strategies from '../components/Strategies.vue'
import TopSymbolsTable from '../components/TopSymbolsTable.vue'
import BotConfigDialog from '../components/BotConfigDialog.vue'
import ProfitWinRateChart from '../components/ProfitWinRateChart.vue'

const botStore = useBotStore()
const route = useRoute()
const strategiesStore = useStrategiesStore()
/** 首页交易统计字段，与历史汇总接口返回的数据保持一致。 */
interface HistoryOverview {
  totalTrades: number
  totalPnl: number
  winRate: number
  todayTrades: number
  todayPnl: number
  todayWinRate: number
}

const historyOverview = ref<HistoryOverview>({ totalTrades: 0, totalPnl: 0, winRate: 0, todayTrades: 0, todayPnl: 0, todayWinRate: 0 })

// 配置对话框
const showConfigDialog = ref(false)
const showIndicatorsDrawer = ref(false)
const showLogsDrawer = ref(false)
const showTopSymbolsDialog = ref(false)
const showMacroDataDrawer = ref(false)
const showCryptoTrendsDrawer = ref(false)
const showStrategiesDrawer = ref(false)

const { passwordVerified, showPasswordDialog, hasPassword, handleUnlock, handleOpenProtectedPanel, handlePasswordSuccess, clearPassword } = usePageUnlock({
  onOpen: openProtectedPanel,
  onLock: () => {
    showConfigDialog.value = false
    showStrategiesDrawer.value = false
  }
})

/** 仅由解锁门禁调用，确保管理面板遵守一致的访问限制。 */
function openProtectedPanel(panel: HomeProtectedPanel) {
  if (panel === 'config') showConfigDialog.value = true
  else if (panel === 'strategies') showStrategiesDrawer.value = true
  else void navigateTo('/orders')
}

/** 将顶部导航事件映射到面板开关，订单入口继续经过解锁门禁。 */
function handleNavigate(target: HomeNavigationTarget) {
  if (target === 'indicators') {
    void navigateTo('/indicators')
    return
  }
  if (target === 'home') {
    void navigateTo('/')
    return
  }
  if (target === 'orders') {
    handleOpenProtectedPanel('orders')
    return
  }
  const panels = {
    indicators: showIndicatorsDrawer,
    hot: showTopSymbolsDialog,
    macro: showMacroDataDrawer,
    trends: showCryptoTrendsDrawer,
    logs: showLogsDrawer
  }
  panels[target].value = true
}

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
const totalTrades = computed(() => historyOverview.value.totalTrades)
const todayTrades = computed(() => historyOverview.value.todayTrades)
const todayWinRate = computed(() => historyOverview.value.todayWinRate)
const totalPnL = computed(() => historyOverview.value.totalPnl)
const dailyPnL = computed(() => historyOverview.value.todayPnl)
const winRate = computed(() => historyOverview.value.winRate)

/** 仅获取汇总；本地自然日边界与原首页统计口径一致。 */
const loadHistoryOverview = async () => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  try {
    const response = await $fetch<{ success: boolean; data: HistoryOverview }>('/api/bot/history-overview', { params: { startTime: start.getTime(), endTime: end.getTime() } })
    if (response.success) historyOverview.value = response.data
  } catch (error) {
    console.error('加载交易汇总失败:', error)
  }
}
let overviewTimer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => { if (overviewTimer) clearInterval(overviewTimer) })

// 从配置中读取初始本金
const initialCapital = computed(() => {
  return botStore.botConfig?.initialCapital || 0
})

/** 今日收益率沿用年化的初始本金口径，不进行年化换算。 */
const dailyReturn = computed(() => initialCapital.value > 0
  ? dailyPnL.value / initialCapital.value * 100
  : 0)

// 获取USDT余额
const usdtBalance = computed(() => {
  if (!botStore.cryptoBalances || botStore.cryptoBalances.length === 0) {
    return null
  }
  return botStore.cryptoBalances.find(balance => balance.asset === 'USDT') ?? null
})

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

// 首页统计独立刷新，打开订单抽屉不再承担首页数据更新职责。
onMounted(async () => {
  // 从订单页共用导航返回时，恢复用户刚点击的行情面板。
  const panel = route.query.panel
  if (typeof panel === 'string' && ['indicators', 'hot', 'macro', 'trends', 'logs'].includes(panel)) {
    handleNavigate(panel as HomeNavigationTarget)
  }
  overviewTimer = setInterval(loadHistoryOverview, 30000)
  await Promise.all([
    botStore.fetchStatus(),
    strategiesStore.loadStrategies(),
    loadHistoryOverview()
  ])
})
</script>

<style scoped>
.container {
  /* 公共底部统一占位，首页仅使用剩余视口，避免重复预留空间。 */
  height: calc(100vh - var(--app-footer-height) - var(--app-header-height, 60px));
  height: calc(100dvh - var(--app-footer-height) - var(--app-header-height, 60px));
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.container > .el-container {
  flex: 1;
  min-height: 0;
}
/* 页面只控制三列及图表高度，组件内部样式分别由各组件维护。 */
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
  .main > .el-row > .el-col > :deep(.el-card:last-child) {
    /* 最后一张卡片不再留列底外边距，避免撑出额外滚动空间。 */
    margin-bottom: 0;
  }

  .main > .el-row > .el-col::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
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
    /* 小高度窗口保留可读的走势区域，由卡片正文滚动承接溢出。 */
    min-height: 160px;
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

  /* 两种图表引擎共用剩余空间布局，头部增高时由图表区域收缩。 */
  .market-column :deep(.kline-chart-simple-container:not(:fullscreen)),
  .market-column :deep(.tradingview-panel) {
    display: flex;
    flex-direction: column;
    height: 100%;
    margin: 0;
    transition: none;
  }

  .market-column :deep(.chart-controls-wrapper),
  .market-column :deep(.tradingview-panel > .chart-controls) {
    flex-shrink: 0;
  }

  .market-column :deep(.kline-chart-simple-container > .chart-container),
  .market-column :deep(.tradingview-panel > .chart-container) {
    flex: 1;
    min-height: 0;
  }

  .market-column :deep(.tradingview-panel .tradingview-chart) {
    height: 100% !important;
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

.main {
  padding: 20px;
}

@media (max-width: 768px) {

  .main {
    padding: 10px;
  }
}
</style>
