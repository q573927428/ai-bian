<template>
  <el-card class="chart-card" shadow="hover">
    <!-- K线图表（引擎可切换：自研K线 / TradingView） -->
    <ClientOnly>
      <ChartEngineSwitcher :symbol="selectedSymbol || 'BTCUSDT'" :timeframe="props.chartTimeframe" />
    </ClientOnly>
    
    <!-- 水平线 -->
    <div class="horizontal-line"></div>
  </el-card>

  <Teleport to="body" :disabled="!isBoardExpanded">
  <el-card class="price-grid-card" :class="{ 'price-grid-card-expanded': isBoardExpanded }" shadow="hover">
    <template #header>
      <div class="price-cards-header">
        <div class="price-cards-heading">
          <el-input
            v-model="symbolSearch"
            class="price-symbol-search"
            size="small"
            placeholder="搜索代币"
            aria-label="搜索代币"
            clearable
          >
            <template #prefix><el-icon><ElIconSearch /></el-icon></template>
          </el-input>
          <el-radio-group v-model="viewMode" size="small" aria-label="价格看板显示方式">
            <el-radio-button value="cards" title="卡片视图">卡</el-radio-button>
            <el-radio-button value="heatmap" title="热力图视图">图</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="changePeriod" size="small" aria-label="涨跌幅周期">
            <el-radio-button value="5m">5m</el-radio-button>
            <el-radio-button value="15m">15m</el-radio-button>
            <el-radio-button value="1h">1h</el-radio-button>
            <el-radio-button value="4h">4h</el-radio-button>
            <el-radio-button value="24h">24h</el-radio-button>
          </el-radio-group>
          <div class="price-counts" :title="`按已选交易对的${changePeriod}实时涨跌幅统计；AI使用每轮固定快照；上涨占比和中位数仅计算有效行情（含持平）；所有周期参考价取本地5m K线（24h为滚动窗口）；参考价快照时间：${breadthSnapshot ? new Date(breadthSnapshot.computedAt).toLocaleString() : '待更新'}`">
            <button type="button" class="count-filter" :class="{ 'is-active': priceFilter === 'all' }" :aria-pressed="priceFilter === 'all'" title="显示全部交易对" @click="priceFilter = 'all'">总 {{ DEFAULT_CRYPTOS.length }}</button>
            <button type="button" class="count-filter count-up" :class="{ 'is-active': priceFilter === 'up' }" :aria-pressed="priceFilter === 'up'" title="仅显示上涨交易对" @click="priceFilter = 'up'">涨 {{ priceCounts.up }}</button>
            <button type="button" class="count-filter count-down" :class="{ 'is-active': priceFilter === 'down' }" :aria-pressed="priceFilter === 'down'" title="仅显示下跌交易对" @click="priceFilter = 'down'">跌 {{ priceCounts.down }}</button>
            <span title="上涨交易对占有效行情的比例（含持平）">涨比 {{ priceCounts.upRatio === null ? '—' : `${priceCounts.upRatio.toFixed(0)}%` }}</span>
            <span title="当前周期有效行情的涨跌幅中位数" :class="{ 'count-up': (priceCounts.median ?? 0) > 0, 'count-down': (priceCounts.median ?? 0) < 0 }">
              中位 {{ priceCounts.median === null ? '—' : formatPercent(priceCounts.median) }}
            </span>
            <span v-if="priceCounts.pending" title="当前周期尚无有效行情的交易对数量">待更 {{ priceCounts.pending }}</span>
          </div>
        </div>
        <div class="price-board-actions">
        <div v-if="viewMode === 'heatmap'" class="heatmap-header-actions">
          <el-tooltip placement="bottom" effect="dark">
            <template #content>
              <div class="heatmap-help">
                <div>颜色 = {{ changePeriod }} 涨跌幅</div>
                <div class="heatmap-help-legend">
                  <span v-for="entry in heatmapLegend" :key="entry.label" :style="{ backgroundColor: entry.color }">{{ entry.label }}</span>
                </div>
                <div>灰色：持平 / 待更新 · 点击查看 K 线</div>
                <div>点击分组放大 · 滚轮缩放 · 拖动平移 · 右下角复位</div>
              </div>
            </template>
            <button type="button" class="heatmap-help-button" aria-label="热力图颜色说明">?</button>
          </el-tooltip>
          <el-select
          v-model="heatmapSizeMode"
          class="heatmap-size-select"
          size="small"
          aria-label="热力图区块大小"
        >
          <el-option label="涨跌幅" value="change" />
          <el-option label="成交额" value="volume" />
          <el-option label="等面积" value="equal" />
          </el-select>
        </div>
        <button
          ref="boardExpandButton"
          type="button"
          class="board-expand-button"
          :title="isBoardExpanded ? '还原看板（Esc）' : '放大看板至整个页面'"
          :aria-label="isBoardExpanded ? '还原价格看板' : '放大价格看板至整个页面'"
          :aria-pressed="isBoardExpanded"
          @click="toggleBoardExpanded"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path v-if="isBoardExpanded" d="M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6" />
            <path v-else d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />
          </svg>
        </button>
        </div>
      </div>
    </template>
    <template #default>
    <!-- 显式声明正文插槽，让交易对网格与标题插槽保持独立。 -->
    <!-- 价格卡片网格 -->
    <div
      ref="boardContentElement"
      class="price-board-content"
      :style="{ '--cards-viewport-height': `${cardGridHeight}px` }"
    >
    <PriceHeatmap
      v-if="viewMode === 'heatmap' && filteredCryptoPrices.length"
      :items="heatmapItems"
      :search-query="normalizedSymbolSearch"
      :period="changePeriod"
      :selected-symbol="selectedSymbol"
      :height="cardGridHeight"
      :size-mode="heatmapSizeMode"
      :volume-window-end="periodVolumes?.windowEnd"
      @select="selectHeatmapSymbol"
    />
    <!-- 独立基准网格使用完整行情，搜索和涨跌筛选不能改变看板高度。 -->
    <div
      v-for="grid in cardGrids"
      :key="grid.kind"
      v-show="grid.kind === 'baseline' || viewMode === 'cards'"
      :class="grid.kind === 'baseline' ? 'cards-measure-host' : 'cards-scroll'"
      :aria-hidden="grid.kind === 'baseline' || viewMode === 'heatmap'"
      :tabindex="grid.kind === 'display' && viewMode === 'cards' ? 0 : undefined"
      :role="grid.kind === 'display' && viewMode === 'cards' ? 'region' : undefined"
      :aria-label="grid.kind === 'display' && viewMode === 'cards' ? '价格卡片，可上下滚动浏览全部交易对' : undefined"
    >
    <div
      :ref="element => setBaselineGridElement(grid.kind, element)"
      class="cards-grid"
      :class="{ 'cards-grid-baseline': grid.kind === 'baseline' }"
    >
      <div 
        v-for="crypto in grid.items"
        :key="crypto.symbol"
        :data-symbol="crypto.symbol"
        class="price-card"
        :class="{
          'price-up': (getChangePercent(crypto.symbol) ?? 0) > 0,
          'price-down': (getChangePercent(crypto.symbol) ?? 0) < 0,
          'is-selected': crypto.symbol === selectedSymbol
        }"
        @click="openChartModal(crypto)"
      >
        <el-badge
          v-if="isTradFi(crypto.symbol)"
          class="tradfi-badge"
          value="T"
          type="warning"
          title="TradFi"
          aria-label="TradFi"
        />
        <div class="price-card-header">
        <div class="crypto-info">
        <div class="crypto-symbol">
            <template v-if="!iconFailed[crypto.symbol] && cryptoIconUrl(crypto.symbol)">
              <img 
                :src="cryptoIconUrl(crypto.symbol)" 
                :alt="getSymbolDisplay(crypto.symbol)"
                class="crypto-icon"
                @error="onIconError(crypto.symbol)"
              />
            </template>
            <span v-else
              class="crypto-icon-placeholder"
              :style="{ backgroundColor: getRandomColor(crypto.symbol) }"
            >{{ getSymbolDisplay(crypto.symbol).substring(0, 1).toUpperCase() }}</span>
              {{ getSymbolDisplay(crypto.symbol) }}
            </div>
          </div>
          <div class="price-change" :class="{ positive: (getChangePercent(crypto.symbol) ?? 0) > 0, negative: (getChangePercent(crypto.symbol) ?? 0) < 0 }">
            {{ getChangePercent(crypto.symbol) === null ? '待更新' : formatPercent(getChangePercent(crypto.symbol)!) }}
          </div>
        </div>

        <div class="price-card-body">
          <div 
            class="current-price" 
            :class="{
              'price-up-animation': priceChangeAnimations[crypto.symbol] === 'up',
              'price-down-animation': priceChangeAnimations[crypto.symbol] === 'down'
            }"
          >
            ${{ formatPrice(crypto.price) }}
            <span class="volume-24h">{{ formatVolume(crypto.volume24h) }}</span>
          </div>
        </div>

      </div>
    </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading && cryptoPrices.length === 0" class="loading-state">
      <el-skeleton :rows="3" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!isLoading && cryptoPrices.length === 0" class="empty-state">
      <el-empty description="暂无价格数据" :image-size="64" />
    </div>
    <div v-else-if="!isLoading && filteredCryptoPrices.length === 0" class="empty-state">
      <el-empty :description="symbolSearch.trim() ? '未找到匹配的代币' : priceFilter === 'up' ? '当前周期暂无上涨交易对' : '当前周期暂无下跌交易对'" :image-size="64" />
    </div>
    </div>
    </template>
  </el-card>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, type ComponentPublicInstance } from 'vue'
