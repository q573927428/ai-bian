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
              :refreshing="refreshing"
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
              @refresh="refreshPanelData"
              @open="handleOpenProtectedPanel"
              @logs="handleOpenProtectedPanel('logs')"
            />

            <!-- 盈亏胜率走势图表 -->
            <ClientOnly>
              <ProfitWinRateChart />
            </ClientOnly>

          </el-col>

          <!-- 中间只放主图和共用时间轴的副图，切换右侧标签不会重建图表。 -->
          <el-col class="home-chart-column" :xs="24" :sm="24" :md="12" :lg="12">
            <section class="home-chart" aria-label="K 线和副图指标">
              <ClientOnly>
                <KLineWorkspaceChart :symbol="chartSymbol" :timeframe="chartTimeframe" :price-cards-open="priceCardsInDialog"
                  @open-price-cards="openPriceCardsDialog" @timeframe-change="selectChartTimeframe" @toolbar-height-change="chartToolbarHeight = $event" />
              </ClientOnly>
            </section>
          </el-col>

          <el-col class="workspace-sidebar" :xs="24" :sm="24" :md="6" :lg="6">
            <aside class="workspace-panel" aria-label="行情与交易面板">
              <ClientOnly>
                <el-tabs v-model="activeMarketTab" class="workspace-tabs" :style="chartToolbarHeight ? { '--home-chart-toolbar-height': `${chartToolbarHeight}px` } : undefined" stretch>
                  <el-tab-pane label="环境详情" name="environment" lazy>
                    <KLineEnvironmentPanel :symbol="chartSymbol" :timeframe="chartTimeframe" :active="activeMarketTab === 'environment'" />
                  </el-tab-pane>
                  <el-tab-pane label="价格卡片" name="prices">
                    <CryptoPriceCards :chart-symbol="chartSymbol" :chart-focus-request="chartFocusRequest"
                      :dialog-target="activePriceCardsTarget" :inactive="!activePriceCardsTarget && activeMarketTab !== 'prices'"
                      @update:chart-symbol="handlePriceChartSelect" />
                  </el-tab-pane>
                  <el-tab-pane label="当前持仓" name="positions" lazy>
                    <!-- 查看持仓沿用原有公开模式，不改变左侧解锁规则。 -->
                    <ActivePositions @select-symbol="handlePositionChartSelect" />
                  </el-tab-pane>
                  <el-tab-pane label="重要快讯" name="news" lazy>
                    <LatestNews />
                  </el-tab-pane>
                </el-tabs>
              </ClientOnly>
            </aside>
          </el-col>
        </el-row>
      </el-main>

      <!-- 抽屉和对话框独立于三栏，切换标签不影响顶部导航和解锁流程。 -->
      <ClientOnly>
        <el-dialog v-model="showPriceCardsDialog" title="价格卡片" width="min(960px, calc(100vw - 24px))"
          append-to-body align-center @closed="priceCardsInDialog = false">
          <div ref="priceCardsDialogTarget" class="price-cards-dialog-content"></div>
        </el-dialog>
        <IndicatorsList v-model="showIndicatorsDrawer" @select-symbol="handlePositionChartSelect" />
        <MacroDataDrawer v-model="showMacroDataDrawer" />
        <CryptoTrendsDrawer v-model="showCryptoTrendsDrawer" />
        <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
        <Strategies v-if="passwordVerified" v-model="showStrategiesDrawer" />
        <BotConfigDialog v-model="showConfigDialog" @success="handleConfigSuccess" />
      </ClientOnly>

    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import { useBotStore } from '../stores/bot'
import { useStrategiesStore } from '../stores/strategies'
import HomeStatusPanel from '../components/HomeStatusPanel.vue'
import { usePageUnlock } from '../composables/usePageUnlock'
import { KLINE_WORKSPACE_PERIODS, type KlineWorkspacePeriod } from '../utils/kline-indicators'
import type { HomeNavigationTarget, HomeProtectedPanel } from '../../types/home'

// 导入组件
import PasswordDialog from '../components/PasswordDialog.vue'
import CryptoPriceCards from '../components/CryptoPriceCards.vue'
import IndicatorsList from '../components/IndicatorsList.vue'
import MacroDataDrawer from '../components/MacroDataDrawer.vue'
import ActivePositions from '../components/ActivePositions.vue'
import LatestNews from '../components/LatestNews.vue'
import KLineEnvironmentPanel from '../components/KLineEnvironmentPanel.vue'
import KLineWorkspaceChart from '../components/kline-chart/KLineWorkspaceChart.vue'
import Strategies from '../components/Strategies.vue'
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
const refreshing = ref(false)

