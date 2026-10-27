<template>
  <div ref="simpleContainerRef" class="kline-chart-simple-container" :class="{ 'timeline-active': timeline }">
    <!-- 图表控制栏 -->
    <div ref="controlsWrapperRef" class="chart-controls-wrapper">
      <KLineChartControls
        :symbol="displaySymbol"
        :timeline="timeline"
        @timeline-change="setTimeline"
        :timeframe="selectedTimeframe"
        :theme="theme"
        :loading="loading"
        :show-ema-markers="showEMAMarkers"
        :show-order-markers="showOrderMarkers"
        :filter-order-markers-by-timeframe="filterOrderMarkersByTimeframe"
        :show-ema-lines="showEMALines"
        :show-scan-markers="showScanMarkers"
        :scan-loading="scanLoading"
        :scan-supported="scanSupported"
        :scan-count="scanResults.length"
        :scan-time-range="scanTimeRange"
        :scan-range-bounds="scanRangeBounds"
        :ema-periods="selectedEmaPeriods"
        :active-engine="activeEngine"
        @timeframe-change="selectTimeframe"
        @refresh="refreshChart"
        @toggle-theme="toggleTheme"
        @toggle-fullscreen="toggleFullscreen"
        @ema-markers-change="handleEMAMarkersChange"
        @order-markers-change="handleOrderMarkersChange"
        @order-timeframe-filter-change="handleOrderTimeframeFilterChange"
        @ema-lines-change="handleEMALinesChange"
        @scan-markers-change="handleScanMarkersChange"
        @scan-range-change="handleScanRangeChange"
        @ema-periods-change="handleEmaPeriodsChange"
        @switch-engine="(engine: any) => $emit('switch-engine', engine)"
      />
    </div>

    <!-- 图表容器 -->
    <div class="chart-container">
      <RealtimeTimeline v-if="timeline" ref="timelineRef" :symbol="displaySymbol" :theme="theme" :height="chartHeight" />
      <KLineChartCanvas
        v-if="!timeline"
        ref="chartCanvasRef"
        :kline-data="klineData"
        :trade-history="visibleTradeHistory"
        :historical-order="orderTooltipVisible ? orderTooltipOrders[0] : null"
        :scan-results="scanResults"
        :theme="theme"
        :symbol="displaySymbol"
        :timeframe="selectedTimeframe"
        :loading="loading"
        :error="error"
        :show-ema-markers="showEMAMarkers"
        :show-order-markers="showOrderMarkers"
        :show-scan-markers="showScanMarkers"
        :show-ema-lines="showEMALines"
        :ema-periods="selectedEmaPeriods"
        :height="chartHeight"
        @tooltip-update="handleTooltipUpdate"
        @order-click="handleOrderClick"
        @scan-click="handleScanClick"
        @retry="loadKLineData"
      />

      <KLineScanResultDialog
        v-model="scanDialogVisible"
        :symbol="displaySymbol"
        :timeframe="selectedTimeframe"
        :kline-time="scanDialogKlineTime"
        :results="scanDialogResults"
      />

      <!-- K线数据浮动面板 -->
      <KLineTooltip
        v-if="!timeline"
        :visible="tooltipVisible"
        :symbol="displaySymbol"
        :timeframe="selectedTimeframe"
        :time="tooltipTime"
        :data="tooltipData"
        :position="tooltipPosition"
        :kline-data="klineData"
        :updated="meta.updated"
      />

      <!-- 订单详情浮动面板 -->
      <KLineTooltip
        v-if="!timeline"
        mode="order"
        :visible="orderTooltipVisible"
        :symbol="displaySymbol"
        :timeframe="selectedTimeframe"
        :time="orderTooltipTime"
        :kline-time="orderTooltipKlineTime"
        :orders="orderTooltipOrders"
        :position="orderTooltipPosition"
        @close="orderTooltipVisible = false"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, onBeforeUnmount, getCurrentInstance } from 'vue'
import type { SimpleKLineData, KLineApiResponse } from '../../../types/kline-simple'
import type { TradeHistory } from '../../../types'
import type { ScanResultApiResponse, StrategyScanResult } from '../../../types/scan-result'

// 导入子组件
import KLineChartControls from './KLineChartControls.vue'
import RealtimeTimeline from './RealtimeTimeline.vue'
import KLineChartCanvas from './KLineChartCanvas.vue'
import KLineTooltip from './KLineTooltip.vue'
import KLineScanResultDialog from './KLineScanResultDialog.vue'

// 导入bot store
import { useBotStore } from '../../stores/bot'
import { useTheme } from '../../composables/useTheme'

// 图表组件引用
const chartCanvasRef = ref<InstanceType<typeof KLineChartCanvas> | null>(null)
const simpleContainerRef = ref<HTMLElement | null>(null)
const controlsWrapperRef = ref<HTMLElement | null>(null)

// 导入工具函数
import { formatTime } from './utils/kline-formatters'
import { calculateEMASeries, calculateATRSeries, calculateATRPercent } from '../../utils/ema-calculator'
import { calculateRSISeries } from '../../utils/rsi-calculator'
import { calculateADXSeries } from '../../utils/adx-calculator'

