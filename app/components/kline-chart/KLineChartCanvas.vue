<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="kline-chart"></div>
    <SupportResistanceOverlay :symbol="symbol" :timeframe="timeframe" :klines="klineData" :loading="loading || !!error" :historical-order="historicalOrder" :get-chart="() => chart" :get-series="() => candlestickSeries" />
    <PositionRiskOverlay :symbol="symbol" :historical-order="historicalOrder" :klines="klineData" :loading="loading || !!error" :get-chart="() => chart" :get-series="() => candlestickSeries" />

    <!-- 加载状态 -->
    <div v-if="loading" class="chart-loading">
      <el-skeleton :rows="5" animated />
      <div class="loading-text">正在加载K线数据...</div>
    </div>

    <!-- 错误状态 -->
    <div v-if="error" class="chart-error">
      <el-alert
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />
      <div class="error-actions">
        <el-button type="primary" @click="$emit('retry')">
          重试
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import PositionRiskOverlay from './PositionRiskOverlay.vue'
import SupportResistanceOverlay from './SupportResistanceOverlay.vue'
import { useChartPosition } from '../../composables/usePositionChart'
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import type { TradeHistory } from '../../../types'
import type { StrategyScanResult } from '../../../types/scan-result'
import type { SeriesMarkerShape } from 'lightweight-charts'
import { 
  calculateEMASeries, 
  getEMAColor, 
  getEMAWidth,
  detectEMACrossovers,
  getEMACrossoverColor,
  getEMACrossoverShape,
  getEMACrossoverText,
  calculateATRSeries,
  calculateATRPercent
} from '../../utils/ema-calculator'
import { calculateRSISeries } from '../../utils/rsi-calculator'
import { calculateADXSeries } from '../../utils/adx-calculator'
import { calculateErChartMetricsSeries } from '../../utils/er-chart-series'
import { prepareCandlestickData, prepareVolumeData, getChartOptions, getPricePrecision } from './utils/kline-helpers'
import { useBotStore } from '../../stores/bot'

// 定义props
interface Props {
  historicalOrder?: TradeHistory | null
  klineData: SimpleKLineData[]
  tradeHistory?: TradeHistory[]
  scanResults?: StrategyScanResult[]
  theme?: 'light' | 'dark'
  symbol?: string
  timeframe?: string  // 如果提供，则使用提供的timeframe；否则根据策略模式自动选择
  loading?: boolean
  error?: string
  showEmaMarkers?: boolean
  showOrderMarkers?: boolean
  showScanMarkers?: boolean
  showEmaLines?: boolean
  emaPeriods?: number[]
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  klineData: () => [],
  tradeHistory: () => [],
  scanResults: () => [],
  theme: 'light',
  symbol: 'BTCUSDT',
  timeframe: '',  // 默认为空，根据策略模式自动选择
  loading: false,
  error: '',
  showEmaMarkers: false,
  showOrderMarkers: false,
  showScanMarkers: false,
  showEmaLines: true,
  emaPeriods: () => [20, 200],
  height: 500
})

// 使用Pinia store获取配置
const botStore = useBotStore()
const selectedRiskPosition = useChartPosition(() => props.symbol)

// 计算EMA周期 - 优先使用props.emaPeriods，否则从配置获取
const emaPeriods = computed(() => {
  if (props.emaPeriods && props.emaPeriods.length >= 2) {
    return props.emaPeriods
  }
  
  return botStore.config?.emaPeriods || [20, 200]
})

// 缓存EMA序列，避免重复计算
const cachedEmaSeries = ref<{
  fast: Array<{ time: number; value: number }>
  slow: Array<{ time: number; value: number }>
  diffPercent: number[]
} | null>(null)

// 缓存ATR百分比序列
const cachedAtrPercentSeries = ref<number[] | null>(null)

// 缓存RSI序列
const cachedRsiSeries = ref<number[] | null>(null)

// 缓存ADX序列
const cachedAdxSeries = ref<Array<{ adx: number; plusDI: number; minusDI: number }> | null>(null)

// 监听klineData和emaPeriods变化，预计算EMA序列和差值
watch(() => [props.klineData, emaPeriods.value, props.showEmaLines], () => {
  if (!props.showEmaLines || emaPeriods.value.length < 2 || props.klineData.length === 0) {
    cachedEmaSeries.value = null
    return
  }
  
  const fastPeriod = emaPeriods.value[0]
  const slowPeriod = emaPeriods.value[1]
  
  if (!fastPeriod || !slowPeriod) {
    cachedEmaSeries.value = null
    return
  }
  
  // 只在数据变化时重新计算整个序列
  const fastEmaSeries = calculateEMASeries(props.klineData, fastPeriod)
  const slowEmaSeries = calculateEMASeries(props.klineData, slowPeriod)
  
  if (fastEmaSeries.length === 0 || slowEmaSeries.length === 0) {
    cachedEmaSeries.value = null
    return
  }
  
  // 预计算所有K线对应的差值百分比
  const diffPercent: number[] = []
  for (let i = 0; i < fastEmaSeries.length; i++) {
    const fast = fastEmaSeries[i]?.value || 0
    const slow = slowEmaSeries[i]?.value || 0
    if (slow === 0) {
      diffPercent.push(0)
    } else {
      diffPercent.push(((fast - slow) / slow) * 100)
    }
  }
  
  cachedEmaSeries.value = {
    fast: fastEmaSeries,
    slow: slowEmaSeries,
    diffPercent
  }
}, { deep: true, immediate: true })

// 计算最新EMA差值百分比
const emaDiffPercent = computed<number | null>(() => {
  if (!cachedEmaSeries.value || cachedEmaSeries.value.diffPercent.length === 0) {
    return null
  }
  
  return cachedEmaSeries.value.diffPercent[cachedEmaSeries.value.diffPercent.length - 1] ?? null
})

