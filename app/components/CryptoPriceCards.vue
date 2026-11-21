<template>
  <el-card class="price-grid-card price-grid-card-standalone" :class="{ 'price-grid-card-expanded': expanded }" shadow="hover">
    <template #header>
      <div class="price-cards-header price-cards-header-compact" :class="{ 'is-heatmap': viewMode === 'heatmap' }">
        <div class="price-cards-heading">
          <el-input
            v-model="symbolSearch"
            class="price-symbol-search"
            size="small"
            placeholder="搜索"
            aria-label="搜索"
            clearable
          >
            <template #prefix><el-icon><ElIconSearch /></el-icon></template>
          </el-input>
          <el-radio-group v-model="viewMode" class="price-view-options" size="small" aria-label="价格看板显示方式">
            <el-radio-button value="cards" title="卡片视图" aria-label="卡片视图"><el-icon><ElIconPostcard /></el-icon></el-radio-button>
            <el-radio-button value="heatmap" title="热力图视图" aria-label="热力图视图"><el-icon><ElIconGrid /></el-icon></el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="changePeriod" class="price-period-options" size="small" aria-label="涨跌幅周期">
            <el-radio-button value="5m">5m</el-radio-button>
            <el-radio-button value="15m">15m</el-radio-button>
            <el-radio-button value="1h">1h</el-radio-button>
            <el-radio-button value="4h">4h</el-radio-button>
            <el-radio-button value="24h">24h</el-radio-button>
          </el-radio-group>
          <div class="price-counts price-counts-compact" :title="`按${scopeLabel}中已配置交易对的${changePeriod}实时涨跌幅统计，不受搜索或涨跌筛选影响；持平 ${activeBreadth.flatCount}，分类未知 ${unknownCount}（仅计入全部）；AI使用每轮固定快照；上涨占比和中位数仅计算有效行情（含持平、排除待更）；所有周期参考价取本地5m K线（24h为滚动窗口）；参考价快照时间：${breadthSnapshot ? new Date(breadthSnapshot.computedAt).toLocaleString() : '待更新'}`">
            <MarketScopeSelect v-model="marketScope" />
            <div class="price-count-filters" role="group" aria-label="涨跌筛选">
              <button type="button" class="count-filter" :class="{ 'is-active': priceFilter === 'all' }" :aria-pressed="priceFilter === 'all'" title="显示当前分类全部交易对" @click="priceFilter = 'all'">总 {{ scopeSymbols.length }}</button>
              <button type="button" class="count-filter count-up" :class="{ 'is-active': priceFilter === 'up' }" :aria-pressed="priceFilter === 'up'" title="仅显示上涨交易对" @click="priceFilter = 'up'">涨 {{ priceCounts.up }}</button>
              <button type="button" class="count-filter count-down" :class="{ 'is-active': priceFilter === 'down' }" :aria-pressed="priceFilter === 'down'" title="仅显示下跌交易对" @click="priceFilter = 'down'">跌 {{ priceCounts.down }}</button>
            </div>
            <div class="price-count-metrics">
              <span title="上涨交易对占有效行情的比例（含持平）">涨比 <span class="price-metric-value">{{ priceCounts.upRatio === null ? '—' : `${priceCounts.upRatio.toFixed(0)}%` }}</span></span>
              <span title="当前周期有效行情的涨跌幅中位数" :class="{ 'count-up': (priceCounts.median ?? 0) > 0, 'count-down': (priceCounts.median ?? 0) < 0 }">
                中位 <span class="price-metric-value">{{ priceCounts.median === null ? '—' : formatPercent(priceCounts.median) }}</span>
              </span>
              <span v-if="priceCounts.pending" title="当前周期尚无有效行情的交易对数量">待 <span class="price-metric-value">{{ priceCounts.pending }}</span></span>
            </div>
          </div>
        </div>
        <div class="price-board-actions">
        <div v-if="viewMode === 'heatmap'" class="heatmap-header-actions">
          <span class="heatmap-size-label" aria-hidden="true">区块面积</span>
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
          aria-label="热力图区块面积"
        >
          <el-option label="涨跌幅" value="change" />
          <el-option label="成交额" value="volume" />
          <el-option label="等面积" value="equal" />
          </el-select>
        </div>
        <button
          type="button"
          class="board-expand-button"
          :title="expanded ? '还原看板' : '放大看板至整个页面'"
          :aria-label="expanded ? '还原价格看板' : '放大价格看板至整个页面'"
          :aria-pressed="expanded"
          @click="emit('toggle-expand')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path v-if="expanded" d="M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6" />
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
      :focus-zoom="{ minScale: 2, targetAreaRatio: 0.12 }"
      :focus-request="props.chartFocusRequest"
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
        @click="selectChartSymbol(crypto.symbol)"
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
      <el-empty :description="!scopeSymbols.length ? '当前分类暂无交易对或分类待更新' : symbolSearch.trim() ? '未找到匹配的代币' : priceFilter === 'up' ? '当前周期暂无上涨交易对' : priceFilter === 'down' ? '当前周期暂无下跌交易对' : '当前分类暂无价格数据'" :image-size="64" />
    </div>
    </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, type ComponentPublicInstance } from 'vue'