// 初始化bot store
const botStore = useBotStore()
const { theme: globalTheme, toggleTheme: globalToggleTheme } = useTheme()

// 是否已经初始化过（防止初始加载时不必要的切换）
let hasInitialized = false

// 防抖函数
const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: number | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout !== null) {
      clearTimeout(timeout)
    }
    
    timeout = window.setTimeout(() => {
      func(...args)
    }, wait)
  }
}


// 定义props
interface Props {
  symbol?: string
  timeframe?: string
  activeEngine?: 'native' | 'tradingview'
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'BTCUSDT',
  timeframe: '',  // 默认为空字符串，表示没有提供timeframe
  activeEngine: 'native'
})

// 定义emits
defineEmits<{
  'switch-engine': [engine: 'native' | 'tradingview']
}>()

// 计算显示的symbol
const displaySymbol = computed(() => {
  return props.symbol || 'BTCUSDT'
})

// 计算timeframe
const computedTimeframe = computed(() => {
  // 如果props提供了timeframe，则使用提供的值
  if (props.timeframe) return props.timeframe
  
  // 否则从配置读取默认周期，配置未加载时使用 '1h' 作为兜底
  return botStore.config?.defaultTimeframe || '1h'
})

// 响应式数据
const selectedTimeframe = ref(computedTimeframe.value)
const timeline = ref(false)
const timelineRef = ref<InstanceType<typeof RealtimeTimeline> | null>(null)

/** 分时独立于策略周期，进入时停止 K 线轮询并使在途请求失效。 */
function setTimeline(enabled: boolean) {
  timeline.value = enabled
  requestGeneration++
  scanRequestGeneration++
  hideTooltip()
  if (enabled) {
    loading.value = false
    scanDialogVisible.value = false
    stopNewKlineCheck()
  } else {
    loadKLineData()
    startNewKlineCheck()
  }
}

/** 分时刷新只清空浏览器内的临时价格点。 */
function refreshChart() {
  if (timeline.value) timelineRef.value?.reset()
  else loadKLineData()
}

// 标记控制状态 - 从配置读取默认值
const chartMarkerConfig = computed(() => botStore.config?.chartMarkerConfig || {})
const showEMAMarkers = ref(chartMarkerConfig.value.showEMAMarkers ?? false)
const showOrderMarkers = ref(chartMarkerConfig.value.showOrderMarkers ?? false)
// 默认不过滤不同策略主周期的订单，用户可在订单开关旁开启过滤。
const filterOrderMarkersByTimeframe = ref(false)
const showEMALines = ref(chartMarkerConfig.value.showEMALines ?? true)
const showScanMarkers = ref(false)
const scanLoading = ref(false)
const scanResults = ref<StrategyScanResult[]>([])
const scanTimeRange = ref<[number, number] | null>(null)
const scanSupported = computed(() => ['5m', '15m', '1h', '4h'].includes(selectedTimeframe.value))
const scanRangeBounds = computed<[number, number] | null>(() => {
  const firstKline = klineData.value[0]
  const lastKline = klineData.value[klineData.value.length - 1]
  if (!firstKline || !lastKline) return null

  return [
    firstKline.t * 1000,
    (lastKline.t + getTimeframeSeconds(selectedTimeframe.value)) * 1000 - 1
  ]
})
let scanRequestGeneration = 0

// EMA周期选择 - 从botStore.config获取，如果未加载完成则使用默认值
const selectedEmaPeriods = ref<number[]>(botStore.config?.emaPeriods?.length ? [...botStore.config.emaPeriods] : [20, 200])

// 请求代次（用于防止过期响应覆盖）
let requestGeneration = 0

// 监听botStore.config变化（仅用于首次初始化加载配置）
// 注意：后续配置轮询更新时，不再覆盖用户手动选择的周期和EMA配置
watch(() => botStore.config, (newConfig, oldConfig) => {
  // 首次初始化时
  if (!hasInitialized) {
    hasInitialized = true
    
    // 首次从配置读取EMA周期
    if (newConfig?.emaPeriods && newConfig.emaPeriods.length > 0) {
      selectedEmaPeriods.value = [...newConfig.emaPeriods]
    }
    
    // 首次从配置读取标记开关默认值
    if (newConfig?.chartMarkerConfig) {
      const cfg = newConfig.chartMarkerConfig
      if (cfg.showEMAMarkers !== undefined) showEMAMarkers.value = cfg.showEMAMarkers
      if (cfg.showOrderMarkers !== undefined) showOrderMarkers.value = cfg.showOrderMarkers
      if (cfg.showEMALines !== undefined) showEMALines.value = cfg.showEMALines
    }
    
    selectedTimeframe.value = computedTimeframe.value
    loadKLineData()
    return
  }
  
  // 后续配置更新时，不做任何覆盖操作
  // 避免覆盖用户手动选择的K线周期和EMA周期
})