// 监听klineData变化，预计算ATR百分比序列
watch(() => props.klineData, () => {
  if (props.klineData.length === 0) {
    cachedAtrPercentSeries.value = null
    return
  }
  
  // 全量递推：实测证明 ATR 收敛型递推的最新值与后端 requiredCandles 窗口一致，
  // 且每根K线都能获得 ATR 值（不会出现历史段为 0）
  const atrSeries = calculateATRSeries(props.klineData, 14)
  if (atrSeries.length === 0) {
    cachedAtrPercentSeries.value = null
    return
  }
  
  // 计算ATR百分比
  const atrPercent: number[] = []
  for (let i = 0; i < atrSeries.length; i++) {
    const atr = atrSeries[i]?.value || 0
    const price = props.klineData[i]?.c || 0
    atrPercent.push(calculateATRPercent(atr, price))
  }
  
  cachedAtrPercentSeries.value = atrPercent
}, { deep: true, immediate: true })

// 监听klineData变化，预计算RSI序列
watch(() => props.klineData, () => {
  if (props.klineData.length === 0) {
    cachedRsiSeries.value = null
    return
  }
  
  const rsiSeries = calculateRSISeries(props.klineData, 14)
  if (rsiSeries.length === 0) {
    cachedRsiSeries.value = null
    return
  }
  
  cachedRsiSeries.value = rsiSeries.map(item => item.value || 0)
}, { deep: true, immediate: true })

// 监听klineData变化，预计算ADX序列
watch(() => props.klineData, () => {
  if (props.klineData.length === 0) {
    cachedAdxSeries.value = null
    return
  }
  
  const adxSeries = calculateADXSeries(props.klineData, 14)
  if (adxSeries.length === 0) {
    cachedAdxSeries.value = null
    return
  }
  
  cachedAdxSeries.value = adxSeries.map(item => ({
    adx: item.adx || 0,
    plusDI: item.plusDI || 0,
    minusDI: item.minusDI || 0
  }))
}, { deep: true, immediate: true })

// 定义emits
const emit = defineEmits<{
  'tooltip-update': [data: { 
    open: number
    high: number
    low: number
    close: number
    volume: number
    changePercent: number
    emaDiffPercent?: number | null
    atrPercent?: number | null
    rsi?: number | null
    adx?: number | null
    pdi?: number | null
    mdi?: number | null
    er?: number | null
    erChangePercent?: number | null
  }, time: string]
  'order-click': [orders: TradeHistory[], klineTime: number]
  'scan-click': [results: StrategyScanResult[], klineTime: number]
  'retry': []
}>()

// 图表相关
const chartContainer = ref<HTMLElement | null>(null)
let chart: any = null
let candlestickSeries: any = null
let volumeSeries: any = null
let emaSeries: any[] = []
let resizeObserver: ResizeObserver | null = null
let markersApi: any = null
// 标记图表是否已经完成过首次数据渲染，后续任何数据校正都不能重新套用默认视图。
let hasRenderedKlineData = false
// 记录图表当前最后一根K线时间，区分“追加新柱”和“校正同一根柱”。
let renderedLastKlineTime: number | null = null
// 临时K线已通过 series.update 直接写入，跳过随后响应式变更触发的一次全量 setData。
let skipNextChartDataSync = false

// 使用props.timeframe，如果为空则使用默认值1h
const computedTimeframe = computed(() => {
  // 如果props提供了timeframe，则使用提供的值
  if (props.timeframe) return props.timeframe
  
  // 否则使用默认值1h
  return '1h'
})

// 根据实际价格数据自适应图表轴精度
const priceFormat = computed(() => {
  const prices = props.klineData.map(k => k.c)
  const { precision, minMove } = getPricePrecision(prices)
  return {
    type: 'price' as const,
    precision,
    minMove
  }
})

const chartHeight = computed(() => Math.max(250, props.height || 500))
const chartWrapperHeight = computed(() => `${chartHeight.value}px`)

