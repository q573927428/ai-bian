<!-- ==================== 宏观本地轻量 K 线图 ==================== -->
<template>
  <div class="macro-local-chart">
    <div ref="container" class="canvas" @mouseenter="enterChart" @mouseleave="clearSyncedCrosshair" />
    <div v-if="!hasData" class="empty-state">
      <span>{{ loading ? '正在读取本地数据…' : error || '暂无本地数据，等待同步' }}</span>
      <button v-if="!loading" type="button" @click="load">重试</button>
    </div>
    <div class="source-status" :title="error">
      {{ market.source === 'yahoo' ? 'Yahoo Finance · 本地缓存' : '币安合约 · 本地缓存' }}
      <span v-if="updatedAt"> · 同步 {{ new Date(updatedAt).toLocaleTimeString() }}</span>
      <span v-if="error && hasData"> · 同步异常，显示缓存</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { createChart, ColorType, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams } from 'lightweight-charts'
import type { MacroMarket, MacroPeriod, MacroKlineResponse } from '../../../types/macro-market'
import { macroCrosshairKey, crosshairTimeKey, type MacroCrosshairPosition } from './crosshair-sync'

const props = defineProps<{ market: MacroMarket; period: MacroPeriod }>()
const DEFAULT_VISIBLE_BARS = 366
const RIGHT_OFFSET_BARS = 22
const container = ref<HTMLDivElement>()
const loading = ref(false)
const error = ref('')
const hasData = ref(false)
const updatedAt = ref<number | null>(null)
let chart: IChartApi | undefined
let series: ISeriesApi<'Candlestick'> | undefined
let request: AbortController | undefined
let timer: ReturnType<typeof setInterval> | undefined
let disposed = false
const crosshairChannel = inject(macroCrosshairKey, undefined)
let pointerInside = false
let applyingCrosshair = false
let unsubscribeCrosshair: (() => void) | undefined
const crosshairBars = new Map<number, { time: UTCTimestamp; close: number }>()

/** 使用独立处理函数标记当前鼠标所在的来源图。 */
function enterChart() {
  pointerInside = true
}

/** 只有用户实际指向的图表发送事件；程序设置产生的事件不能再广播。 */
function onCrosshairMove(event: MouseEventParams) {
  if (!pointerInside || applyingCrosshair) return
  const point = event.point
  if (typeof event.time !== 'number' || !point || point.x < 0 || point.y < 0
    || point.x >= (chart?.timeScale().width() ?? 0) || point.y >= (chart?.paneSize().height ?? 0)) {
    crosshairChannel?.publish(null)
    return
  }
  crosshairChannel?.publish({ source: props.market.id, period: props.period,
    key: crosshairTimeKey(event.time, props.period, props.market.id) })
}

/** 精确匹配本图交易时间；缺失、周期不同或超出视区时清除，不移动视区。 */
function receiveCrosshair(position: MacroCrosshairPosition | null) {
  if (!chart || !series || position?.source === props.market.id) return
  applyingCrosshair = true
  try {
    const bar = position?.period === props.period ? crosshairBars.get(position.key) : undefined
    const x = bar ? chart.timeScale().timeToCoordinate(bar.time) : null
    if (!bar || x === null || x < 0 || x >= chart.timeScale().width()) chart.clearCrosshairPosition()
    else chart.setCrosshairPosition(bar.close, bar.time, series)
  } finally {
    applyingCrosshair = false
  }
}

/** 离开来源图后清理所有同步线，避免停留在过期日期。 */
function clearSyncedCrosshair() {
  pointerInside = false
  crosshairChannel?.publish(null)
}

/** 取消上一周期请求，防止较慢响应覆盖当前图表；刷新失败保留已有缓存。 */
async function load() {
  request?.abort()
  const controller = new AbortController()
  request = controller
  loading.value = true
  try {
    const result = await $fetch<MacroKlineResponse>('/api/macro/kline', {
      query: { market: props.market.id, period: props.period }, signal: controller.signal,
    })
    if (disposed || controller.signal.aborted) return
    const firstLoad = !hasData.value
    crosshairBars.clear()
    for (const bar of result.data) crosshairBars.set(crosshairTimeKey(bar.t, props.period, props.market.id), { time: bar.t as UTCTimestamp, close: bar.c })
    series?.setData(result.data.map(bar => ({ time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c })))
    hasData.value = result.data.length > 0
    updatedAt.value = result.updatedAt
    error.value = result.error || (!hasData.value && props.market.source === 'binance' ? '暂无本地数据，请添加交易对并等待同步' : '')
    if (firstLoad && hasData.value) {
      // 仅首次加载或切换周期时设置默认视区，定时刷新不重置用户缩放。
      const count = result.data.length
      chart?.timeScale().setVisibleLogicalRange({
        from: count - Math.min(DEFAULT_VISIBLE_BARS, count) - 0.5,
        to: count - 0.5 + RIGHT_OFFSET_BARS,
      })
    }
  } catch (cause) {
    if (!disposed && !controller.signal.aborted) error.value = '读取失败，请稍后重试'
  } finally {
    if (request === controller) loading.value = false
  }
}

onMounted(() => {
  if (!container.value) return
  chart = createChart(container.value, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: '#111111' }, textColor: '#aeb5c3', fontSize: 10 },
    grid: { vertLines: { color: '#202024' }, horzLines: { color: '#202024' } },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: RIGHT_OFFSET_BARS },
    rightPriceScale: { borderColor: '#303038' },
  })
  series = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    // ^TNX 的报价本身为收益率百分数，直接标单位，不能使用按比例放大的 percent 格式。
    priceFormat: props.market.yield
      ? { type: 'custom', minMove: 0.001, formatter: (price: number) => `${price.toFixed(3)}%` }
      : { type: 'price', precision: props.market.id === 'btc' ? 1 : 2, minMove: props.market.id === 'btc' ? 0.1 : 0.01 },
  })
  chart.subscribeCrosshairMove(onCrosshairMove)
  unsubscribeCrosshair = crosshairChannel?.subscribe(receiveCrosshair)
  void load()
  timer = setInterval(() => { if (!document.hidden && !loading.value) void load() }, 30000)
})

watch(() => props.period, () => {
  crosshairChannel?.publish(null)
  crosshairBars.clear()
  series?.setData([])
  hasData.value = false
  updatedAt.value = null
  error.value = ''
  if (chart) void load()
})

onBeforeUnmount(() => {
  disposed = true
  request?.abort()
  clearSyncedCrosshair()
  unsubscribeCrosshair?.()
  chart?.unsubscribeCrosshairMove(onCrosshairMove)
  if (timer) clearInterval(timer)
  chart?.remove()
})
</script>

<style scoped>
.macro-local-chart { position: relative; height: 100%; }
.canvas { position: absolute; inset: 0 0 22px; }
.empty-state { position: absolute; inset: 0 0 22px; display: flex; align-items: center; justify-content: center; gap: 8px; color: #aeb5c3; font-size: 12px; background: #111; z-index: 1; }
.empty-state button { background: #2962ff; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 4px 8px; }
.source-status { position: absolute; bottom: 0; left: 8px; right: 8px; height: 22px; line-height: 22px; color: #9299a5; font-size: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