const klineData = ref<SimpleKLineData[]>([])
const meta = ref({
  first: 0,
  last: 0,
  count: 0,
  max: 495,
  updated: 0
})
const loading = ref(false)
const error = ref('')
const theme = ref<'light' | 'dark'>(globalTheme.value)
const normalChartHeight = 423
const chartHeight = ref(normalChartHeight)
const isFullscreen = ref(false)
let layoutObserver: ResizeObserver | undefined

// 监听全局主题变化，同步本地 ref
watch(globalTheme, (newTheme) => {
  theme.value = newTheme
})

// 历史订单数据
const tradeHistory = ref<TradeHistory[]>([])
const loadingHistory = ref(false)

/**
 * 开启周期过滤时，订单优先使用自身 mainTimeframe；旧订单再按 strategyId 推断。
 */
const visibleTradeHistory = computed(() => {
  if (!filterOrderMarkersByTimeframe.value) return tradeHistory.value

  return tradeHistory.value.filter((order) => {
    const orderTimeframe = order.mainTimeframe
      || (order as TradeHistory & { inferredTimeframe?: string }).inferredTimeframe
    return orderTimeframe === selectedTimeframe.value
  })
})


// 浮动面板相关
const tooltipVisible = ref(false)
const tooltipData = ref({
  open: 0,
  high: 0,
  low: 0,
  close: 0,
  volume: 0,
  changePercent: 0,
  emaDiffPercent: 0,
  atrPercent: 0,
  rsi: 0,
  adx: 0,
  pdi: 0,
  mdi: 0
})
const tooltipTime = ref('')
const tooltipPosition = ref({
  left: '20px',
  top: '20px'
})

// 选择周期
const selectTimeframe = (timeframe: string) => {
  if (timeline.value) {
    selectedTimeframe.value = timeframe
    setTimeline(false)
    return
  }
  if (selectedTimeframe.value === timeframe) return
  
  // 清空当前K线数据，避免显示旧周期的数据
  klineData.value = []
  provisionalKlineTimestamp = null
  provisionalReloadRequestedAt = 0
  tradeHistory.value = []
  scanResults.value = []
  scanDialogVisible.value = false
  scanRequestGeneration++
  hideTooltip()
  
  // 清理图表上的订单标记
  if (chartCanvasRef.value) {
    chartCanvasRef.value.clearMarkers()
  }
  
  selectedTimeframe.value = timeframe
  loadKLineData()
}

// 加载历史订单数据
const loadTradeHistory = async () => {
  const symbolToUse = props.symbol || 'BTCUSDT'
  if (!symbolToUse) return
  
  loadingHistory.value = true
  
  try {
    const first = klineData.value[0]
    const last = klineData.value[klineData.value.length - 1]
    const response = await $fetch('/api/bot/history-markers', {
      params: {
        symbol: symbolToUse,
        from: first ? first.t * 1000 : undefined,
        to: last ? (last.t + getTimeframeSeconds(selectedTimeframe.value)) * 1000 : undefined,
      },
    }) as any
    tradeHistory.value = response.success ? response.data || [] : []
  } catch (err: any) {
    console.error('加载交易历史失败:', err)
  } finally {
    loadingHistory.value = false
  }
}

// 加载K线数据
/**
 * 加载K线数据。
 * @param silent 后台周期轮询使用静默模式，避免加载遮罩覆盖现有图表。
 */
const loadKLineData = async (silent = false) => {
  if (timeline.value) return
  const symbolToUse = props.symbol || 'BTCUSDT'
  const timeframeToUse = selectedTimeframe.value

  if (!symbolToUse || !timeframeToUse) {
    error.value = '请提供交易对和周期'
    return
  }
  
  // 递增请求代次（不中止旧请求，只让旧请求的响应被丢弃）
  const generation = ++requestGeneration
  
  if (!silent) loading.value = true
  error.value = ''
  
  try {
    const params = new URLSearchParams({
      symbol: symbolToUse,
      timeframe: timeframeToUse,
      limit: '495'
    })
    
    const response = await fetch(`/api/kline-simple?${params}`)
    const result: KLineApiResponse = await response.json()
    
    // 检查当前请求代次是否已过期（例如symbol/timeframe已切换）
    if (generation !== requestGeneration) {
      return
    }
    
    // 检查symbol/timeframe是否匹配当前状态
    if (symbolToUse !== (props.symbol || 'BTCUSDT') || selectedTimeframe.value !== timeframeToUse) {
      return
    }
    
    if (result.success && result.data) {
      let nextKlineData = result.data.data

      // 周期边界后，后端同步和前端临时柱可能存在几秒竞态。
      // 后端若仍返回上一根已收盘柱，不能用旧快照覆盖临时新柱，否则时间范围会在两个边界间反复跳动。
      const responseLastKline = nextKlineData[nextKlineData.length - 1]
      const provisionalTimestamp = provisionalKlineTimestamp
      if (provisionalTimestamp && responseLastKline && responseLastKline.t < provisionalTimestamp) {
        const currentProvisional = klineData.value[klineData.value.length - 1]
        if (currentProvisional?.t === provisionalTimestamp) {
          nextKlineData = [...nextKlineData, currentProvisional]
        }
      } else if (provisionalTimestamp && responseLastKline && responseLastKline.t >= provisionalTimestamp) {
        // 只有后端已经返回临时柱（或更新的柱）时，才认为权威数据完成校正。
        provisionalKlineTimestamp = null
        provisionalReloadRequestedAt = 0
      }

      klineData.value = nextKlineData
      meta.value = result.data.meta
      
      // 加载历史订单数据（等待完成）
      await loadTradeHistory()

      // 扫描结果是可选图层，仅在用户开启后随 K 线刷新。
      if (showScanMarkers.value) {
        void loadScanResults()
      }
      
      // 显示最新K线数据
      showLatestKline()
    } else if (!silent) {
      error.value = result.message || '获取数据失败'
      klineData.value = []
      hideTooltip()
    }
  } catch (err: any) {
    console.error('加载K线数据失败:', err)
    if (!silent) {
      error.value = `加载失败: ${err.message}`
      klineData.value = []
      hideTooltip()
    }
  } finally {
    // 仅当当前请求代次匹配时才清除loading状态
    if (!silent && generation === requestGeneration) {
      loading.value = false
    }
  }
}