// 生成订单标记数据
const generateMarkers = () => {
  // 如果订单标记开关关闭，返回空数组
  if (!props.showOrderMarkers) {
    return []
  }
  
  // 获取当前时间周期（优先使用props.timeframe，否则使用computedTimeframe）
  const currentTimeframe = props.timeframe || computedTimeframe.value
  
  // 日线展示历史订单开平仓标记，周线仍隐藏以保持长周期图表可读性。
  const hideMarkersTimeframes = ['1w']
  if (!props.historicalOrder && hideMarkersTimeframes.includes(currentTimeframe)) {
    return []
  }
  
  // 如果交易历史为空，返回空数组
  if (!props.tradeHistory || props.tradeHistory.length === 0) {
    return []
  }

  const firstKlineTime = props.klineData[0]?.t
  const lastKlineTime = props.klineData[props.klineData.length - 1]?.t
  if (firstKlineTime === undefined || lastKlineTime === undefined) {
    return []
  }

  /**
   * 图表库会把数据范围外的标记夹到首尾 K 线上，因此必须在聚合前过滤。
   */
  const isWithinLoadedKlineRange = (klineTime: number) => {
    return klineTime >= firstKlineTime && klineTime <= lastKlineTime
  }
  
  // 按 K线时间 聚合每种类型的数量（同一类型同一时间合并）
  // key: `${klineTime}|${type}`, value: 数量
  type OrderType = '开多' | '开空' | '平多' | '平空'
  const countMap = new Map<string, number>()
  
  for (const order of props.tradeHistory) {
    const openTime = alignToKlineTime(order.openTime, currentTimeframe)
    const closeTime = alignToKlineTime(order.closeTime, currentTimeframe)
    
    // 开仓和平仓独立过滤：订单可能在图表范围前开仓，但在当前范围内平仓。
    if (isWithinLoadedKlineRange(openTime)) {
      const openType: OrderType = order.direction === 'LONG' ? '开多' : '开空'
      const openKey = `${openTime}|${openType}`
      countMap.set(openKey, (countMap.get(openKey) || 0) + 1)
    }
    
    // 日内开平仓也要在日线上完整展示，两类标记分别按数量聚合。
    if ((currentTimeframe === '1d' || closeTime !== openTime) && isWithinLoadedKlineRange(closeTime)) {
      const closeType: OrderType = order.direction === 'LONG' ? '平多' : '平空'
      const closeKey = `${closeTime}|${closeType}`
      countMap.set(closeKey, (countMap.get(closeKey) || 0) + 1)
    }
  }
  
  const markers: Array<{
    time: number
    position: 'aboveBar' | 'belowBar'
    color: string
    shape: SeriesMarkerShape
    text: string
  }> = []
  
  for (const [key, count] of countMap) {
    const parts = key.split('|')
    const timeStr = parts[0]
    const type = parts[1]
    if (!timeStr || !type) continue
    
    const klineTime = parseInt(timeStr, 10)
    if (isNaN(klineTime)) continue
    
    const orderType = type as OrderType
    
    if (orderType === '开多') {
      // 开多：向上箭头，下面
      markers.push({
        time: klineTime,
        position: 'belowBar' as const,
        color: '#8dd4a8',
        shape: 'arrowUp' as SeriesMarkerShape,
        text: count > 1 ? `${orderType}×${count}` : orderType
      })
    } else if (orderType === '开空') {
      // 开空：向下箭头，上面
      markers.push({
        time: klineTime,
        position: 'aboveBar' as const,
        color: '#e89898',
        shape: 'arrowDown' as SeriesMarkerShape,
        text: count > 1 ? `${orderType}×${count}` : orderType
      })
    } else if (orderType === '平多') {
      // 平多：下面，蓝色圆形
      markers.push({
        time: klineTime,
        position: 'belowBar' as const,
        color: '#88bce0',
        shape: 'circle' as SeriesMarkerShape,
        text: count > 1 ? `${orderType}×${count}` : orderType
      })
    } else {
      // 平空：上面，蓝色圆形
      markers.push({
        time: klineTime,
        position: 'aboveBar' as const,
        color: '#88bce0',
        shape: 'circle' as SeriesMarkerShape,
        text: count > 1 ? `${orderType}×${count}` : orderType
      })
    }
  }
  
  // 按时间升序排序（lightweight-charts 5.x 要求）
  return markers.sort((a, b) => a.time - b.time)
}

/**
 * 将同一根 K 线内的多条扫描日志聚合为一个标记，避免高频扫描遮住蜡烛图。
 */
const generateScanMarkers = () => {
  if (!props.showScanMarkers || !props.scanResults?.length) return []

  const resultsByKline = new Map<number, StrategyScanResult[]>()
  for (const result of props.scanResults) {
    const results = resultsByKline.get(result.klineTime) || []
    results.push(result)
    resultsByKline.set(result.klineTime, results)
  }

  return Array.from(resultsByKline.entries()).map(([time, results]) => {
    // 小圆点保留每根 K 线的可点击入口，同时用颜色表达扫描阶段，避免文字遮挡行情。
    const color = results.some(result => result.level === 'SUCCESS')
      ? '#2f9e69'
      : results.some(result => !result.skipped)
        ? '#d79b28'
        : '#8b929c'

    return {
      time,
      position: 'aboveBar' as const,
      color,
      shape: 'circle' as SeriesMarkerShape,
      text: ''
    }
  })
}

// 生成EMA交叉标记数据
const generateEMACrossoverMarkers = () => {
  // 如果EMA标记开关关闭，返回空数组
  if (!props.showEmaMarkers) {
    return []
  }
  
  // 获取当前时间周期（优先使用props.timeframe，否则使用computedTimeframe）
  const currentTimeframe = props.timeframe || computedTimeframe.value
  
  // 在1d和1w时间周期下不显示标记（提高长周期图表可读性）
  const hideMarkersTimeframes = ['1d', '1w']
  if (hideMarkersTimeframes.includes(currentTimeframe)) {
    return []
  }
  
  // 检查是否有足够的EMA周期数据
  if (emaPeriods.value.length < 2) {
    console.log('⚠️ EMA周期配置不足，无法检测交叉点')
    return []
  }
  
  // 获取快线和慢线周期
  const fastPeriod = emaPeriods.value[0]
  const slowPeriod = emaPeriods.value[1]
  
  if (!fastPeriod || !slowPeriod) {
    console.log('⚠️ EMA周期配置不完整')
    return []
  }
  
  // 检测EMA交叉点
  const crossovers = detectEMACrossovers(props.klineData, fastPeriod, slowPeriod)
  
  if (crossovers.length === 0) {
    // console.log(`📊 未检测到EMA${fastPeriod}和EMA${slowPeriod}的交叉点`)
    return []
  }
  
  // 转换为图表标记
  const markers = crossovers.map(crossover => {
    const color = getEMACrossoverColor(crossover.type)
    const shape = getEMACrossoverShape(crossover.type)
    const text = getEMACrossoverText(crossover.type, crossover.atrPercent)
    
    if (crossover.type === 'golden') {
      return {
        time: crossover.time,
        position: 'aboveBar' as const,
        color,
        shape,
        text,
        price: crossover.price
      }
    } else {
      return {
        time: crossover.time,
        position: 'belowBar' as const,
        color,
        shape,
        text,
        price: crossover.price
      }
    }
  })
  
  return markers
}

// 缓存上一次的标记数据，用于避免重复更新
let lastMarkersHash = ''
let updateMarkersTimeout: NodeJS.Timeout | null = null

// 计算标记数据的哈希值，用于比较是否发生变化
const calculateMarkersHash = (markers: any[]): string => {
  if (markers.length === 0) return 'empty'
  return markers.map(marker => `${marker.time}:${marker.position}:${marker.shape}:${marker.color}:${marker.text}`).join('|')
}

