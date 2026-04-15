<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="kline-chart"></div>

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
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import type { TradeHistory, BotConfig } from '../../../types'
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
import { prepareCandlestickData, prepareVolumeData, getChartOptions } from './utils/kline-helpers'
import { isDOGESymbol } from './utils/kline-helpers'
import { useBotStore } from '../../stores/bot'

// 定义props
interface Props {
  klineData: SimpleKLineData[]
  tradeHistory?: TradeHistory[]
  theme?: 'light' | 'dark'
  symbol?: string
  timeframe?: string  // 如果提供，则使用提供的timeframe；否则根据策略模式自动选择
  loading?: boolean
  error?: string
  showEmaMarkers?: boolean
  showOrderMarkers?: boolean
  showEmaLines?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  klineData: () => [],
  tradeHistory: () => [],
  theme: 'light',
  symbol: 'BTCUSDT',
  timeframe: '',  // 默认为空，根据策略模式自动选择
  loading: false,
  error: '',
  showEmaMarkers: false,
  showOrderMarkers: false,
  showEmaLines: true
})

// 使用Pinia store获取配置
const botStore = useBotStore()

// 计算EMA周期（根据当前策略模式）
const emaPeriods = computed(() => {
  if (!botStore.config) return [14, 60] // 默认值
  
  const strategyMode = botStore.config.strategyMode
  const emaConfig = botStore.config.indicatorsConfig.emaPeriods[strategyMode]
  
  // 返回fast和slow两个周期
  return [emaConfig.fast, emaConfig.slow]
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
  }, time: string]
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

// 使用props.timeframe，如果为空则使用默认值15m
const computedTimeframe = computed(() => {
  // 如果props提供了timeframe，则使用提供的值
  if (props.timeframe) return props.timeframe
  
  // 否则使用默认值15m
  return '15m'
})

// 判断是否为DOGE交易对
const isDOGE = computed(() => isDOGESymbol(props.symbol))

// 价格格式配置
const priceFormat = computed(() => ({
  type: 'price' as const,
  precision: isDOGE.value ? 5 : 2,
  minMove: isDOGE.value ? 0.00001 : 0.01
}))

// 生成订单标记数据
const generateMarkers = () => {
  // 如果订单标记开关关闭，返回空数组
  if (!props.showOrderMarkers) {
    return []
  }
  
  // 获取当前时间周期（优先使用props.timeframe，否则使用computedTimeframe）
  const currentTimeframe = props.timeframe || computedTimeframe.value
  
  // 在1d和1w时间周期下不显示标记（提高长周期图表可读性）
  const hideMarkersTimeframes = ['1d', '1w']
  if (hideMarkersTimeframes.includes(currentTimeframe)) {
    return []
  }
  
  // 如果交易历史为空，返回空数组
  if (!props.tradeHistory || props.tradeHistory.length === 0) {
    return []
  }
  
  const markers = props.tradeHistory.flatMap(order => {
    // 转换时间格式：毫秒 -> 秒
    const openTime = alignToKlineTime(order.openTime, currentTimeframe)
    const closeTime = alignToKlineTime(order.closeTime, currentTimeframe)
    
    // 开仓标记
    const openMarker = {
      time: openTime,
      position: 'aboveBar' as const,
      color: order.direction === 'LONG' ? '#26a69a' : '#ef5350',
      shape: (order.direction === 'LONG' ? 'arrowUp' : 'arrowDown') as SeriesMarkerShape,
      text: `${order.direction} @ ${order.entryPrice.toFixed(2)}`
    }
    
    // 平仓标记（根据方向显示平多/平空）
    const closeAction = order.direction === 'LONG' ? '平多' : '平空'
    const pnlSign = order.pnl >= 0 ? '+' : ''
    
    // 第一行：平多/平空和价格
    const closeMarker1 = {
      time: closeTime,
      position: 'belowBar' as const,
      color: order.pnl >= 0 ? '#26a69a' : '#ef5350',
      shape: 'circle' as SeriesMarkerShape,
      text: `${closeAction} @ ${order.exitPrice.toFixed(2)}  ${pnlSign}${order.pnl.toFixed(2)} (${pnlSign}${order.pnlPercentage.toFixed(2)}%)`
    }
    
    
    return [openMarker, closeMarker1]
  })
  
  // 按时间升序排序（lightweight-charts 5.x 要求）
  return markers.sort((a, b) => a.time - b.time)
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
const calculateMarkersHash = (orderMarkers: any[], emaCrossoverMarkers: any[]): string => {
  const orderCount = orderMarkers.length
  const emaCount = emaCrossoverMarkers.length
  
  // 如果标记数量为0，使用特殊哈希
  if (orderCount === 0 && emaCount === 0) return 'empty'
  
  // 简单哈希：使用标记数量和第一个标记的时间（如果有）
  let hash = `${orderCount}-${emaCount}`
  
  if (orderCount > 0 && orderMarkers[0]) {
    hash += `-o${orderMarkers[0].time}`
  }
  
  if (emaCount > 0 && emaCrossoverMarkers[0]) {
    hash += `-e${emaCrossoverMarkers[0].time}`
  }
  
  return hash
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
      
      // 计算当前标记的哈希值
      const currentHash = calculateMarkersHash(orderMarkers, emaCrossoverMarkers)
      
      // 如果标记没有变化，跳过更新
      if (currentHash === lastMarkersHash) {
        // console.log('📊 标记未变化，跳过更新')
        return
      }
      
      // 更新缓存
      lastMarkersHash = currentHash
      
      // 合并所有标记
      const allMarkers = [...orderMarkers, ...emaCrossoverMarkers]
      
      // 按时间升序排序（lightweight-charts 5.x 要求）
      const sortedMarkers = allMarkers.sort((a, b) => a.time - b.time)
      
      // 如果已经有markersApi，使用setMarkers更新
      if (markersApi) {
        markersApi.setMarkers(sortedMarkers)
      } else {
        // 第一次创建markersApi
        markersApi = createSeriesMarkers(candlestickSeries, sortedMarkers)
      }
      
      console.log(`📊 更新图表标记：订单标记${orderMarkers.length}个，EMA交叉标记${emaCrossoverMarkers.length}个`)
      
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
  } catch (error) {
    console.warn('清理订单标记失败:', error)
  }
}