// 切换主题（同步全局主题 + 本地 ref）
const toggleTheme = () => {
  globalToggleTheme()
}

// 全屏切换
const toggleFullscreen = () => {
  const container = simpleContainerRef.value
  if (!container) return

  if (!document.fullscreenElement) {
    container.requestFullscreen().catch((err) => {
      console.error('全屏请求失败:', err)
    })
  } else {
    document.exitFullscreen().catch((err) => {
      console.error('退出全屏失败:', err)
    })
  }
}

const updateChartHeight = () => {
  if (!isFullscreen.value) {
    const container = simpleContainerRef.value
    if (window.innerWidth >= 992 && container?.closest('.market-column')) {
      // 直接读取 flex 布局分配后的空间，不用旧画布高度反推，避免更新时序造成误差。
      chartHeight.value = Math.max(250, container.clientHeight - (controlsWrapperRef.value?.offsetHeight || 0))
      return
    }
    chartHeight.value = normalChartHeight
    return
  }

  const controlsHeight = controlsWrapperRef.value?.offsetHeight || 0
  const reservedGap = 16
  chartHeight.value = Math.max(300, window.innerHeight - controlsHeight - reservedGap)
}

const handleFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === simpleContainerRef.value
  updateChartHeight()
}

const handleWindowResize = () => {
  updateChartHeight()
}

// 处理EMA标记开关变化
const handleEMAMarkersChange = (show: boolean) => {
  showEMAMarkers.value = show
}

// 处理订单标记开关变化
const handleOrderMarkersChange = (show: boolean) => {
  showOrderMarkers.value = show
}

/**
 * 切换历史订单的主周期过滤，不重新请求K线或订单数据。
 */
const handleOrderTimeframeFilterChange = (filter: boolean) => {
  filterOrderMarkersByTimeframe.value = filter
  orderTooltipVisible.value = false
}

// 处理EMA线开关变化
const handleEMALinesChange = (show: boolean) => {
  showEMALines.value = show
}

/**
 * 开启或关闭历史扫描图层；开启时默认按图表当前可视范围读取日志。
 */
const handleScanMarkersChange = (show: boolean) => {
  if (show && !scanSupported.value) return

  showScanMarkers.value = show
  scanDialogVisible.value = false

  if (show) {
    // 每次开启都以用户当前看到的 K 线区间为起点，图表尚未就绪时回退到完整加载范围。
    scanTimeRange.value = chartCanvasRef.value?.getVisibleTimeRange() ?? scanRangeBounds.value
    void loadScanResults()
  } else {
    scanRequestGeneration++
    scanResults.value = []
  }
}

/**
 * 更新自定义扫描时间范围；扫描图层开启时立即按新范围重新提取。
 */
const handleScanRangeChange = (range: [number, number] | null) => {
  scanTimeRange.value = range
  scanDialogVisible.value = false

  if (showScanMarkers.value) {
    void loadScanResults()
  }
}

/**
 * 根据当前交易对、周期和已加载 K 线区间获取历史扫描结果。
 */