// 配置对话框
const showConfigDialog = ref(false)
const showIndicatorsDrawer = ref(false)
// 日志实例位于全局布局，首页仅在通过解锁验证后请求打开抽屉。
const showLogsDrawer = useState<boolean>('system-logs-visible', () => false)
const showMacroDataDrawer = ref(false)
const showCryptoTrendsDrawer = ref(false)
const showStrategiesDrawer = ref(false)

const { passwordVerified, showPasswordDialog, handleOpenProtectedPanel, handlePasswordSuccess } = usePageUnlock({
  onOpen: openProtectedPanel,
  onLock: () => {
    showConfigDialog.value = false
    showStrategiesDrawer.value = false
    showLogsDrawer.value = false
  }
})

/** 仅由解锁门禁调用，确保管理面板遵守一致的访问限制。 */
function openProtectedPanel(panel: HomeProtectedPanel) {
  if (panel === 'config') showConfigDialog.value = true
  else if (panel === 'strategies') showStrategiesDrawer.value = true
  else if (panel === 'logs') showLogsDrawer.value = true
  else void navigateTo(`/${panel}`)
}

/** 将导航事件映射到面板开关；指标公开浏览，管理入口仍需解锁。 */
function handleNavigate(target: HomeNavigationTarget) {
  // 首页参数也能请求打开日志，必须复用按钮的验证流程。
  if (target === 'logs') {
    handleOpenProtectedPanel('logs')
    return
  }
  if (target === 'indicators') {
    void navigateTo(`/${target}`)
    return
  }
  if (target === 'home') {
    void navigateTo('/')
    return
  }
  if (target === 'hot') {
    void navigateTo('/hot')
    return
  }
  if (target === 'orders') {
    handleOpenProtectedPanel('orders')
    return
  }
  const panels = {
    indicators: showIndicatorsDrawer,
    macro: showMacroDataDrawer,
    trends: showCryptoTrendsDrawer
  }
  panels[target].value = true
}

// 与全局通知共享图表目标，跨页面返回时仍能定位到通知中的交易对及周期。
const selectedChartSymbol = useState<string>('home-chart-symbol', () => '')
const selectedChartTimeframe = useState<string>('home-chart-timeframe', () => '')
const activeMarketTab = ref('environment')
const chartToolbarHeight = ref(0)
const showPriceCardsDialog = ref(false)
const priceCardsInDialog = ref(false)
const priceCardsDialogTarget = ref<HTMLElement | null>(null)
const activePriceCardsTarget = computed(() => priceCardsInDialog.value ? priceCardsDialogTarget.value : null)
const chartSymbol = computed(() => {
  const selected = normalizeChartSymbol(selectedChartSymbol.value)
  if (selected) return selected
  const configured = (botStore.botConfig?.symbols ?? []).map(normalizeChartSymbol).filter(Boolean)
  return configured.includes('BTCUSDT') ? 'BTCUSDT' : (configured[0] ?? '')
})
const chartTimeframe = computed<KlineWorkspacePeriod>(() =>
  KLINE_WORKSPACE_PERIODS.find(period => period === selectedChartTimeframe.value)
    ?? KLINE_WORKSPACE_PERIODS.find(period => period === botStore.botConfig?.defaultTimeframe)
    ?? '1h'
)
// 每次点击都有独立请求，重复点击当前持仓也能重新放大热力图。
const chartFocusRequest = ref<{ symbol: string; id: number }>()
let chartFocusId = 0

/** 统一处理价格卡片、持仓和全局通知提供的交易对格式。 */
function normalizeChartSymbol(symbol: string) {
  return symbol.replace('/', '').trim().toUpperCase()
}

/** 打开当前看板，关闭动画结束后再把同一个实例移回右栏。 */
function openPriceCardsDialog() {
  priceCardsInDialog.value = true
  showPriceCardsDialog.value = true
}

/** 选择价格卡片只切换交易对，不把价格涨跌筛选周期带到主图。 */
function handlePriceChartSelect(symbol: string) {
  selectedChartSymbol.value = normalizeChartSymbol(symbol)
  chartFocusRequest.value = undefined
  if (activePriceCardsTarget.value) showPriceCardsDialog.value = false
}

/** 同步主图周期给右栏，并拒绝分时等不属于 K 线的周期。 */
function selectChartTimeframe(timeframe: string) {
  if (KLINE_WORKSPACE_PERIODS.some(period => period === timeframe)) selectedChartTimeframe.value = timeframe
}

