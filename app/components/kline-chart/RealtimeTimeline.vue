<!-- ==================== SSE 实时分时图（仅浏览器内存） ==================== -->
<template>
  <div class="realtime-timeline">
    <div class="timeline-status" role="status">
      <span :class="['status-dot', { live }]" />
      {{ live ? `实时分时 · ${Math.round(visibleSpan * SAMPLE_MS / 1000)}秒视窗 · 曲线含平滑过渡` : '行情未连接或已过期，等待实时更新' }}
      <span v-if="pointCount < 2"> · 等待价格点形成走势</span>
      <button v-if="!following" class="follow-button" @click="following = true">回到实时</button>
    </div>
    <div ref="container" :style="{ height: `${height}px` }" @pointerdown="pauseForDrag" @wheel.passive="pauseForWheel" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AreaSeries, ColorType, LineType, createChart } from 'lightweight-charts'
import type { AreaData, IChartApi, IPriceLine, ISeriesApi, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts'
import { useBotStore } from '../../stores/bot'
import { getPricePrecision } from './utils/kline-helpers'

/** 分时图仅消费共享行情，不建立连接、不保存历史。 */
interface Props {
  symbol: string
  theme: 'light' | 'dark'
  height: number
}
const props = defineProps<Props>()
const store = useBotStore()
const container = ref<HTMLDivElement | null>(null)
const pointCount = ref(0)
const now = ref(Date.now())
const following = ref(true)
const symbol = computed(() => props.symbol.replace('/', '').trim().toUpperCase())
const price = computed(() => store.prices[symbol.value])
const live = computed(() => store.priceConnectionStatus === 'connected'
  && Number.isFinite(price.value?.timestamp)
  && now.value - price.value.timestamp < 10_000)
const WINDOW_SECONDS = 600
// 固定时间跨度才能持续平移，不能随已积累的点数扩大视窗。
const SAMPLE_MS = 100
const VISIBLE_POINTS = 40 * 1000 / SAMPLE_MS
const visibleSpan = ref(VISIBLE_POINTS)
const SMOOTHING_MS = 180
const MAX_POINTS = WINDOW_SECONDS * 1000 / SAMPLE_MS + 1
let chart: IChartApi | undefined
let series: ISeriesApi<'Area'> | undefined
let points: Array<AreaData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = []
let lastEventAt = 0
let lastSecond = 0
let observer: ResizeObserver | undefined
let timer: ReturnType<typeof setInterval> | undefined
let animationFrame = 0
let previousFrameAt = 0
let displayedPrice: number | null = null
let lastDisplayAt = 0
let actualPriceLine: IPriceLine | undefined
let dragging = false
let followResumeTimer: ReturnType<typeof setTimeout> | undefined

/** 记录手动缩放后的宽度；自动跟随只平移，不再覆盖用户选择的比例。 */
function rememberZoom(range: { from: number; to: number } | null) {
  if (following.value || !range) return
  // 跟随视窗包含 8% 的右侧留白，还原主体宽度后避免恢复时重复放大。
  const span = (range.to - range.from) / 1.08
  if (Number.isFinite(span) && span > 0) visibleSpan.value = span
}

/** 拖动期间暂停跟随，允许停留在历史位置。 */
function pauseForDrag() {
  if (followResumeTimer) clearTimeout(followResumeTimer)
  dragging = true
  following.value = false
}

/** 仅当视窗回到实时锚点附近或越过锚点时恢复；历史区域不会强制跳回。 */
function resumeNearLive() {
  const range = chart?.timeScale().getVisibleLogicalRange()
  if (!range || !points.length) return
  rememberZoom(range)
  const elapsed = Math.max(0, Math.min(1, (Date.now() / 1000 - lastSecond) * 1000 / SAMPLE_MS))
  const liveRight = points.length - 1 + elapsed + visibleSpan.value * 0.08
  // 约一个窗口宽度的 3% 作为吸附范围，避免必须像素级对准固定位置。
  const tolerance = visibleSpan.value * 0.03
  following.value = range.to >= liveRight - tolerance
}

/** 窗口外松开同样检查吸附，但不再无条件恢复跟随。 */
function resumeAfterDrag() {
  if (!dragging) return
  dragging = false
  resumeNearLive()
}

/** 滚轮结束也仅在接近实时位置时吸附，保留查看历史的能力。 */
function pauseForWheel() {
  following.value = false
  if (followResumeTimer) clearTimeout(followResumeTimer)
  followResumeTimer = setTimeout(() => {
    if (!dragging) resumeNearLive()
  }, 300)
}

/** 使用浏览器本地时间显示秒，不改变行情时间戳。 */
function formatTime(time: number): string {
  return new Date(time * 1000).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 切换币种或刷新时清空临时历史，旧快照不会被当成新成交重复追加。 */
function reset() {
  points = []
  pointCount.value = 0
  lastEventAt = 0
  lastSecond = 0
  displayedPrice = null
  lastDisplayAt = 0
  following.value = true
  series?.setData([])
  actualPriceLine?.applyOptions({ lineVisible: false, axisLabelVisible: false })
  consumePrice()
}

/** 缓动只用于曲线显示；独立价格线始终标记真实最新价，断线和陈旧行情不延长。 */
function consumePrice() {
  const quote = price.value
  const eventAt = quote?.timestamp
  if (!series || store.priceConnectionStatus !== 'connected'
    || !Number.isFinite(eventAt) || !Number.isFinite(quote?.price) || quote.price <= 0
    || Date.now() - eventAt > 10_000 || eventAt > Date.now() + 10_000 || eventAt < lastEventAt) return
  const second = Math.floor(Date.now() / SAMPLE_MS) * SAMPLE_MS / 1000
  const currentAt = Date.now()
  // 长断流后直接从新报价恢复，不把断线前的价格缓动到新报价。
  if (displayedPrice === null || second - lastSecond > 10) displayedPrice = quote.price
  else {
    const alpha = 1 - Math.exp(-Math.max(0, currentAt - lastDisplayAt) / SMOOTHING_MS)
    displayedPrice += (quote.price - displayedPrice) * alpha
  }
  lastDisplayAt = currentAt
  actualPriceLine?.applyOptions({ price: quote.price, lineVisible: true, axisLabelVisible: true })
  const point: AreaData<UTCTimestamp> = { time: second as UTCTimestamp, value: displayedPrice! }
  if (lastSecond && second - lastSecond > 10) {
    const gap: WhitespaceData<UTCTimestamp> = { time: (lastSecond + 1) as UTCTimestamp }
    points.push(gap)
    series.update(gap)
  }
  if (second === lastSecond) points[points.length - 1] = point
  else points.push(point)
  lastSecond = second
  lastEventAt = eventAt
  series.applyOptions({ priceFormat: { type: 'price', ...getPricePrecision([quote.price]) } })
  series.update(point)
  prune(second)
}

/** 以约 60fps 连续平移固定视窗，交互结束后自动恢复最新价锚点。 */
function animate(frameAt: number) {
  if (frameAt - previousFrameAt >= 1000 / 60) {
    previousFrameAt = frameAt
    now.value = Date.now()
    const second = Math.floor(Date.now() / SAMPLE_MS) * SAMPLE_MS / 1000
    if (second > lastSecond) consumePrice()
    if (chart && following.value && points.length > 0 && live.value) {
      const elapsed = Math.max(0, Math.min(1, (Date.now() / 1000 - lastSecond) * 1000 / SAMPLE_MS))
      const end = points.length - 1 + elapsed
      // 从第一帧起就固定比例，10秒走过一屏；初始左侧留白代表尚未采集的数据。
      const span = visibleSpan.value
      chart.timeScale().setVisibleLogicalRange({ from: end - span, to: end + span * 0.08 })
    }
  }
  animationFrame = requestAnimationFrame(animate)
}

/** 限制时间窗口与点数；仅淘汰数据时重设序列，常规行情使用增量更新。 */
function prune(second: number) {
  let removed = false
  while (points.length && (Number(points[0]!.time) < second - WINDOW_SECONDS || points.length > MAX_POINTS)) {
    points.shift()
    removed = true
  }
  if (removed) series?.setData(points)
  pointCount.value = points.filter(point => 'value' in point).length
}

/** 只修改配色，切换主题保留已经积累的分时数据。 */
function applyTheme() {
  const dark = props.theme === 'dark'
  chart?.applyOptions({
    layout: { background: { type: ColorType.Solid, color: dark ? '#0e1116' : '#ffffff' }, textColor: dark ? '#9ca3af' : '#606266' },
    grid: { vertLines: { color: dark ? '#20242b' : '#f0f2f5' }, horzLines: { color: dark ? '#20242b' : '#f0f2f5' } }
  })
  series?.applyOptions({ lineColor: dark ? '#e5e7eb' : '#475569', topColor: dark ? '#e5e7eb18' : '#47556920', bottomColor: '#47556900' })
}

watch(price, consumePrice)
watch(symbol, reset, { flush: 'sync' })
watch(() => store.priceConnectionStatus, consumePrice)
watch(() => props.theme, applyTheme)
watch(() => props.height, height => chart?.applyOptions({ height }))

onMounted(() => {
  if (!container.value) return
  chart = createChart(container.value, {
    width: container.value.clientWidth,
    height: props.height,
    // 禁用惯性，防止松开后库内惯性滚动与实时复位相互争抢视窗。
    kineticScroll: { mouse: false, touch: false },
    timeScale: { visible: true, timeVisible: true, secondsVisible: true,
      minimumHeight: 30, tickMarkMaxCharacterLength: 8,
      shiftVisibleRangeOnNewBar: false,
      rightOffset: 5, barSpacing: 5,
      tickMarkFormatter: (time: Time) => formatTime(Number(time)) },
    localization: { timeFormatter: (time: Time) => formatTime(Number(time)) }
  })
  // 使用图表库原生曲线插值，让相邻价格点平滑连接。
  series = chart.addSeries(AreaSeries, { lineType: LineType.Curved, lineWidth: 2, pointMarkersVisible: false, crosshairMarkerVisible: true,
    priceLineVisible: false, lastValueVisible: false,
    lastPriceAnimation: 1 })
  chart.timeScale().subscribeVisibleLogicalRangeChange(rememberZoom)
  actualPriceLine = series.createPriceLine({ price: 0, color: '#94a3b8', lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false, title: '最新' })
  applyTheme()
  consumePrice()
  animationFrame = requestAnimationFrame(animate)
  window.addEventListener('pointerup', resumeAfterDrag)
  window.addEventListener('pointercancel', resumeAfterDrag)
  window.addEventListener('blur', resumeAfterDrag)
  observer = new ResizeObserver(() => {
    if (container.value) chart?.applyOptions({ width: container.value.clientWidth })
  })
  observer.observe(container.value)
  timer = setInterval(() => {
    now.value = Date.now()
    prune(Math.floor(now.value / 1000))
  }, 1000)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (timer) clearInterval(timer)
  cancelAnimationFrame(animationFrame)
  if (followResumeTimer) clearTimeout(followResumeTimer)
  window.removeEventListener('pointerup', resumeAfterDrag)
  window.removeEventListener('pointercancel', resumeAfterDrag)
  window.removeEventListener('blur', resumeAfterDrag)
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(rememberZoom)
  chart?.remove()
  points = []
})

defineExpose({ reset })
</script>

<style scoped>
.realtime-timeline { position: relative; width: 100%; }
/* 状态栏覆盖在图表顶部，不挤占全屏和自适应布局为画布预留的高度。 */
.timeline-status { position: absolute; top: 8px; left: 12px; z-index: 1; pointer-events: none; display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; flex-wrap: wrap; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #909399; }
.status-dot.live { background: #10b981; }
.follow-button { pointer-events: auto; cursor: pointer; border: 1px solid #64748b; border-radius: 4px; background: var(--bg-card); color: inherit; padding: 2px 6px; }
</style>