import ChartEngineSwitcher from '../components/kline-chart/ChartEngineSwitcher.vue'
import PriceHeatmap from './PriceHeatmap.vue'
import { getHeatmapLegend } from '../utils/price-heatmap-colors'
import { formatPrice } from './kline-chart/utils/kline-formatters'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import type { MarketBreadthSnapshot } from '../../types/market-breadth'
import type { MarketPeriodVolumes } from '../../types/market-period-volumes'
import { calculateLiveBreadth } from '../utils/market-breadth'

const props = defineProps<{
  /** 由外部指定要展示的交易对，例如点击当前持仓时传入。 */
  chartSymbol?: string
  /** 持仓对应的主周期，传递给当前图表引擎。 */
  chartTimeframe?: string
}>()

const emit = defineEmits<{
  /** 手动选择价格卡片后，将最新交易对同步给首页。 */
  'update:chartSymbol': [symbol: string]
}>()

const botStore = useBotStore()
const isBoardExpanded = ref(false)
const boardExpandButton = ref<HTMLButtonElement | null>(null)
let previousBodyOverflow = ''

/** 整个看板移至页面顶层并铺满视口，保留组件实例和当前筛选、缩放状态。 */
function toggleBoardExpanded() {
  if (!isBoardExpanded.value) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = previousBodyOverflow
  }
  isBoardExpanded.value = !isBoardExpanded.value
  // Teleport 移动节点后恢复按钮焦点，方便继续使用键盘切换。
  void nextTick(() => boardExpandButton.value?.focus({ preventScroll: true }))
}