// 更新图表标记（带防抖和缓存）
const updateMarkers = (immediate = false) => {
  if (!candlestickSeries) return
  
  // 清除已有的防抖定时器
  if (updateMarkersTimeout) {
    clearTimeout(updateMarkersTimeout)
    updateMarkersTimeout = null
  }
  
  // 立即执行或设置防抖延迟
  const executeUpdate = () => {
    try {
      // 获取订单标记和EMA交叉标记
      const orderMarkers = generateMarkers()
      const emaCrossoverMarkers = generateEMACrossoverMarkers()
      const scanMarkers = generateScanMarkers()

      // lightweight-charts 要求标记按时间升序排列。
      const sortedMarkers = [...orderMarkers, ...emaCrossoverMarkers, ...scanMarkers]
        .sort((a, b) => a.time - b.time)
      
      // 计算当前标记的哈希值
      const currentHash = calculateMarkersHash(sortedMarkers)
      
      // 如果标记没有变化，跳过更新
      if (currentHash === lastMarkersHash) {
        // console.log('📊 标记未变化，跳过更新')
        return
      }
      
      // 更新缓存
      lastMarkersHash = currentHash
      
      // 如果已经有markersApi，使用setMarkers更新
      if (markersApi) {
        markersApi.setMarkers(sortedMarkers)
      } else {
        // 第一次创建markersApi
        markersApi = createSeriesMarkers(candlestickSeries, sortedMarkers)
      }
      
      console.log(`📊 更新图表标记：订单${orderMarkers.length}个，EMA交叉${emaCrossoverMarkers.length}个，扫描${scanMarkers.length}个`)
      
    } catch (error) {
      console.warn('更新图表标记失败:', error)
    }
  }
  
  if (immediate) {
    executeUpdate()
  } else {
    // 防抖延迟：100ms，避免短时间内多次更新
    updateMarkersTimeout = setTimeout(executeUpdate, 100)
  }
}

// 清理订单标记
const clearMarkers = () => {
  if (!candlestickSeries) return
  
  try {
    // 使用空数组来清除所有标记
    if (markersApi) {
      markersApi.setMarkers([])
    } else {
      createSeriesMarkers(candlestickSeries, [])
    }
    lastMarkersHash = ''
  } catch (error) {
    console.warn('清理订单标记失败:', error)
  }
}

// 将时间戳对齐到K线时间
const alignToKlineTime = (timestamp: number, timeframe: string): number => {
  const timeframeSeconds = getTimeframeSeconds(timeframe)
  return Math.floor(timestamp / 1000 / timeframeSeconds) * timeframeSeconds
}

// 根据K线时间查找该K线上所有的订单记录
const findOrdersByKlineTime = (clickedKlineTime: number, timeframe: string): TradeHistory[] => {
  if (!props.tradeHistory || props.tradeHistory.length === 0) return []
  
  return props.tradeHistory.filter(order => {
    const openTime = alignToKlineTime(order.openTime, timeframe)
    const closeTime = alignToKlineTime(order.closeTime, timeframe)
    return openTime === clickedKlineTime || closeTime === clickedKlineTime
  })
}

/**
 * 查找点击 K 线中发生的全部扫描，保留同一周期内的多次结果。
 */
const findScansByKlineTime = (clickedKlineTime: number): StrategyScanResult[] => {
  if (!props.scanResults?.length) return []
  return props.scanResults.filter(result => result.klineTime === clickedKlineTime)
}

// 获取时间段的秒数
const getTimeframeSeconds = (timeframe: string): number => {
  switch (timeframe) {
    case '1m': return 60
    case '5m': return 5 * 60
    case '15m': return 15 * 60
    case '1h': return 60 * 60
    case '4h': return 4 * 60 * 60
    case '1d': return 24 * 60 * 60
    case '1w': return 7 * 24 * 60 * 60
    default: return 60 * 60
  }
}

// 首页启用盘中 ER 预览；按 K 线索引读取，避免悬停历史时显示最新指标。
const cachedErSeries = computed(() => calculateErChartMetricsSeries(
  props.klineData,
  computedTimeframe.value as Parameters<typeof calculateErChartMetricsSeries>[1],
  getTimeframeSeconds(computedTimeframe.value),
  Date.now(),
  undefined,
  { includeOpen: true }
))

