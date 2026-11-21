// ==================== 首页价格看板共享行情与显示偏好 ====================
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { MarketBreadthSnapshot } from '../../types/market-breadth'
import type { MarketPeriodVolumes } from '../../types/market-period-volumes'
import { useBotStore } from '../stores/bot'
import { calculateLiveBreadth, summarizeBreadth } from '../utils/market-breadth'
import { useGlobalPolling } from './useGlobalPolling'
import { useMarketScope } from './useMarketScope'

const VIEW_MODE_KEY = 'price-board-view-mode'

/** 首页只创建一份行情和筛选状态，侧栏与弹窗分别渲染，不重复发起订阅或轮询。 */
export function useHomePriceBoard() {
  const botStore = useBotStore()
  const viewMode = ref<'cards' | 'heatmap'>('cards')
  const heatmapSizeMode = ref<'change' | 'volume' | 'equal'>('change')
  const priceFilter = ref<'all' | 'up' | 'down'>('all')
  const symbolSearch = ref('')
  const changePeriod = ref<'5m' | '15m' | '1h' | '4h' | '24h'>('1h')
  const breadthSnapshot = ref<MarketBreadthSnapshot | null>(null)
  const periodVolumes = ref<MarketPeriodVolumes | null>(null)
  const breadthClock = ref(Date.now())
  let breadthRequestId = 0
  let volumeRequestId = 0

  const DEFAULT_CRYPTOS = computed<string[]>((previousSymbols) => {
    const configuredSymbols = botStore.config?.symbols
    const symbols = Array.isArray(configuredSymbols)
      ? [...new Set<string>(configuredSymbols.map((symbol: string) => symbol.replace('/', '').trim().toUpperCase()).filter(Boolean))]
      : []
    // 状态刷新会替换配置对象；交易对未变时不清空快照，以免统计和布局跳动。
    if (previousSymbols && symbols.length === previousSymbols.length
      && symbols.every((symbol, index) => symbol === previousSymbols[index])) return previousSymbols
    return symbols
  })
  const market = useMarketScope(DEFAULT_CRYPTOS, breadthSnapshot)

  // 所有周期（含滚动 24h）均用服务端本地 5m 基准与实时价格重算。
  const fullBreadth = computed(() => {
    const snapshot = breadthSnapshot.value
    const validSnapshot = snapshot && breadthClock.value < snapshot.expiresAt
      && JSON.stringify([...DEFAULT_CRYPTOS.value].sort()) === JSON.stringify(snapshot.symbols)
    const stats = validSnapshot ? snapshot.periods[changePeriod.value] : null
    return calculateLiveBreadth(DEFAULT_CRYPTOS.value, botStore.prices, changePeriod.value,
      stats?.bases ?? {}, stats?.referenceTime ?? null, Math.max(breadthClock.value, Date.now()))
  })

  // 统计随分类切换；隐藏基准网格仍用完整行情测量高度。
  const { scopeSymbols } = market
  const activeBreadth = computed(() => {
    const stats = fullBreadth.value
    return summarizeBreadth(Object.fromEntries(scopeSymbols.value.map(symbol => [symbol, stats.changes[symbol] ?? null])),
      stats.referenceTime, stats.bases)
  })

  /** 返回未按分类过滤的实时涨跌幅，供展示和高度测量共用。 */
  function getChangePercent(symbol: string): number | null {
    return fullBreadth.value.changes[symbol] ?? null
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

  const needsPeriodVolumes = () => viewMode.value === 'heatmap' && heatmapSizeMode.value === 'volume'

  /** 仅在成交额热力图模式读取本地快照，不为弹窗单独请求。 */
  async function loadPeriodVolumes() {
    if (!needsPeriodVolumes()) return
    const requestId = ++volumeRequestId
    try {
      const result = await $fetch<MarketPeriodVolumes>('/api/market/period-volumes')
      if (requestId === volumeRequestId) periodVolumes.value = result
    } catch (error) {
      console.warn('[Price] 获取周期成交额失败:', error)
    }
  }

  watch(viewMode, (mode) => {
    if (!import.meta.client) return
    try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* 存储不可用时仍保留会话内偏好。 */ }
  })
  watch(needsPeriodVolumes, (needed) => {
    if (import.meta.client && needed) void loadPeriodVolumes()
  })
  watch(DEFAULT_CRYPTOS, () => {
    breadthRequestId++
    breadthSnapshot.value = null
    volumeRequestId++
    periodVolumes.value = null
    if (import.meta.client) {
      void loadMarketBreadth()
      void loadPeriodVolumes()
    }
  })

  useGlobalPolling(loadMarketBreadth)
  useGlobalPolling(loadPeriodVolumes, needsPeriodVolumes)

  onMounted(() => {
    try {
      if (localStorage.getItem(VIEW_MODE_KEY) === 'heatmap') viewMode.value = 'heatmap'
    } catch { /* 存储不可用时使用默认卡片视图。 */ }
    void loadMarketBreadth()
    void botStore.subscribeToPrices('crypto-price-cards')
  })
  onUnmounted(() => {
    volumeRequestId++
    breadthRequestId++
    void botStore.unsubscribeFromPrices('crypto-price-cards')
  })

  return {
    DEFAULT_CRYPTOS, viewMode, heatmapSizeMode, priceFilter, symbolSearch, changePeriod,
    breadthSnapshot, periodVolumes, activeBreadth, getChangePercent, ...market
  }
}