/** 支持通过 Esc 返回原布局；已由下拉框等控件处理的按键不再重复处理。 */
function handleBoardEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && isBoardExpanded.value) {
    toggleBoardExpanded()
  }
}

const { getCoinIconUrl } = useCoinIcon()
const contractTypes = ref<Record<string, string>>({})

/** 单独加载低频合约元数据，失败时仍保留实时价格展示。 */
async function loadContractTypes() {
  try {
    const response = await $fetch<{ contractTypes: Record<string, string> }>('/api/binance/contract-types')
    contractTypes.value = response.contractTypes
  } catch (error) {
    console.warn('[Price] 获取合约类型失败:', error)
  }
}

/** 仅按官方合约类型标记，避免通过币种名称误判传统金融合约。 */
function isTradFi(symbol: string): boolean {
  return contractTypes.value[symbol.replace('/', '').trim().toUpperCase()] === 'TRADIFI_PERPETUAL'
}

// 从配置文件获取加密货币列表，处理去掉/。
const DEFAULT_CRYPTOS = computed<string[]>((previousSymbols) => {
  const configuredSymbols = botStore.config?.symbols
  const symbols = Array.isArray(configuredSymbols)
    ? [...new Set<string>(configuredSymbols.map((symbol: string) => symbol.replace('/', '').trim().toUpperCase()).filter(Boolean))]
    : []
  // 状态刷新会替换整个配置对象；列表内容和顺序未变时复用旧引用，
  // 避免误触发下方配置变更监听，清空快照后让统计、热力图和图表布局短暂跳动。
  if (previousSymbols && symbols.length === previousSymbols.length
    && symbols.every((symbol, index) => symbol === previousSymbols[index])) {
    return previousSymbols
  }
  return symbols
})

// 响应式数据
const cryptoPrices = ref<CryptoPrice[]>([])
const isLoading = ref(false)
const showChartModal = ref(false)
const selectedSymbol = ref('')
const boardContentElement = ref<HTMLElement | null>(null)
const baselineGridElement = ref<HTMLElement | null>(null)
const cardGridHeight = ref(128)
let cardGridResizeObserver: ResizeObserver | undefined
const viewMode = ref<'cards' | 'heatmap'>('cards')
// 大小模式由标题栏控制，切换卡片视图后仍保留当前选择。
const heatmapSizeMode = ref<'change' | 'volume' | 'equal'>('change')
const VIEW_MODE_KEY = 'price-board-view-mode'
const priceFilter = ref<'all' | 'up' | 'down'>('all')
const symbolSearch = ref('')
// 兼容大小写和 BTC/USDT 写法；搜索只筛选展示，市场统计始终覆盖全部已选交易对。
const normalizedSymbolSearch = computed(() => symbolSearch.value.replace(/[\s/]/g, '').toUpperCase())
const changePeriod = ref<'5m' | '15m' | '1h' | '4h' | '24h'>('1h')
const heatmapLegend = computed(() => getHeatmapLegend(changePeriod.value))
const breadthSnapshot = ref<MarketBreadthSnapshot | null>(null)
const periodVolumes = ref<MarketPeriodVolumes | null>(null)
let volumeRequestId = 0
const breadthClock = ref(Date.now())
let breadthRequestId = 0