import PriceHeatmap from './PriceHeatmap.vue'
import { getHeatmapLegend } from '../utils/price-heatmap-colors'
import { formatPrice } from './kline-chart/utils/kline-formatters'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'
import type { useHomePriceBoard } from '../composables/useHomePriceBoard'

/** 看板只同步交易对选择，主图由首页渲染。 */
const props = defineProps<{
  /** 侧栏与弹窗共享筛选状态及行情；布局和滚动位置由各视图维护。 */
  board: ReturnType<typeof useHomePriceBoard>
  /** 由外层弹窗切换全屏，看板只改变布局。 */
  expanded?: boolean
  /** 标签隐藏时延迟滚动定位，重新显示后再读取卡片尺寸。 */
  inactive?: boolean
  /** 由外部指定要展示的交易对，例如点击当前持仓时传入。 */
  chartSymbol?: string
  /** 持仓主动点击请求，重复选择同一交易对时仍执行热力图聚焦。 */
  chartFocusRequest?: { symbol: string; id: number }
}>()

const emit = defineEmits<{
  /** 手动选择价格卡片后，将最新交易对同步给首页。 */
  'update:chartSymbol': [symbol: string]
  /** 由首页决定是打开全屏弹窗，还是切换已打开弹窗的尺寸。 */
  'toggle-expand': []
}>()

const botStore = useBotStore()
const {
  DEFAULT_CRYPTOS, viewMode, heatmapSizeMode, priceFilter, symbolSearch, changePeriod,
  breadthSnapshot, periodVolumes, activeBreadth, getChangePercent,
  marketScope, scopeSymbols, scopeSymbolSet, scopeLabel, unknownCount
} = props.board

const { getCoinIconUrl } = useCoinIcon()
/** 标记与市场统计、置信度使用相同的官方元数据分类。 */
function isTradFi(symbol: string): boolean {
  return breadthSnapshot.value?.assetCategories?.[symbol] === 'tradfi'
}

// 响应式数据
const cryptoPrices = ref<CryptoPrice[]>([])
const isLoading = ref(false)
const selectedSymbol = ref('')
const boardContentElement = ref<HTMLElement | null>(null)
const baselineGridElement = ref<HTMLElement | null>(null)
const cardGridHeight = ref(128)
let cardGridResizeObserver: ResizeObserver | undefined
// 搜索只筛选展示，市场统计始终覆盖当前资产分类。
const normalizedSymbolSearch = computed(() => symbolSearch.value.replace(/[\s/]/g, '').toUpperCase())
const heatmapLegend = computed(() => getHeatmapLegend(changePeriod.value))
const heatmapMeasureCount = ref(21)
// 价格变动动画状态
const priceChangeAnimations = ref<Record<string, 'up' | 'down' | null>>({})