const loadScanResults = async () => {
  const firstKline = klineData.value[0]
  const lastKline = klineData.value[klineData.value.length - 1]
  if (!showScanMarkers.value || !scanSupported.value || !firstKline || !lastKline) return

  const symbol = displaySymbol.value
  const timeframe = selectedTimeframe.value
  const loadedFrom = firstKline.t
  const loadedTo = lastKline.t + getTimeframeSeconds(timeframe) - 1
  const from = scanTimeRange.value
    ? Math.max(loadedFrom, Math.floor(scanTimeRange.value[0] / 1000))
    : loadedFrom
  const to = scanTimeRange.value
    ? Math.min(loadedTo, Math.floor(scanTimeRange.value[1] / 1000))
    : loadedTo
  const generation = ++scanRequestGeneration

  if (from > to) {
    scanResults.value = []
    scanLoading.value = false
    return
  }

  scanLoading.value = true

  try {
    const params = new URLSearchParams({
      symbol,
      timeframe,
      from: String(from),
      to: String(to)
    })
    const response = await fetch(`/api/scan-results?${params}`)
    const result: ScanResultApiResponse = await response.json()

    // 切换交易对、周期或关闭图层后，丢弃旧请求结果。
    if (generation !== scanRequestGeneration || symbol !== displaySymbol.value || timeframe !== selectedTimeframe.value) return
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || '获取历史扫描结果失败')
    }

    scanResults.value = alignScanResultsToKlines(result.data.results)
  } catch (err: any) {
    if (generation !== scanRequestGeneration) return
    console.error('加载历史扫描结果失败:', err)
    scanResults.value = []
  } finally {
    if (generation === scanRequestGeneration) {
      scanLoading.value = false
    }
  }
}

/**
 * 使用图表实际 K 线时间重新对齐扫描结果。
 *
 * 后端按标准周期预分桶，前端仍以已加载的真实 K 线为准，避免数据缺口或
 * 时间边界差异把扫描结果落到不存在或错误的蜡烛上。
 */
const alignScanResultsToKlines = (results: StrategyScanResult[]): StrategyScanResult[] => {
  if (results.length === 0 || klineData.value.length === 0) return []

  const timeframeSeconds = getTimeframeSeconds(selectedTimeframe.value)
  const sortedResults = [...results].sort((a, b) => a.timestamp - b.timestamp)
  const alignedResults: StrategyScanResult[] = []
  let klineIndex = 0

  for (const result of sortedResults) {
    // 扫描时间单调递增时只向前移动索引，避免逐条全量查找。
    while (klineIndex < klineData.value.length - 1 &&
      (klineData.value[klineIndex + 1]?.t || Number.POSITIVE_INFINITY) <= result.timestamp) {
      klineIndex++
    }

    const kline = klineData.value[klineIndex]
    if (!kline || result.timestamp < kline.t || result.timestamp >= kline.t + timeframeSeconds) continue

    alignedResults.push({
      ...result,
      klineTime: kline.t
    })
  }

  return alignedResults
}

// 处理EMA周期变化
const handleEmaPeriodsChange = (periods: number[]) => {
  selectedEmaPeriods.value = periods
  // 更新botStore配置
  if (botStore.config) {
    botStore.config.emaPeriods = periods
  }
}

// 处理tooltip更新
const handleTooltipUpdate = (data: any, time: string) => {
  tooltipData.value = data
  tooltipTime.value = time
  tooltipVisible.value = true
}

// 获取时间段的秒数（新K线检测需要）
const getTimeframeSeconds = (timeframe: string): number => {
  switch (timeframe) {
    case '5m': return 5 * 60
    case '15m': return 15 * 60
    case '1h': return 60 * 60
    case '4h': return 4 * 60 * 60
    case '1d': return 24 * 60 * 60
    case '1w': return 7 * 24 * 60 * 60
    default: return 60 * 60
  }
}

// 使用 botStore 共享价格更新最后一根K线
const updateLastKlineWithPrice = (price: number) => {
  if (klineData.value.length === 0) return
  if (price <= 0) return
  
  const lastIndex = klineData.value.length - 1
  const lastKline = klineData.value[lastIndex]
  if (!lastKline) return
  
  const updatedKline = {
    ...lastKline,
    c: price,
    h: Math.max(lastKline.h, price),
    l: Math.min(lastKline.l, price),
    v: lastKline.v
  }
  
  klineData.value[lastIndex] = updatedKline
  meta.value.updated = Date.now()
  
  if (chartCanvasRef.value) {
    chartCanvasRef.value.updateLastKline(updatedKline)
  }
  
  if (tooltipVisible.value) {
    const changePercent = ((updatedKline.c - updatedKline.o) / updatedKline.o) * 100
    const emaDiffPercent = calculateLatestEmaDiff(klineData.value)
    const atrPercent = calculateLatestAtrPercent(klineData.value)
    const rsi = calculateLatestRsi(klineData.value)
    const directionIndicators = calculateLatestAdx(klineData.value)
    tooltipData.value = {
      open: updatedKline.o,
      high: updatedKline.h,
      low: updatedKline.l,
      close: updatedKline.c,
      volume: updatedKline.v || 0,
      changePercent,
      emaDiffPercent,
      atrPercent,
      rsi,
      ...directionIndicators
    }
    tooltipTime.value = formatTime(updatedKline.t)
  }
}