// 所有周期（含滚动24h）复用服务端本地5m基准，结合实时价格重算。
const activeBreadth = computed(() => {
  const snapshot = breadthSnapshot.value
  const validSnapshot = snapshot && breadthClock.value < snapshot.expiresAt
    && JSON.stringify([...DEFAULT_CRYPTOS.value].sort()) === JSON.stringify(snapshot.symbols)
  const stats = validSnapshot ? snapshot.periods[changePeriod.value] : null
  return calculateLiveBreadth(DEFAULT_CRYPTOS.value, botStore.prices, changePeriod.value,
    stats?.bases ?? {}, stats?.referenceTime ?? null, Math.max(breadthClock.value, Date.now()))
})

/** 卡片与标题共享实时聚合结果，实时价格更新即触发重算。 */
function getChangePercent(symbol: string): number | null {
  return activeBreadth.value?.changes[symbol] ?? null
}

/** 获取共享快照；丢弃配置变更或卸载前发出的旧请求。 */
async function loadMarketBreadth() {
  const requestId = ++breadthRequestId
  breadthClock.value = Date.now()
  try {
    const result = await $fetch<MarketBreadthSnapshot>('/api/market/breadth')
    if (requestId === breadthRequestId) {
      breadthSnapshot.value = result
      breadthClock.value = Date.now()
    }
  } catch (error) {
    console.warn('[Price] 获取市场广度失败:', error)
  }
}

/** 仅在成交额热力图可见时读取多周期本地快照，丢弃配置变化或卸载前的请求。 */
async function loadPeriodVolumes() {
  if (viewMode.value !== 'heatmap' || heatmapSizeMode.value !== 'volume') return
  const requestId = ++volumeRequestId
  try {
    const result = await $fetch<MarketPeriodVolumes>('/api/market/period-volumes')
    if (requestId === volumeRequestId) periodVolumes.value = result
  } catch (error) {
    console.warn('[Price] 获取周期成交额失败:', error)
  }
}

watch([viewMode, heatmapSizeMode], () => {
  if (import.meta.client) void loadPeriodVolumes()
})

watch(DEFAULT_CRYPTOS, () => {
  breadthRequestId++
  breadthSnapshot.value = null
  volumeRequestId++
  periodVolumes.value = null
  syncPricesFromStore()
  if (import.meta.client) void loadMarketBreadth()
  if (import.meta.client) void loadPeriodVolumes()
})
const heatmapMeasureCount = ref(21)
// 价格变动动画状态
const priceChangeAnimations = ref<Record<string, 'up' | 'down' | null>>({})

// 标题复用浏览器实时聚合结果，AI 仍读取服务端固定快照。
const priceCounts = computed(() => {
  const stats = activeBreadth.value
  return {
    up: stats?.upCount ?? 0, down: stats?.downCount ?? 0,
    pending: stats?.missingCount ?? DEFAULT_CRYPTOS.value.length,
    upRatio: stats?.upRatioPct ?? null, median: stats?.medianChangePct ?? null
  }
})
// 筛选与头部统计共用当前周期涨跌幅，持平和待更新行情只在“总”中显示。
const filteredCryptoPrices = computed(() => cryptoPrices.value.filter((crypto) => {
  // 热力图搜索由图内高亮和定位处理，保留全市场面积及位置关系。
  if (viewMode.value === 'cards' && !crypto.symbol.includes(normalizedSymbolSearch.value)) return false
  if (priceFilter.value === 'all') return true
  const change = getChangePercent(crypto.symbol)
  return change !== null && (priceFilter.value === 'up' ? change > 0 : change < 0)
}))
// 热力图复用筛选后的完整行情；无基准行情保持 null，避免误报持平。
const heatmapItems = computed(() => filteredCryptoPrices.value.map((crypto) => ({
  symbol: crypto.symbol,
  name: getSymbolDisplay(crypto.symbol),
  price: crypto.price,
  // 热力图成交额跟随当前周期；缺失本地成交额时不退回 24h ticker。
  volume: periodVolumes.value && Date.now() < periodVolumes.value.expiresAt
    ? periodVolumes.value.periods[changePeriod.value][crypto.symbol] ?? null : null,
  change: getChangePercent(crypto.symbol),
  group: isTradFi(crypto.symbol) ? '传统金融' : '加密资产',
  icon: cryptoIconUrl(crypto.symbol)
})))