// 将时间戳对齐到K线时间
const alignToKlineTime = (timestamp: number, timeframe: string): number => {
  const timeframeSeconds = getTimeframeSeconds(timeframe)
  return Math.floor(timestamp / 1000 / timeframeSeconds) * timeframeSeconds
}

// 获取时间段的秒数
const getTimeframeSeconds = (timeframe: string): number => {
  switch (timeframe) {
    case '15m': return 15 * 60
    case '1h': return 60 * 60
    case '4h': return 4 * 60 * 60
    case '1d': return 24 * 60 * 60
    case '1w': return 7 * 24 * 60 * 60
    default: return 60 * 60
  }
}

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
    height: 500
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
    priceFormat: currentPriceFormat
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
      chart.applyOptions({ width: chartContainer.value.clientWidth })
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
  
  // 获取ADX
  let adx: number | null = null
  if (cachedAdxSeries.value && klineIndex >= 0 && klineIndex < cachedAdxSeries.value.length) {
    adx = cachedAdxSeries.value[klineIndex]?.adx ?? null
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
    adx
  }, timeStr)
}

// 更新最后一根K线数据
const updateLastKline = (updatedKline: SimpleKLineData) => {
  if (!candlestickSeries || !volumeSeries || emaSeries.length === 0) return
  
  try {
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
  if (!candlestickSeries || !volumeSeries || emaSeries.length === 0) return
  
  try {
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
const updateChart = () => {
  if (!chart || !candlestickSeries || !volumeSeries) {
    initChart()
    return
  }
  
  if (props.klineData.length === 0) return
  
  // 准备数据
  const candlestickData = prepareCandlestickData(props.klineData)
  const volumeData = prepareVolumeData(props.klineData)
  
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
  
  // 设置默认显示200根K线
  if (candlestickData.length > 0) {
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
                rightOffset: 12
              })
            }
          }, 0)
        }
      } else {
        chart.timeScale().fitContent()
      }
    }
  }
  
  // 更新订单标记
  updateMarkers()
}

// 监听数据变化 - 只在数据长度变化或初始加载时刷新图表
watch(() => props.klineData, (newData, oldData) => {
  // 如果数据为空，不刷新
  if (!newData || newData.length === 0) return
  
  // 如果旧数据为空，说明是初始加载，刷新图表
  if (!oldData || oldData.length === 0) {
    updateChart()
    return
  }
  
  // 如果数据长度变化，刷新图表
  if (newData.length !== oldData.length) {
    updateChart()
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
    updateChart()
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

// 监听标记相关数据变化（合并监听器，减少触发次数）
watch(() => ({
  tradeHistory: props.tradeHistory,
  showEmaMarkers: props.showEmaMarkers,
  showOrderMarkers: props.showOrderMarkers,
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

// 监听timeframe变化，清理并重新初始化图表
watch(() => computedTimeframe.value, (newTimeframe, oldTimeframe) => {
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
  clearMarkers
})
</script>

<style scoped>
.chart-wrapper {
  position: relative;
  min-height: 450px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
  background: #f8f9fa;
}

.kline-chart {
  width: 100%;
  min-height: 450px;
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
  background: white;
  z-index: 10;
}

.loading-text {
  margin-top: 20px;
  color: #6c757d;
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
  background: white;
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