// 标题复用浏览器实时聚合结果，AI 仍读取服务端固定快照。
const priceCounts = computed(() => {
  const stats = activeBreadth.value
  return {
    up: stats?.upCount ?? 0, down: stats?.downCount ?? 0,
    pending: stats?.missingCount ?? scopeSymbols.value.length,
    upRatio: stats?.upRatioPct ?? null, median: stats?.medianChangePct ?? null
  }
})
// 筛选与头部统计共用当前周期涨跌幅，持平和待更新行情只在“总”中显示。
const filteredCryptoPrices = computed(() => cryptoPrices.value.filter((crypto) => {
  if (!scopeSymbolSet.value.has(crypto.symbol)) return false
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
  group: isTradFi(crypto.symbol) ? '传统金融' : breadthSnapshot.value?.assetCategories?.[crypto.symbol] === 'crypto' ? '加密资产' : '分类未知',
  icon: cryptoIconUrl(crypto.symbol)
})))

/** 热力图区块与卡片共用图表选择入口。 */
function selectHeatmapSymbol(symbol: string) {
  const crypto = cryptoPrices.value.find((item) => item.symbol === symbol)
  if (crypto) selectChartSymbol(crypto.symbol)
}

watch(viewMode, () => {
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
  if (props.inactive || viewMode.value !== 'cards' || !selectedSymbol.value) return
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
watch([selectedSymbol, viewMode, () => props.inactive, () => filteredCryptoPrices.value.map(item => item.symbol).join(',')],
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

// 配置与实时行情同时驱动当前视图的卡片价格动画。
watch([DEFAULT_CRYPTOS, () => botStore.prices], syncPricesFromStore, { deep: true })

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

/** 同步首页主图交易对，并立即标记当前选中的卡片。 */
function selectChartSymbol(symbol: string) {
  selectedSymbol.value = symbol
  emit('update:chartSymbol', symbol)
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


// 组件生命周期
onMounted(() => {
  // 按原来一页的卡片实际布局测量，保持取消分页前的高度与响应式行数。
  if (baselineGridElement.value) {
    cardGridResizeObserver = new ResizeObserver(measureOriginalPageHeight)
    cardGridResizeObserver.observe(baselineGridElement.value)
    if (boardContentElement.value) cardGridResizeObserver.observe(boardContentElement.value)
  }
  updateHeatmapMeasureCount()
  window.addEventListener('resize', updateHeatmapMeasureCount)
  // 首次加载
  syncPricesFromStore()
})

onUnmounted(() => {
  cardGridResizeObserver?.disconnect()
  if (import.meta.client) window.removeEventListener('resize', updateHeatmapMeasureCount)
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
/* 全屏尺寸由弹窗控制；看板只负责让正文使用工具栏以外的空间。 */
.price-grid-card-expanded {
  box-sizing: border-box;
  height: 100%;
  margin: 0;
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

.price-grid-card-standalone:not(.price-grid-card-expanded) {
  height: 100%;
  display: flex;
  flex-direction: column;
  margin: 0;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) :deep(.el-card__header) {
  flex: 0 0 auto;
  padding: 10px;
  container: kline-price-sidebar / inline-size;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) :deep(.el-card__body) {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-board-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: auto;
  margin: 0;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .cards-scroll { inset: 0; }

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
  gap: 6px;
}

.price-cards-heading > * {
  flex-shrink: 0;
}

.price-counts {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.price-count-filters,
.price-count-metrics { display: contents; }

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
  width: 105px;
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

.heatmap-size-label {
  display: none;
}

.heatmap-size-select {
  width: 70px;
  flex-shrink: 0;
}

/* 首页右栏宽度与窗口宽度不等；固定操作层级，避免控件随统计字数换位。 */
.price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 28px;
  gap: 8px;
  overflow: visible;
  margin: 0;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-heading,
.price-grid-card-standalone:not(.price-grid-card-expanded) .price-board-actions {
  display: contents;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-symbol-search {
  grid-area: 1 / 1;
  width: 100%;
  max-width: none;
  --el-input-height: 28px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-view-options {
  grid-area: 1 / 2;
  display: grid;
  grid-template-columns: repeat(2, 29px);
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .board-expand-button {
  grid-area: 1 / 3;
  width: 28px;
  height: 28px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-period-options {
  grid-area: 2 / 1 / 3 / -1;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-heading :deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-header-actions {
  grid-area: 3 / 1 / 4 / -1;
  justify-self: stretch;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-size-label {
  display: inline;
  color: var(--text-secondary);
  font-size: 12px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-size-select {
  margin-inline-start: auto;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-counts {
  grid-area: 3 / 1 / 4 / -1;
  gap: 6px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-counts-compact {
  /* 右栏特别窄时允许横向查看，不换行，也不隐藏任何筛选或统计。 */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
  padding: 2px;
  font-size: 11px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .is-heatmap .price-counts { grid-row: 4; }

.price-grid-card-standalone:not(.price-grid-card-expanded) .count-filter {
  flex: 1 0 auto;
  min-height: 24px;
  padding: 0 2px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-counts-compact .count-filter {
  flex: 0 1 44px;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-counts-compact .price-count-metrics > span {
  /* 先按文字长度留位，再分配剩余空间；空间不足时优先收窄短按钮。 */
  flex: 1 0 auto;
  text-align: center;
}

.price-grid-card-standalone:not(.price-grid-card-expanded) .price-metric-value { font-weight: 600; }

/* 空间足够时把面积设置并入周期行；以看板内容宽度为准。 */
@container kline-price-sidebar (min-width: 248px) {
  .price-grid-card-standalone:not(.price-grid-card-expanded) .is-heatmap .price-period-options {
    grid-column: 1 / 2;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-header-actions {
    grid-area: 2 / 2 / 3 / -1;
    justify-self: end;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-size-label {
    display: none;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .heatmap-size-select :deep(.el-select__wrapper) {
    min-height: 28px;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .is-heatmap .price-counts {
    grid-row: 3;
  }
}

/* 首页上排给周期更多空间，下排把面积选择靠右；窄栏继续沿用分行布局。 */
@container kline-price-sidebar (min-width: 372px) {
  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact {
    grid-template-columns: minmax(64px, 0.85fr) 48px minmax(155px, 1.3fr) var(--compact-heatmap-column, 0px) 26px;
    gap: 6px 4px;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact.is-heatmap {
    --compact-heatmap-column: 40px;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .price-view-options {
    grid-template-columns: repeat(2, 24px);
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .price-period-options {
    grid-area: 1 / 3;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .price-period-options :deep(.el-radio-button__inner) {
    padding-inline: 4px;
    font-size: 11px;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .heatmap-header-actions {
    display: contents;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .heatmap-help-button {
    grid-area: 1 / 4;
    justify-self: end;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .board-expand-button {
    grid-area: 1 / 5;
    width: 26px;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .price-counts {
    grid-area: 2 / 1 / 3 / -1;
    gap: 4px;
    scrollbar-width: none;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact.is-heatmap .price-counts {
    /* 统计和下拉框用不同的列，筛选数量变长也不会盖住下拉框。 */
    grid-column-end: 4;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .heatmap-size-select {
    grid-area: 2 / 4 / 3 / -1;
    width: 100%;
    margin-inline-start: 0;
  }

  .price-grid-card-standalone:not(.price-grid-card-expanded) .price-cards-header-compact .heatmap-size-select :deep(.el-select__wrapper) {
    min-height: 24px;
  }
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