/** 热力图区块与卡片共用图表选择入口。 */
function selectHeatmapSymbol(symbol: string) {
  const crypto = cryptoPrices.value.find((item) => item.symbol === symbol)
  if (crypto) openChartModal(crypto)
}

watch(viewMode, (mode) => {
  // 浏览器禁用存储时仍允许正常切换视图。
  try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* 忽略存储不可用。 */ }
  void nextTick(measureOriginalPageHeight)
})
// 展示网格遵循筛选；基准网格始终取完整行情的一页，两者共用卡片模板以保持尺寸一致。
const cardGrids = computed(() => [
  { kind: 'display' as const, items: viewMode.value === 'cards' ? filteredCryptoPrices.value : [] },
  { kind: 'baseline' as const, items: cryptoPrices.value.slice(0, heatmapMeasureCount.value) }
])

/** 仅滚动卡片容器，避免 scrollIntoView 连带移动页面和上方 K 线。 */
async function locateSelectedCard() {
  await nextTick()
  if (viewMode.value !== 'cards' || !selectedSymbol.value) return
  const scroller = boardContentElement.value?.querySelector<HTMLElement>('.cards-scroll')
  const card = Array.from(scroller?.querySelectorAll<HTMLElement>('.price-card') ?? [])
    .find(element => element.dataset.symbol === selectedSymbol.value)
  if (!scroller || !card) return
  const viewport = scroller.getBoundingClientRect()
  const rect = card.getBoundingClientRect()
  // 已完整可见时不移动，便于连续点击；超出视口时将选中卡片放到中间。
  if (rect.top >= viewport.top + 8 && rect.bottom <= viewport.bottom - 8) return
  scroller.scrollTo({
    top: scroller.scrollTop + rect.top - viewport.top - (scroller.clientHeight - rect.height) / 2,
    behavior: 'smooth'
  })
}

// 只监听选择、模式及结果成员变化，实时价格刷新不能反复拉回用户的滚动位置。
watch([selectedSymbol, viewMode, () => filteredCryptoPrices.value.map(item => item.symbol).join(',')],
  () => { void locateSelectedCard() }, { flush: 'post' })

/** 仅保存独立基准网格的节点，展示网格的增删不会影响高度测量。 */
function setBaselineGridElement(kind: 'display' | 'baseline', element: Element | ComponentPublicInstance | null) {
  if (kind === 'baseline') baselineGridElement.value = element as HTMLElement | null
}

/** 保留热力图原有的响应式测量样本数量，不限制卡片展示数量。 */
function updateHeatmapMeasureCount() {
  if (!import.meta.client) return
  heatmapMeasureCount.value = window.innerWidth <= 480 ? 16 : 21
  void nextTick(measureOriginalPageHeight)
}

/** 测量完整行情的独立基准网格，搜索、筛选和滚动均不参与高度计算。 */
function measureOriginalPageHeight() {
  // 保留小数像素，避免字体行高在取整后改变原看板高度。
  const height = baselineGridElement.value?.getBoundingClientRect().height ?? 0
  if (height > 0 && height !== cardGridHeight.value) cardGridHeight.value = height
}

// 从 botStore 共享价格获取数据（自动更新）
function syncPricesFromStore() {
  const prices = botStore.prices
  if (Object.keys(prices).length > 0) {
    updateCryptoPrices(prices)
  }
}

// 监听store价格变化
watch(() => botStore.prices, () => {
  syncPricesFromStore()
}, { deep: true })

// 外部切换入口与价格卡片共用同一个图表状态，并统一兼容 BTC/USDT 与 BTCUSDT 写法。
watch(() => props.chartSymbol, (symbol) => {
  if (symbol) {
    selectedSymbol.value = symbol.replace('/', '').toUpperCase()
  }
}, { immediate: true })