/** 点击持仓交易对时，同时定位图表交易对和该持仓的主周期。 */
function handlePositionChartSelect(symbol: string, mainTimeframe?: string) {
  const normalized = normalizeChartSymbol(symbol)
  selectedChartSymbol.value = normalized
  chartFocusRequest.value = { symbol: normalized, id: ++chartFocusId }
  // 兼容未保存主周期的旧持仓，避免向图表传入无效周期。
  if (mainTimeframe) selectChartTimeframe(mainTimeframe)
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
    if (!response.success) return false
    historyOverview.value = response.data
    return true
  } catch (error) {
    console.error('加载交易汇总失败:', error)
    return false
  }
}
useGlobalPolling(loadHistoryOverview)

/** 手动同步账户余额和统计依赖，刷新期间阻止重复请求。 */
async function refreshPanelData() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    // 状态接口会重新读取交易所余额，历史汇总和策略用于更新盈亏及年化。
    const [, overviewLoaded] = await Promise.all([
      botStore.fetchStatus(),
      loadHistoryOverview(),
      strategiesStore.loadStrategies()
    ])
    if (botStore.error || !overviewLoaded) {
      ElMessage.error(botStore.error || '交易统计刷新失败，请重试')
    }
  } catch (error) {
    console.error('刷新面板数据失败:', error)
    ElMessage.error('刷新失败，请重试')
  } finally {
    refreshing.value = false
  }
}

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

// 首页统计首屏立即加载，后续与全局状态共用刷新节拍。
onMounted(async () => {
  // 从订单页共用导航返回时，恢复用户刚点击的行情面板。
  const panel = route.query.panel
  if (typeof panel === 'string' && ['indicators', 'hot', 'macro', 'trends', 'logs'].includes(panel)) {
    handleNavigate(panel as HomeNavigationTarget)
  }
  await Promise.all([
    strategiesStore.loadStrategies(),
    loadHistoryOverview()
  ])
})
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
}

.container > .el-container {
  flex: 1;
  min-height: 0;
}
.main { padding: 20px; }

.price-cards-dialog-content {
  height: min(540px, 68dvh);
}

.home-chart,
.workspace-panel {
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--bg-card);
}

.workspace-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
  padding: 0 4px;
}

.workspace-tabs :deep(.el-tabs__item) {
  padding-inline: 4px;
  font-size: clamp(12px, 1vw, 14px);
}

/* 每次只显示一个标签，当前内容填满右栏，长列表在组件正文内滚动。 */
.workspace-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.workspace-tabs :deep(.el-tab-pane) { height: 100%; }
.workspace-tabs :deep(.price-grid-card:not(.price-grid-card-expanded)),
.workspace-tabs :deep(.active-positions-card),
.workspace-tabs :deep(.latest-news-card) {
  height: 100%;
  max-height: none;
  margin: 0;
  border: 0;
  box-shadow: none;
}
.workspace-tabs :deep(.latest-news-card .news-list) { height: auto; }

@media (min-width: 992px) {
  .container {
    /* 桌面端沿用首页的视口占位，左侧布局尺寸保持不变。 */
    height: calc(100vh - var(--app-footer-height) - var(--app-header-height, 60px));
    height: calc(100dvh - var(--app-footer-height) - var(--app-header-height, 60px));
    overflow: hidden;
  }
  .main { min-height: 0; overflow: hidden; }
  .main > .el-row,
  .main > .el-row > .el-col { height: 100%; min-height: 0; }
  .main > .el-row > .el-col { min-width: 0; overflow: hidden; }

  /* 工具栏因宽度或图层开关换行时，右侧标签栏也保持同一条分界线。 */
  .workspace-tabs { --el-tabs-header-height: var(--home-chart-toolbar-height, 63px); }
  .workspace-tabs :deep(.el-tabs__nav-wrap) { margin-bottom: 0; }

  .overview-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .overview-column > :deep(.card) {
    flex: 0 0 auto;
    margin-bottom: 0;
  }

  .overview-column > :deep(.chart-card) {
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
}

@media (min-width: 992px) and (max-height: 520px) {
  .main { overflow: auto; }
  .main > .el-row { min-height: 420px; }
}

@media (max-width: 991px) {
  /* 窄屏沿用单列顺序；图表和标签保留独立高度，页面可继续向下滚动。 */
  .home-chart { height: clamp(450px, 65dvh, 680px); margin-bottom: 20px; }
  .workspace-panel { height: clamp(380px, 60dvh, 620px); }
}

@media (max-width: 768px) {
  .main { padding: 10px; }
}
</style>