// 初始化图表
const initChart = () => {
  if (!chartContainer.value) return
  
  console.log(`📈 初始化图表 (symbol: ${props.symbol}, timeframe: ${computedTimeframe.value})`)
  
  // 清理现有图表
  if (chart) {
    try {
      chart.remove()
    } catch (error) {
      console.warn('清理现有图表失败:', error)
    }
  }
  
  // 创建新图表
  const chartOptions = {
    ...getChartOptions(props.theme),
    width: chartContainer.value.clientWidth,
    height: chartHeight.value
  }
  
  chart = createChart(chartContainer.value, chartOptions)
  
  // 获取当前价格格式
  const currentPriceFormat = priceFormat.value
  
  // 添加K线系列
  candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    priceFormat: currentPriceFormat,
    // 自动缩放时纳入风险价位，避免止盈止损超出当前蜡烛价格范围而不可见。
    autoscaleInfoProvider: (original: () => any) => {
      const info = original()
      const position = selectedRiskPosition.value
      if (!info || !position || position.symbol.replace('/', '').toUpperCase() !== props.symbol.replace('/', '').toUpperCase()) return info
      const prices = [position.entryPrice, position.stopLoss || position.initialStopLoss, position.takeProfit1, position.takeProfit2]
        .map(Number).filter(price => Number.isFinite(price) && price > 0)
      return { ...info, priceRange: {
        minValue: Math.min(info.priceRange.minValue, ...prices),
        maxValue: Math.max(info.priceRange.maxValue, ...prices)
      } }
    }
  })
  
  // 添加成交量系列
  volumeSeries = chart.addSeries(HistogramSeries, {
    color: '#26a69a',
    priceFormat: { type: 'volume' },
    priceScaleId: ''
  })
  
  // 设置成交量坐标轴位置
  chart.priceScale('').applyOptions({
    scaleMargins: {
      top: 0.8,
      bottom: 0
    }
  })
  
  // 清空EMA系列数组
  emaSeries = []
  
  // 添加EMA线（根据emaPeriods配置和开关状态）
  if (props.showEmaLines) {
    for (const period of emaPeriods.value) {
      const emaSeriesItem = chart.addSeries(LineSeries, {
        color: getEMAColor(period),
        lineWidth: getEMAWidth(period),
        title: `EMA${period}`,
        priceFormat: currentPriceFormat
      })
      emaSeries.push(emaSeriesItem)
    }
  }
  
  // 响应窗口大小变化
  resizeObserver = new ResizeObserver(() => {
    if (chart && chartContainer.value) {
      chart.applyOptions({
        width: chartContainer.value.clientWidth,
        height: chartHeight.value
      })
    }
  })
  
  resizeObserver.observe(chartContainer.value)
  
  // 监听鼠标移动事件
  chart.subscribeCrosshairMove((param: any) => {
    if (param.time) {
      // 找到对应的K线数据
      const kline = findKlineByTime(props.klineData, param.time)
      if (kline) {
        // 触发tooltip更新事件
        emitTooltipUpdate(kline)
      }
    }
  })
  
  // 监听点击事件 —— 点击K线时处理订单详情
  chart.subscribeClick((param: any) => {
    if (!param.point || !param.time) return
    
    const currentTimeframe = props.timeframe || computedTimeframe.value
    const clickedKlineTime = param.time as number
    
    const matchedScans = props.showScanMarkers ? findScansByKlineTime(clickedKlineTime) : []

    // 扫描详情是模态弹窗；同一 K 线也有订单时优先显示扫描，避免两个详情层重叠。
    if (matchedScans.length > 0) {
      emit('order-click', [], clickedKlineTime)
      emit('scan-click', matchedScans, clickedKlineTime)
      return
    }

    // 查找该K线时间对应的所有订单（无订单时返回空数组）
    const matchedOrders = props.tradeHistory && props.tradeHistory.length > 0
      ? findOrdersByKlineTime(clickedKlineTime, currentTimeframe)
      : []
    emit('order-click', matchedOrders, clickedKlineTime)
    emit('scan-click', [], clickedKlineTime)
  })
  
  // 更新图表数据
  updateChart()
}

// 根据时间查找K线数据
const findKlineByTime = (klineData: SimpleKLineData[], time: number): SimpleKLineData | null => {
  if (!klineData.length) return null
  
  // 使用二分查找找到最接近的时间
  let left = 0
  let right = klineData.length - 1
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midKline = klineData[mid]
    if (!midKline) return null
    
    const midTime = midKline.t
    
    if (midTime === time) {
      return midKline
    } else if (midTime < time) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  
  // 如果没有精确匹配，返回最接近的数据
  if (right >= 0 && right < klineData.length) {
    const kline = klineData[right]
    return kline || null
  }
  
  return null
}