// 更新加密货币价格
function updateCryptoPrices(prices: Record<string, any>) {
  const updatedPrices: CryptoPrice[] = []
  
  DEFAULT_CRYPTOS.value.forEach((symbol: string) => {
    const priceData = prices[symbol]
    if (priceData) {
      // 获取当前价格用于比较
      const currentCrypto = cryptoPrices.value.find(c => c.symbol === symbol)
      const oldPrice = currentCrypto?.price || 0
      const newPrice = priceData.price || 0
      
      // 检测价格变动方向
      if (oldPrice > 0 && newPrice > 0) {
        if (newPrice > oldPrice) {
          // 价格上涨
          triggerPriceAnimation(symbol, 'up')
        } else if (newPrice < oldPrice) {
          // 价格下跌
          triggerPriceAnimation(symbol, 'down')
        }
      }
      
      updatedPrices.push({
        symbol,
        price: newPrice,
        change24hPercent: priceData.change24hPercent || 0,
        volume24h: priceData.volume24h || 0,
        lastUpdate: priceData.timestamp || Date.now()
      })
    } else {
      // 如果没有数据，使用默认值
      updatedPrices.push({
        symbol,
        price: 0,
        change24hPercent: 0,
        volume24h: 0,
        lastUpdate: Date.now()
      })
    }
  })
  
  cryptoPrices.value = updatedPrices
}

// 触发价格变动动画
function triggerPriceAnimation(symbol: string, direction: 'up' | 'down') {
  // 设置动画状态
  priceChangeAnimations.value[symbol] = direction
  
  // 1.5秒后清除动画状态
  if (import.meta.client) {
    setTimeout(() => {
      priceChangeAnimations.value[symbol] = null
    }, 1500)
  }
}

/**
 * 切换价格卡片对应的图表，并同步父页面状态，确保后续持仓点击能够再次触发切换。
 */
function openChartModal(crypto: CryptoPrice) {
  selectedSymbol.value = crypto.symbol
  emit('update:chartSymbol', crypto.symbol)
  showChartModal.value = true
}

// 关闭图表弹窗
function closeChartModal() {
  showChartModal.value = false
  selectedSymbol.value = ''
  emit('update:chartSymbol', '')
}

// 格式化函数
function formatPercent(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}

function formatVolume(volume: number): string {
  if (volume >= 1000000000) {
    return `${(volume / 1000000000).toFixed(2)}B`
  } else if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(2)}M`
  } else if (volume >= 1000) {
    return `${(volume / 1000).toFixed(2)}K`
  } else {
    return volume.toFixed(2)
  }
}

function getSymbolDisplay(symbol: string): string {
  return symbol.replace('USDT', '')
}

// 获取加密货币图标（由币安官方清单驱动；无图标时返回空串，触发占位符显示）
function cryptoIconUrl(symbol: string): string {
  return getCoinIconUrl(symbol) || ''
}

// 记录加载失败的图标（true=加载失败，显示占位符）
const iconFailed = ref<Record<string, boolean>>({})

// 图标加载失败时标记，自动切换到占位符
function onIconError(symbol: string) {
  iconFailed.value[symbol] = true
}

// 为币种生成稳定的随机颜色
function getRandomColor(symbol: string) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i)
    hash |= 0
  }
  const color = Math.abs(hash).toString(16).substring(0, 6).padStart(6, '0')
  return `#${color}`
}


useGlobalPolling(loadMarketBreadth)
useGlobalPolling(loadPeriodVolumes, () => viewMode.value === 'heatmap' && heatmapSizeMode.value === 'volume')

// 组件生命周期
onMounted(() => {
  window.addEventListener('keydown', handleBoardEscape)
  // 按原来一页的卡片实际布局测量，保持取消分页前的高度与响应式行数。
  if (baselineGridElement.value) {
    cardGridResizeObserver = new ResizeObserver(measureOriginalPageHeight)
    cardGridResizeObserver.observe(baselineGridElement.value)
    if (boardContentElement.value) cardGridResizeObserver.observe(boardContentElement.value)
  }
  try {
    if (localStorage.getItem(VIEW_MODE_KEY) === 'heatmap') viewMode.value = 'heatmap'
  } catch { /* 存储不可用时使用默认卡片视图。 */ }
  void loadMarketBreadth()
  void loadContractTypes()
  // 订阅 botStore 共享价格更新，自动同步价格
  botStore.subscribeToPrices('crypto-price-cards')
  updateHeatmapMeasureCount()
  window.addEventListener('resize', updateHeatmapMeasureCount)
  // 首次加载
  syncPricesFromStore()
})

onUnmounted(() => {
  volumeRequestId++
  cardGridResizeObserver?.disconnect()
  breadthRequestId++
  botStore.unsubscribeFromPrices('crypto-price-cards')
  if (import.meta.client) {
    window.removeEventListener('keydown', handleBoardEscape)
    // 离开页面时也必须释放滚动锁，避免影响其他页面。
    if (isBoardExpanded.value) document.body.style.overflow = previousBodyOverflow
    window.removeEventListener('resize', updateHeatmapMeasureCount)
  }
})