// 计算EMA差值百分比
const calculateLatestEmaDiff = (klineData: SimpleKLineData[]): number => {
  const emaPeriods = botStore.config?.emaPeriods || [20, 200]
  const fastPeriod = emaPeriods[0]
  const slowPeriod = emaPeriods[1]
  
  if (!fastPeriod || !slowPeriod || klineData.length < Math.max(fastPeriod, slowPeriod)) {
    return 0
  }
  
  const fastEmaSeries = calculateEMASeries(klineData, fastPeriod)
  const slowEmaSeries = calculateEMASeries(klineData, slowPeriod)
  
  if (fastEmaSeries.length === 0 || slowEmaSeries.length === 0) {
    return 0
  }
  
  const fast = fastEmaSeries[fastEmaSeries.length - 1]?.value || 0
  const slow = slowEmaSeries[slowEmaSeries.length - 1]?.value || 0
  
  return slow === 0 ? 0 : ((fast - slow) / slow) * 100
}

// 计算最新ATR百分比
// 全量递推：实测证明 ATR 收敛型递推的最新值与后端 requiredCandles 窗口一致，
// 且每根K线都能获得 ATR 值（不会出现历史段为 0）
const calculateLatestAtrPercent = (klineData: SimpleKLineData[]): number => {
  if (klineData.length < 14) return 0
  const atrSeries = calculateATRSeries(klineData, 14)
  if (atrSeries.length === 0) return 0
  const atr = atrSeries[atrSeries.length - 1]?.value || 0
  const price = klineData[klineData.length - 1]?.c || 0
  return calculateATRPercent(atr, price)
}

// 计算最新RSI
const calculateLatestRsi = (klineData: SimpleKLineData[]): number => {
  if (klineData.length < 14) return 0
  const rsiSeries = calculateRSISeries(klineData, 14)
  if (rsiSeries.length === 0) return 0
  return rsiSeries[rsiSeries.length - 1]?.value || 0
}

// 一次计算最新 ADX 和方向指标，供默认展示与实时行情更新共用。
const calculateLatestAdx = (klineData: SimpleKLineData[]): { adx: number; pdi: number; mdi: number } => {
  const empty = { adx: 0, pdi: 0, mdi: 0 }
  if (klineData.length < 14) return empty
  const adxSeries = calculateADXSeries(klineData, 14)
  const latest = adxSeries[adxSeries.length - 1]
  if (!latest) return empty
  return { adx: latest.adx || 0, pdi: latest.plusDI || 0, mdi: latest.minusDI || 0 }
}

// 显示最新K线数据
const showLatestKline = () => {
  if (klineData.value.length > 0) {
    const latestKline = klineData.value[klineData.value.length - 1]
    if (latestKline) {
      const changePercent = ((latestKline.c - latestKline.o) / latestKline.o) * 100
      const emaDiffPercent = calculateLatestEmaDiff(klineData.value)
      const atrPercent = calculateLatestAtrPercent(klineData.value)
      const rsi = calculateLatestRsi(klineData.value)
      const directionIndicators = calculateLatestAdx(klineData.value)
      tooltipData.value = {
        open: latestKline.o,
        high: latestKline.h,
        low: latestKline.l,
        close: latestKline.c,
        volume: latestKline.v || 0,
        changePercent,
        emaDiffPercent,
        atrPercent,
        rsi,
        ...directionIndicators
      }
      tooltipTime.value = formatTime(latestKline.t)
      tooltipVisible.value = true
    }
  }
}

// 隐藏浮动面板
const hideTooltip = () => {
  tooltipVisible.value = false
}

// ========== 订单详情浮动面板 ==========

// 订单详情状态
const orderTooltipVisible = ref(false)
const orderTooltipOrders = ref<TradeHistory[]>([])
const orderTooltipTime = ref('')
const orderTooltipKlineTime = ref(0)
const orderTooltipPosition = ref({ left: '20px', top: '80px' })