// 触发tooltip更新事件
const emitTooltipUpdate = (kline: SimpleKLineData) => {
  const changePercent = ((kline.c - kline.o) / kline.o) * 100
  const timeStr = new Date(kline.t * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

  // 找到当前K线的索引
  const klineIndex = props.klineData.findIndex(item => item.t === kline.t)
  
  // 从缓存中获取当前K线对应的EMA差值百分比
  let emaDiff: number | null = null
  if (cachedEmaSeries.value && klineIndex >= 0 && klineIndex < cachedEmaSeries.value.diffPercent.length) {
    emaDiff = cachedEmaSeries.value.diffPercent[klineIndex] ?? null
  }
  
  // 获取ATR百分比
  let atrPercent: number | null = null
  if (cachedAtrPercentSeries.value && klineIndex >= 0 && klineIndex < cachedAtrPercentSeries.value.length) {
    atrPercent = cachedAtrPercentSeries.value[klineIndex] ?? null
  }
  
  // 获取RSI
  let rsi: number | null = null
  if (cachedRsiSeries.value && klineIndex >= 0 && klineIndex < cachedRsiSeries.value.length) {
    rsi = cachedRsiSeries.value[klineIndex] ?? null
  }
  
  // 同一根 K 线的 ADX、PDI、MDI 共用缓存，保证悬停时指标时间一致。
  let adx: number | null = null
  let pdi: number | null = null
  let mdi: number | null = null
  if (cachedAdxSeries.value && klineIndex >= 0 && klineIndex < cachedAdxSeries.value.length) {
    adx = cachedAdxSeries.value[klineIndex]?.adx ?? null
    pdi = cachedAdxSeries.value[klineIndex]?.plusDI ?? null
    mdi = cachedAdxSeries.value[klineIndex]?.minusDI ?? null
  }
  
  emit('tooltip-update', {
    open: kline.o,
    high: kline.h,
    low: kline.l,
    close: kline.c,
    volume: kline.v || 0,
    changePercent,
    emaDiffPercent: emaDiff,
    atrPercent,
    rsi,
    adx,
    pdi,
    mdi,
    er: cachedErSeries.value[klineIndex]?.er ?? null,
    erChangePercent: cachedErSeries.value[klineIndex]?.netChangePercent ?? null
  }, timeStr)
}

// 更新最后一根K线数据
const updateLastKline = (updatedKline: SimpleKLineData) => {
  if (!candlestickSeries || !volumeSeries) return

  try {
    const timeScale = chart?.timeScale()
    const previousLogicalRange = timeScale?.getVisibleLogicalRange?.() ?? null
    const wasFollowingLatest = (timeScale?.scrollPosition?.() ?? 0) <= 1

    // 更新K线数据
    const candlestickData = {
      time: updatedKline.t,
      open: updatedKline.o,
      high: updatedKline.h,
      low: updatedKline.l,
      close: updatedKline.c
    }
    
    // 使用update方法只更新最后一根K线
    candlestickSeries.update(candlestickData)
    
    // 更新成交量
    const volumeData = {
      time: updatedKline.t,
      value: updatedKline.v || 0,
      color: updatedKline.c >= updatedKline.o ? '#26a69a' : '#ef5350'
    }
    volumeSeries.update(volumeData)

    // 用户查看历史位置时，禁止 update() 自动把时间轴推到最新K线。
    if (previousLogicalRange && !wasFollowingLatest) {
      timeScale.setVisibleLogicalRange(previousLogicalRange)
    }
    renderedLastKlineTime = updatedKline.t
    
    // 重新计算整个EMA序列并更新最后一根K线的EMA值
    // 注意：这里我们只更新最后一根K线的EMA值，而不是重新计算整个序列
    // 因为EMA计算需要整个历史数据，我们已经在updateChart中设置了完整的EMA数据
    // 这里只需要更新最后一根K线的EMA值
    
    // 获取当前props.klineData的副本并更新最后一根K线
    const updatedKlineData = [...props.klineData]
    const lastIndex = updatedKlineData.length - 1
    if (lastIndex >= 0) {
      updatedKlineData[lastIndex] = updatedKline
      
      // 为每个EMA周期更新最后一根K线的EMA值
      for (let i = 0; i < emaPeriods.value.length; i++) {
        const period = emaPeriods.value[i]
        const emaSeriesItem = emaSeries[i]
        
        if (period && emaSeriesItem) {
          const emaData = calculateEMASeries(updatedKlineData, period)
          if (emaData.length > 0) {
            // 只更新最后一根K线的EMA值
            const lastEma = emaData[emaData.length - 1]
            if (lastEma) {
              emaSeriesItem.update(lastEma)
            }
          }
        }
      }
    }
    
    // 如果tooltip正在显示，更新tooltip
    if (chart && typeof chart.getCrosshairPosition === 'function') {
      const crosshairPosition = chart.getCrosshairPosition()
      if (crosshairPosition && crosshairPosition.time === updatedKline.t) {
        emitTooltipUpdate(updatedKline)
      }
    }
  } catch (error) {
    console.error('更新最后一根K线失败:', error)
  }
}

// 追加新K线数据
const appendNewKline = (newKline: SimpleKLineData) => {
  if (!candlestickSeries || !volumeSeries) return

  try {
    const timeScale = chart?.timeScale()
    const previousLogicalRange = timeScale?.getVisibleLogicalRange?.() ?? null
    const wasFollowingLatest = (timeScale?.scrollPosition?.() ?? 0) <= 1

    // 准备新K线数据
    const candlestickData = {
      time: newKline.t,
      open: newKline.o,
      high: newKline.h,
      low: newKline.l,
      close: newKline.c
    }
    
    // 使用update方法追加新K线（如果时间戳不存在，update会自动追加）
    candlestickSeries.update(candlestickData)
    
    // 更新成交量
    const volumeData = {
      time: newKline.t,
      value: newKline.v || 0,
      color: newKline.c >= newKline.o ? '#26a69a' : '#ef5350'
    }
    volumeSeries.update(volumeData)

    // 仅跟随最新行情时自动右移；用户拖动到历史位置时保持原位置。
    if (previousLogicalRange && !wasFollowingLatest) {
      timeScale.setVisibleLogicalRange(previousLogicalRange)
    }
    renderedLastKlineTime = newKline.t
    skipNextChartDataSync = true
    
    // 重新计算整个EMA序列并追加新K线的EMA值
    // 获取当前props.klineData的副本并追加新K线
    const updatedKlineData = [...props.klineData, newKline]
    
    // 为每个EMA周期更新EMA值
    for (let i = 0; i < emaPeriods.value.length; i++) {
      const period = emaPeriods.value[i]
      const emaSeriesItem = emaSeries[i]
      
      if (period && emaSeriesItem) {
        const emaData = calculateEMASeries(updatedKlineData, period)
        if (emaData.length > 0) {
          // 只更新最后一根K线的EMA值（新追加的K线）
          const lastEma = emaData[emaData.length - 1]
          if (lastEma) {
            emaSeriesItem.update(lastEma)
          }
        }
      }
    }
    
    // 如果tooltip正在显示，更新tooltip
    if (chart && typeof chart.getCrosshairPosition === 'function') {
      const crosshairPosition = chart.getCrosshairPosition()
      if (crosshairPosition && crosshairPosition.time === newKline.t) {
        emitTooltipUpdate(newKline)
      }
    }
    
    console.log(`✅ 已追加新K线: ${new Date(newKline.t * 1000).toLocaleString()}`)
  } catch (error) {
    console.error('追加新K线失败:', error)
  }
}

// 更新图表数据
/**
 * 更新图表数据。
 * @param preserveViewport 是否保留当前可视范围；后台同步新K线时必须开启，避免视图跳动。
 */
const updateChart = (preserveViewport = false) => {
  if (!chart || !candlestickSeries || !volumeSeries) {
    initChart()
    return
  }
  
  if (props.klineData.length === 0) return
  
  // 过滤无效数据：close <= 0 的 K 线视为无效（价格尚未就绪或旧 symbol 数据残留）
  const validData = props.klineData.filter(k => k.c > 0 && k.o > 0 && k.h > 0 && k.l > 0)
  if (validData.length === 0) return

  if (skipNextChartDataSync) {
    skipNextChartDataSync = false
    updateMarkers()
    return
  }
  
  // 更新价格精度（切换交易对时数据到达后需更新 Y 轴精度，避免沿用旧交易对的 precision）
  const currentPriceFormat = priceFormat.value
  candlestickSeries.applyOptions({ priceFormat: currentPriceFormat })
  for (const ema of emaSeries) {
    ema.applyOptions({ priceFormat: currentPriceFormat })
  }
  
  // 后台同步时记录可视范围，setData 后恢复，避免周期结束换柱时出现整图跳动。
  const shouldPreserveViewport = preserveViewport || hasRenderedKlineData
  const timeScale = chart.timeScale()
  const previousVisibleRange = shouldPreserveViewport ? timeScale.getVisibleRange() : null
  const previousLogicalRange = shouldPreserveViewport
    ? timeScale.getVisibleLogicalRange?.()
    : null
  const wasFollowingLatest = (timeScale.scrollPosition?.() ?? 0) <= 1
  const latestKlineTime = validData[validData.length - 1]?.t ?? null
  const isSameLastKline = renderedLastKlineTime !== null && renderedLastKlineTime === latestKlineTime

  // 准备数据（使用过滤后的有效数据）
  const candlestickData = prepareCandlestickData(validData)
  const volumeData = prepareVolumeData(validData)
  
  // 设置数据
  candlestickSeries.setData(candlestickData)
  volumeSeries.setData(volumeData)
  
  // 计算并设置EMA数据
  if (emaSeries.length > 0) {
    for (let i = 0; i < emaPeriods.value.length; i++) {
      const period = emaPeriods.value[i]
      const emaSeriesItem = emaSeries[i]
      
      if (period && emaSeriesItem) {
        const emaData = calculateEMASeries(props.klineData, period)
        if (emaData.length > 0) {
          emaSeriesItem.setData(emaData)
        }
      }
    }
  }
  
  // 初次加载时设置默认显示200根K线；增量同步只恢复原视口，不重新 fitContent。
  if (candlestickData.length > 0 && !shouldPreserveViewport) {
    const visibleBarCount = 200
    const totalBars = candlestickData.length
    
    if (totalBars <= visibleBarCount) {
      chart.timeScale().fitContent()
    } else {
      const fromIndex = totalBars - visibleBarCount
      const fromItem = candlestickData[fromIndex]
      const toItem = candlestickData[totalBars - 1]
      
      if (fromItem && toItem) {
        chart.timeScale().setVisibleRange({
          from: fromItem.time,
          to: toItem.time
        })
        if (import.meta.client) {
          setTimeout(() => {
            if (chart) {
              chart.timeScale().applyOptions({
                rightOffset: 30
              })
            }
          }, 0)
        }
      } else {
        chart.timeScale().fitContent()
      }
    }
  } else if (previousVisibleRange && (!wasFollowingLatest || isSameLastKline)) {
    const restoreViewport = () => {
      if (!chart) return
      if (previousLogicalRange) {
        chart.timeScale().setVisibleLogicalRange(previousLogicalRange)
      } else {
        chart.timeScale().setVisibleRange(previousVisibleRange)
      }
    }
    restoreViewport()
    // setData 后图表库可能在当前帧末尾重新计算时间范围，再补一次恢复以抵御该异步调整。
    if (import.meta.client) requestAnimationFrame(restoreViewport)
  }

  hasRenderedKlineData = true
  renderedLastKlineTime = latestKlineTime
  
  // 更新订单标记
  updateMarkers()
}

/**
 * 获取图表当前可视区域对应的时间范围。
 *
 * 返回毫秒时间戳，并将结束时间扩展到最后一根可见 K 线的周期末尾，
 * 便于父组件直接作为扫描查询和日期范围控件的默认值。
 */
const getVisibleTimeRange = (): [number, number] | null => {
  const visibleRange = chart?.timeScale().getVisibleRange()
  if (!visibleRange || typeof visibleRange.from !== 'number' || typeof visibleRange.to !== 'number') {
    return null
  }

  const timeframeSeconds = getTimeframeSeconds(props.timeframe || computedTimeframe.value)
  return [
    visibleRange.from * 1000,
    (visibleRange.to + timeframeSeconds) * 1000 - 1
  ]
}

// 监听数据变化 - 只在数据长度变化或初始加载时刷新图表
watch(() => props.klineData, (newData, oldData) => {
  // 如果数据为空，不刷新
  if (!newData || newData.length === 0) return
  
  // 如果旧数据为空，说明是初始加载，刷新图表
  if (!oldData || oldData.length === 0) {
    updateChart(false)
    return
  }
  
  // 如果数据长度变化，刷新图表
  if (newData.length !== oldData.length) {
    updateChart(true)
    return
  }

  // 数据长度不变时，仍需处理“窗口滑动/新周期替换”场景
  // 例如：数据达到上限后，头部移除一根、尾部新增一根，长度不变但内容已变化
  const newFirst = newData[0]
  const oldFirst = oldData[0]
  const newLast = newData[newData.length - 1]
  const oldLast = oldData[oldData.length - 1]

  // 任一关键时间戳变化都需要整图刷新
  if ((newFirst && oldFirst && newFirst.t !== oldFirst.t) ||
      (newLast && oldLast && newLast.t !== oldLast.t)) {
    updateChart(true)
    return
  }

  // 如果只是最后一根K线更新，不刷新整个图表
  // 这个情况由 updateLastKline 方法处理
}, { deep: true })

// 监听主题变化
watch(() => props.theme, () => {
  if (chart) {
    chart.applyOptions(getChartOptions(props.theme))
  }
})

watch(() => chartHeight.value, (height) => {
  if (chart && chartContainer.value) {
    chart.applyOptions({
      width: chartContainer.value.clientWidth,
      height
    })
  }
})

// 监听标记相关数据变化（合并监听器，减少触发次数）
watch(() => ({
  tradeHistory: props.tradeHistory,
  scanResults: props.scanResults,
  showEmaMarkers: props.showEmaMarkers,
  showOrderMarkers: props.showOrderMarkers,
  showScanMarkers: props.showScanMarkers,
  showEmaLines: props.showEmaLines
}), (newVal, oldVal) => {
  // 只有EMA线开关变化时动态添加/移除EMA系列，不重新初始化整个图表
  if (newVal.showEmaLines !== oldVal.showEmaLines) {
    if (chart && candlestickSeries) {
      if (newVal.showEmaLines) {
        // 开启EMA线：添加EMA系列并设置数据
        const currentPriceFormat = priceFormat.value
        emaSeries = []
        for (const period of emaPeriods.value) {
          const emaSeriesItem = chart.addSeries(LineSeries, {
            color: getEMAColor(period),
            lineWidth: getEMAWidth(period),
            title: `EMA${period}`,
            priceFormat: currentPriceFormat
          })
          emaSeries.push(emaSeriesItem)
        }
        // 设置EMA数据
        if (emaSeries.length > 0) {
          for (let i = 0; i < emaPeriods.value.length; i++) {
            const period = emaPeriods.value[i]
            const emaSeriesItem = emaSeries[i]
            
            if (period && emaSeriesItem) {
              const emaData = calculateEMASeries(props.klineData, period)
              if (emaData.length > 0) {
                emaSeriesItem.setData(emaData)
              }
            }
          }
        }
      } else {
        // 关闭EMA线：移除所有EMA系列
        for (const emaSeriesItem of emaSeries) {
          if (emaSeriesItem) {
            chart.removeSeries(emaSeriesItem)
          }
        }
        emaSeries = []
      }
    }
  } else {
    // 其他标记变化时只更新标记
    updateMarkers(true)
  }
}, { deep: true })


// 组件挂载时初始化
onMounted(() => {
  nextTick(() => {
    initChart()
  })
})

// 清理图表资源
const cleanupChart = () => {
  
  // 停止所有可能的动画或更新
  if (chart) {
    try {
      // 取消订阅所有事件监听
      chart.unsubscribeCrosshairMove()
      
      // 移除所有系列
      if (candlestickSeries) {
        chart.removeSeries(candlestickSeries)
        candlestickSeries = null
      }
      if (volumeSeries) {
        chart.removeSeries(volumeSeries)
        volumeSeries = null
      }
      // 移除所有EMA系列
      for (const emaSeriesItem of emaSeries) {
        if (emaSeriesItem) {
          chart.removeSeries(emaSeriesItem)
        }
      }
      emaSeries = []
      
      // 移除图表
      chart.remove()
      chart = null
    } catch (error) {
      console.warn('清理图表资源失败:', error)
    }
  }
  
  // 清理ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  
  // 重置标记API
  markersApi = null
  hasRenderedKlineData = false
  renderedLastKlineTime = null
  skipNextChartDataSync = false
  
}

// 组件卸载前清理
onUnmounted(() => {
  cleanupChart()
})

// 监听symbol变化，清理并重新初始化图表
watch(() => props.symbol, (newSymbol, oldSymbol) => {
  if (newSymbol && newSymbol !== oldSymbol) {
    
    // 清理旧图表
    cleanupChart()
    
    // 重新初始化图表
    nextTick(() => {
      if (chartContainer.value) {
        initChart()
      }
    })
  }
})

// 监听emaPeriods变化，清理并重新初始化图表
watch(() => emaPeriods.value, (newPeriods, oldPeriods) => {
  // 检查周期是否真的变化了
  const periodsChanged = newPeriods.length !== oldPeriods.length || 
    newPeriods.some((p: number, i: number) => p !== oldPeriods[i])
  
  if (periodsChanged) {
    console.log(`📈 EMA周期变化: ${oldPeriods.join(',')} -> ${newPeriods.join(',')}`)
    
    // 清理旧图表
    cleanupChart()
    
    // 重新初始化图表
    nextTick(() => {
      if (chartContainer.value) {
        initChart()
      }
    })
  }
}, { deep: true })

// 监听timeframe变化，清理并重新初始化图表
watch(() => computedTimeframe.value, (newTimeframe: string, oldTimeframe: string) => {
  if (newTimeframe && newTimeframe !== oldTimeframe) {
    
    // 清理旧图表
    cleanupChart()
    
    // 重新初始化图表
    nextTick(() => {
      if (chartContainer.value) {
        initChart()
      }
    })
  }
})

// 暴露方法给父组件
defineExpose({
  updateLastKline,
  appendNewKline,
  clearMarkers,
  getVisibleTimeRange
})
</script>

<style scoped>
.chart-wrapper {
  position: relative;
  height: v-bind(chartWrapperHeight);
  min-height: 250px;
  overflow: hidden;
}

.kline-chart {
  width: 100%;
  height: 100%;
  min-height: 250px;
}

/* 加载状态 */
.chart-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 60px 20px;
  text-align: center;
  background: var(--bg-card);
  z-index: 10;
}

.loading-text {
  margin-top: 20px;
  color: var(--text-secondary);
  font-size: 16px;
  font-weight: 500;
}

/* 错误状态 */
.chart-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 60px 20px;
  text-align: center;
  background: var(--bg-card);
  z-index: 10;
}

.error-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
  gap: 16px;
}

/* 响应式设计 - 手机端 (480px以下) */
@media (max-width: 480px) {
  .chart-wrapper {
    min-height: 250px;
    margin: 8px;
    border-radius: 6px;
  }
  
  .kline-chart {
    min-height: 250px;
  }
  
  .chart-loading,
  .chart-error {
    padding: 30px 10px;
  }
  
  .loading-text {
    font-size: 14px;
  }
  
  .error-actions {
    flex-direction: column;
    gap: 8px;
  }
  
  .error-actions .el-button {
    width: 100%;
  }
}
</style>