/** 看板中单个交易对的实时价格与成交量。 */
interface CryptoPrice {
  symbol: string
  price: number
  change24hPercent: number
  volume24h: number
  lastUpdate: number
}

</script>

<style scoped>
.chart-card,
.price-grid-card {
  margin-bottom: 20px;
}

/* 整个组件占满浏览器页面；工具栏保留高度，正文使用剩余空间。 */
.price-grid-card-expanded {
  position: fixed;
  /* 公共行情栏固定在底部，展开区域需扣除其高度及移动端安全区。 */
  inset: 0 0 var(--app-footer-height, 0px);
  z-index: 2000;
  box-sizing: border-box;
  height: calc(100dvh - var(--app-footer-height, 0px));
  margin: 0;
  border-radius: 0;
  display: flex;
  flex-direction: column;
}

.price-grid-card-expanded :deep(.el-card__header) {
  flex-shrink: 0;
}

.price-grid-card-expanded :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.price-grid-card-expanded .price-board-content {
  flex: 1;
  min-height: 0;
  height: auto;
  margin: 0;
}

.price-grid-card-expanded :deep(.price-heatmap) {
  /* 覆盖普通布局按卡片测得的固定高度，让热力图随正文一起展开。 */
  height: 100% !important;
  margin: 0;
}

.price-board-actions {
  /* 统一吸收头部剩余空间，避免多个 auto 外边距把右侧控件分散。 */
  position: sticky;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
  /* 跟随卡片实际背景；项目深色主题未覆盖通用 --el-bg-color。 */
  background: var(--el-card-bg-color);
}

.board-expand-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.board-expand-button:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.board-expand-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.price-cards-header {
  display: flex;
  flex-wrap: nowrap;
  /* 窄窗口横向滚动，保持搜索、周期和全部市场统计在同一行。 */
  overflow-x: auto;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin: -5px 0;
}

.price-cards-heading {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
}

.price-cards-heading > * {
  flex-shrink: 0;
}

.price-counts {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.count-up,
.count-filter.count-up {
  color: var(--color-success);
}

.count-filter {
  padding: 1px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.count-filter:hover,
.count-filter.is-active {
  border-color: currentColor;
  background: var(--el-fill-color-light);
}

.count-filter:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.count-down,
.count-filter.count-down {
  color: var(--color-danger);
}

.price-symbol-search {
  width: 110px;
}

.heatmap-help-button {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--text-secondary);
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 14px;
  cursor: help;
}

.heatmap-help-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.heatmap-help {
  font-size: 11px;
  line-height: 1.6;
}

.heatmap-help-legend {
  display: flex;
  gap: 2px;
  margin: 6px 0;
}

.heatmap-help-legend span {
  padding: 1px 4px;
  color: #fff;
  text-align: center;
}

.heatmap-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.heatmap-size-select {
  width: 80px;
  flex-shrink: 0;
}

.cards-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.price-board-content {
  position: relative;
  /* 两种模式共用原一页的高度和负边距，保持看板外部尺寸一致。 */
  height: var(--cards-viewport-height);
  margin: -10px;
}

.price-board-content :deep(.price-heatmap) {
  height: 100% !important;
  margin: 0;
}

/* 仅正文滚动，让搜索、周期和统计始终可用；留出角标和悬浮效果的空间。 */
.cards-scroll {
  position: absolute;
  inset: -10px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 10px;
}

/* 零高度容器裁剪测量网格，保留内部真实布局，同时避免产生空白滚动范围。 */
.cards-measure-host {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  visibility: hidden;
  pointer-events: none;
  height: 0;
  overflow: hidden;
}

/* 高度沿用原分页布局的 116px 最小宽度，避免展示卡片加宽后多算一行。 */
.cards-grid-baseline .price-card {
  min-width: 116px;
}
.horizontal-line{
  margin-bottom: 30px;
}

.price-card {
  background: var(--price-card-bg);
  border: 1px solid var(--price-card-border);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: visible;
  min-height: 60px;
  min-width: 130px;
  flex-shrink: 0;
  flex: 1 0 calc(12% - 8px);
}

.price-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--color-primary);
}

/* 角标悬挂在卡片右上角边界外，不占用卡片内容空间。 */
.tradfi-badge {
  position: absolute;
  top: 0;
  right: 0;
  transform: translate(50%, -30%);
  z-index: 1;
}

.tradfi-badge :deep(.el-badge__content) {
  padding: 0 4px;
  height: 15px;
  font-size: 10px;
  line-height: 15px;
  color: #fff;
}

.price-card.price-up:hover {
  border-color: var(--price-up-hover-border);
  box-shadow: 0 4px 12px var(--price-up-hover-shadow);
}