// 处理订单点击事件
const handleOrderClick = (orders: TradeHistory[], klineTime: number) => {
  if (orders.length === 0) {
    // 点击无订单的K线，关闭面板
    orderTooltipVisible.value = false
    return
  }
  
  orderTooltipOrders.value = orders
  orderTooltipKlineTime.value = klineTime
  orderTooltipVisible.value = true
  orderTooltipTime.value = new Date(klineTime * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// ========== 扫描结果详情弹窗 ==========

const scanDialogVisible = ref(false)
const scanDialogResults = ref<StrategyScanResult[]>([])
const scanDialogKlineTime = ref(0)

/**
 * 点击有扫描标记的 K 线时，展示该周期内的全部结果。
 */
const handleScanClick = (results: StrategyScanResult[], klineTime: number) => {
  if (results.length === 0) {
    scanDialogVisible.value = false
    return
  }

  orderTooltipVisible.value = false
  scanDialogResults.value = results
  scanDialogKlineTime.value = klineTime
  scanDialogVisible.value = true
}

// ========== 价格订阅（使用 botStore 共享价格）==========

// 订阅ID必须绑定组件实例而不是交易对，否则切换交易对后卸载会遗留旧订阅者。
const priceSubscriberId = `kline-chart-${getCurrentInstance()?.uid ?? 'default'}`

// 从 botStore 共享价格中获取当前 symbol 的价格，更新最后一根K线
const checkAndUpdatePrice = () => {
  if (timeline.value) return
  const currentSymbol = (props.symbol || 'BTCUSDT')
  const price = botStore.getPrice(currentSymbol)
  
  if (!price || !price.price || price.price <= 0 || klineData.value.length === 0) return
  
  const lastKline = klineData.value[klineData.value.length - 1]
  if (!lastKline) return
  
  const now = Math.floor(Date.now() / 1000)
  const timeframeSeconds = getTimeframeSeconds(selectedTimeframe.value)
  const currentKlineTimestamp = Math.floor(now / timeframeSeconds) * timeframeSeconds
  
  if (lastKline.t === currentKlineTimestamp) {
    updateLastKlineWithPrice(price.price)
  }
}

// 监听 botStore 共享价格变化，自动更新K线
watch(() => botStore.prices[(props.symbol || 'BTCUSDT')], (newPrice) => {
  if (newPrice) {
    checkAndUpdatePrice()
  }
}, { deep: true })

// 新K线检测相关 - 复用bot store的共享轮询
const klineCheckSubscriberId = 'kline-chart-new-kline-check'
let newKlineCheckTimer: ReturnType<typeof setInterval> | null = null
// 记录前端临时追加的K线，等待后端权威数据完成校正。
let provisionalKlineTimestamp: number | null = null
// 避免后端尚未完成同步时每秒重复发起整批重载请求。
let provisionalReloadRequestedAt = 0

/**
 * 在周期边界立即追加临时K线，消除等待后端同步的空窗期。
 * 后续后台同步会用权威 OHLC 和成交量替换这根临时柱。
 */
const appendProvisionalKline = (timestamp: number) => {
  if (provisionalKlineTimestamp === timestamp || klineData.value.length === 0) return

  const previousKline = klineData.value[klineData.value.length - 1]
  if (!previousKline) return

  const price = botStore.getPrice(props.symbol || 'BTCUSDT')?.price || previousKline.c
  if (!Number.isFinite(price) || price <= 0) return

  const provisionalKline: SimpleKLineData = {
    t: timestamp,
    o: previousKline.c,
    h: Math.max(previousKline.c, price),
    l: Math.min(previousKline.c, price),
    c: price,
    v: 0
  }

  provisionalKlineTimestamp = timestamp
  provisionalReloadRequestedAt = 0
  klineData.value = [...klineData.value, provisionalKline]
  chartCanvasRef.value?.appendNewKline(provisionalKline)
}

// 获取最后一根K线数据（含成交量），用于更新图表
const fetchLastBar = async () => {
  const symbolToUse = props.symbol || 'BTCUSDT'
  const timeframeToUse = selectedTimeframe.value
  if (!symbolToUse || !timeframeToUse || klineData.value.length === 0) return

  try {
    const params = new URLSearchParams({ symbol: symbolToUse, timeframe: timeframeToUse })
    const response = await fetch(`/api/kline-simple/last-bar?${params}`)
    const result = await response.json()

    if (result.success && result.data && chartCanvasRef.value) {
      const lastBar = result.data as SimpleKLineData
      // 只更新时间戳匹配的最后一根K线（避免跨周期误更新）
      const lastIndex = klineData.value.length - 1
      const lastKline = klineData.value[lastIndex]
      if (lastKline && lastKline.t === lastBar.t) {
        // 同步更新响应式数据，确保后续价格更新不会覆盖成交量
        klineData.value[lastIndex] = lastBar
        // 更新图表显示
        chartCanvasRef.value.updateLastKline(lastBar)
      }
    }
  } catch (err) {
    // 静默处理，不影响主流程
  }
}

// 检查是否需要加载新K线
const checkForNewKline = (syncLastBar = true) => {
  if (timeline.value) return
  if (klineData.value.length === 0 || !selectedTimeframe.value) return
  
  const lastKline = klineData.value[klineData.value.length - 1]
  if (!lastKline) return
  
  const now = Math.floor(Date.now() / 1000)
  const timeframeSeconds = getTimeframeSeconds(selectedTimeframe.value)
  
  // 计算当前K线周期的时间戳
  const currentKlineTimestamp = Math.floor(now / timeframeSeconds) * timeframeSeconds
  
  // 后端在周期结束后延迟约12秒开始按交易对串行同步，前端等待30秒再整批校正，尽量避开批量同步窗口。
  const backendDelaySeconds = 30
  
  // 周期边界一到立即补出临时新柱，不再等待后端延迟。
  if (currentKlineTimestamp > lastKline.t) {
    appendProvisionalKline(currentKlineTimestamp)
  }

  // 临时柱等待后端权威数据，延迟结束后静默重载并校正。
  if (provisionalKlineTimestamp === currentKlineTimestamp &&
      (now - currentKlineTimestamp) >= backendDelaySeconds &&
      (now * 1000 - provisionalReloadRequestedAt) >= backendDelaySeconds * 1000) {
    // 保留临时柱标记，直到 loadKLineData 确认后端已返回同一时间戳，避免竞态下反复追加。
    provisionalReloadRequestedAt = now * 1000
    loadKLineData(true)
  }
  // 每次轮询都尝试获取最后一根K线的最新数据（含成交量），更新图表
  if (syncLastBar) fetchLastBar()
}

// 启动新K线检测（复用共享轮询）
const startNewKlineCheck = () => {
  // 订阅共享轮询，传递回调函数，每次轮询时检查新K线
  botStore.subscribeToPolling(klineCheckSubscriberId, checkForNewKline)

  // 共享轮询间隔为60秒，无法及时感知周期边界；本地只做时间判断，每秒执行一次。
  newKlineCheckTimer = setInterval(() => checkForNewKline(false), 1000)
  
  // 立即检查一次
  checkForNewKline()
}

// 停止新K线检测
const stopNewKlineCheck = () => {
  // 取消订阅共享轮询
  botStore.unsubscribeFromPolling(klineCheckSubscriberId)
  if (newKlineCheckTimer) {
    clearInterval(newKlineCheckTimer)
    newKlineCheckTimer = null
  }
}

// symbol变化处理函数
const handleSymbolChange = async (newSymbol: string, oldSymbol: string) => {
  if (newSymbol && newSymbol !== oldSymbol) {
    // 1. 递增请求代次，使所有旧异步回调失效
    requestGeneration++
    
    // 2. 立即清空当前显示的K线数据，避免显示旧数据
    klineData.value = []
    provisionalKlineTimestamp = null
    provisionalReloadRequestedAt = 0
    tradeHistory.value = []
    scanResults.value = []
    scanDialogVisible.value = false
    scanRequestGeneration++
    hideTooltip()
    
    // 3. 清理图表上的订单标记
    if (chartCanvasRef.value) {
      chartCanvasRef.value.clearMarkers()
    }
    
    // 4. 加载新数据
    await loadKLineData()
    
    console.log(`✅ Symbol切换完成: ${oldSymbol} -> ${newSymbol}`)
  }
}

// 创建防抖函数（200ms延迟）
const debouncedHandleSymbolChange = debounce(handleSymbolChange, 200)

// 监听symbol变化（使用防抖）
watch(() => props.symbol, (newSymbol, oldSymbol) => {
  if (newSymbol && newSymbol !== oldSymbol) {
    // 立即清空数据，避免子组件在防抖延迟期间使用旧 symbol 的数据渲染
    requestGeneration++
    klineData.value = []
    tradeHistory.value = []
    scanResults.value = []
    scanDialogVisible.value = false
    scanRequestGeneration++
    hideTooltip()
    if (chartCanvasRef.value) {
      chartCanvasRef.value.clearMarkers()
    }
    
    debouncedHandleSymbolChange(newSymbol, oldSymbol)
  }
})

// 监听timeframe变化
watch(() => props.timeframe, (newTimeframe, oldTimeframe) => {
  if (newTimeframe && newTimeframe !== oldTimeframe) {
    selectedTimeframe.value = newTimeframe
    loadKLineData()
  }
})

// 组件挂载时初始化
onMounted(() => {
  // 如果配置已经加载完成，直接加载数据；否则等待配置加载
  if (botStore.config) {
    // 配置已加载，设置正确的初始周期并加载数据
    selectedTimeframe.value = computedTimeframe.value
    loadKLineData()
  } else {
    // 配置未加载，等待 watch 首次触发时再加载数据
    // 注意：不要在这里 loadKLineData()，避免重复请求
  }
  // 订阅共享价格更新
  botStore.subscribeToPrices(priceSubscriberId)
  // 启动新K线检测
  startNewKlineCheck()
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  window.addEventListener('resize', handleWindowResize)
  const column = simpleContainerRef.value?.closest('.chart-card')?.parentElement
  if (column) {
    layoutObserver = new ResizeObserver(updateChartHeight)
    if (simpleContainerRef.value) layoutObserver.observe(simpleContainerRef.value)
    const prices = column.querySelector('.price-grid-card')
    if (prices) layoutObserver.observe(prices)
    if (controlsWrapperRef.value) layoutObserver.observe(controlsWrapperRef.value)
  }
})

// 组件卸载前同步清理
onBeforeUnmount(() => {
  stopNewKlineCheck()
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  window.removeEventListener('resize', handleWindowResize)
  layoutObserver?.disconnect()
})

// 组件卸载时异步清理
onUnmounted(() => {
  botStore.unsubscribeFromPrices(priceSubscriberId)
})
</script>

<style scoped>
.kline-chart-simple-container {
  /* 外层引擎容器会裁切溢出内容，负边距会把控制栏顶部移出可视区域。 */
  margin: 0;
  overflow: hidden;
  background: var(--bg-card);
  border-color: var(--border-color);
  transition: all 0.3s ease;
  margin-bottom: -50px;
}

.kline-chart-simple-container:fullscreen {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
}

/* 分时保留完整底部空间，避免继承 K 线负边距后被外层卡片裁掉时间轴。 */
.kline-chart-simple-container.timeline-active {
  margin-bottom: 0;
}

.chart-container {
  position: relative;
}

.kline-chart-simple-container:fullscreen .chart-container {
  flex: 1;
  min-height: 0;
}

</style>