.price-card.price-down:hover {
  border-color: var(--price-down-hover-border);
  box-shadow: 0 4px 12px var(--price-down-hover-shadow);
}

/* 用内描边补足 3px 选中框，保持卡片尺寸和高度测量不变；悬停也保留蓝框。 */
.price-card.is-selected,
.price-card.is-selected:hover {
  border-color: #66b1ff;
  box-shadow: inset 0 0 0 2px #66b1ff;
}

.price-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.crypto-info {
  display: flex;
  flex-direction: column;
}

.crypto-symbol {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}

.crypto-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}

.crypto-icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
  line-height: 1;
}

.price-change {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 2px;
}

.price-change.positive {
  background: rgba(103, 194, 58, 0.1);
  color: var(--color-success);
}

.price-change.negative {
  background: rgba(245, 108, 108, 0.1);
  color: var(--color-danger);
}

.current-price {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 4px;
  transition: all 0.3s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 简洁的价格上涨动画 */
.price-up-animation {
  animation: priceUpEffect 0.3s ease;
  color: var(--color-success) !important;
}

/* 简洁的价格下跌动画 */
.price-down-animation {
  animation: priceDownEffect 0.3s ease;
  color: var(--color-danger) !important;
}

@keyframes priceUpEffect {
  0% {
    transform: scale(1);
    color: var(--color-success);
  }
  50% {
    transform: scale(1.05);
    color: var(--color-success);
  }
  100% {
    transform: scale(1);
    color: var(--color-success);
  }
}

@keyframes priceDownEffect {
  0% {
    transform: scale(1);
    color: var(--color-danger);
  }
  50% {
    transform: scale(1.05);
    color: var(--color-danger);
  }
  100% {
    transform: scale(1);
    color: var(--color-danger);
  }
}

.volume-24h {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 6px;
}

.price-card-footer {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  margin-bottom: 8px;
}

.price-range {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.range-item {
  display: flex;
  flex-direction: column;
}

.range-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.range-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
}

.volume-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.volume-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.volume-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
}

.last-update {
  font-size: 10px;
  color: var(--text-placeholder);
  text-align: right;
  margin-top: 4px;
}

.loading-state,
.empty-state {
  padding: 40px 0;
  text-align: center;
}

/* 空搜索结果仍使用原有可见区域，不能额外撑高看板。 */
.price-board-content > .loading-state,
.price-board-content > .empty-state {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 0;
}

/* 空状态使用紧凑插图和留白，避免默认大插图超过原卡片区域而出现滚动条。 */
.price-board-content > .empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.empty-state :deep(.el-empty) {
  padding: 8px 0;
}

.empty-state :deep(.el-empty__description) {
  margin-top: 8px;
}

@media (max-width: 768px) {
  /* 手机按操作层级排成三行，避免右侧按钮独占一行留下大片空白。 */
  .price-cards-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 26px;
    overflow-x: visible;
  }

  .price-cards-heading,
  .price-board-actions {
    display: contents;
  }

  .price-symbol-search { grid-area: 1 / 1; width: 100%; max-width: 150px; }
  .price-cards-heading > [aria-label="价格看板显示方式"] { grid-area: 1 / 2; }
  .board-expand-button { grid-area: 1 / 3; }
  .price-cards-heading > [aria-label="涨跌幅周期"] { grid-area: 2 / 1; }
  .heatmap-header-actions { grid-area: 2 / 2 / 3 / 4; justify-self: end; gap: 6px; }
  .price-cards-heading :deep(.el-radio-button__inner) { padding: 5px 8px; }

  .price-counts {
    grid-area: 3 / 1 / 4 / -1;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
}

@media (max-width: 360px) {
  /* 极窄屏把热力图选项下移，优先保证周期按钮和统计完整可读。 */
  .price-cards-heading > [aria-label="涨跌幅周期"] { grid-column: 1 / -1; }
  .heatmap-header-actions { grid-area: 4 / 1 / 5 / -1; }
}

@media (max-width: 480px) {
  .cards-grid-baseline .price-card {
    min-width: 0;
  }

  .cards-grid {
    gap: 6px;
  }
  
  .price-card {
    padding: 6px;
    min-height: 55px;
    flex: 1 0 calc(50% - 6px);
    min-width: 0;
  }
  
  .crypto-symbol {
    font-size: 14px;
  }
  
  .crypto-icon {
    width: 16px;
    height: 16px;
  }
  
  .price-change {
    font-size: 12px;
    padding: 1px 2px;
  }
  
  .volume-24h {
    font-size: 12px;
  }
  
  .price-card-header {
    margin-bottom: 6px;
  }
}
</style>
