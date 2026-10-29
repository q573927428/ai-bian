<!-- ==================== 宏观本地轻量 K 线图 ==================== -->
<template>
  <div class="macro-local-chart">
    <div ref="container" class="canvas" title="单击固定联动光标，再次单击解除" @mouseenter="enterChart" @mouseleave="clearSyncedCrosshair" />
    <div v-if="comparison" class="crosshair-comparison">
      <div>光标收盘 {{ comparison.from }} → 最新 {{ comparison.to }}</div>
      <div>至最新涨跌 <span :class="comparison.changeClass">{{ comparison.percent }}</span> · 相隔 {{ comparison.duration }}</div>
    </div>
    <div v-if="!hasData" class="empty-state">
      <span>{{ loading ? '正在读取本地数据…' : error || '暂无本地数据，等待同步' }}</span>
      <button v-if="!loading" type="button" @click="load">重试</button>
    </div>
    <div class="source-status" :title="error">
      {{ market.source === 'yahoo' ? 'Yahoo Finance · 本地缓存' : '币安合约 · 本地缓存' }}
      <span v-if="updatedAt"> · 同步 {{ beijingClock.format(new Date(updatedAt)) }}（北京时间）</span>
      <span v-if="error && hasData"> · 同步异常，显示缓存</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { createChart, ColorType, CandlestickSeries, TickMarkType, type Time, type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams } from 'lightweight-charts'
import type { MacroMarket, MacroPeriod, MacroKlineResponse } from '../../../types/macro-market'
import { macroCrosshairKey, crosshairTimeKey, type MacroCrosshairPosition, type MacroPinnedSummary } from './crosshair-sync'
import { macroViewportKey, logicalToCalendar, calendarToLogical, type MacroViewport } from './viewport-sync'

const props = defineProps<{ market: MacroMarket; period: MacroPeriod }>()
const emit = defineEmits<{ 'pinned-summary': [summary: MacroPinnedSummary] }>()
const DEFAULT_VISIBLE_BARS = 366
const RIGHT_OFFSET_BARS = 22
// 仅格式化显示，保留原始时间戳，避免影响跨市场光标匹配及交易日期归属。
const beijingClock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const beijingCrosshairTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const beijingTicks = {
  [TickMarkType.Year]: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric' }),
  [TickMarkType.Month]: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short' }),
  [TickMarkType.DayOfMonth]: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }),
  [TickMarkType.Time]: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  [TickMarkType.TimeWithSeconds]: beijingClock,
}

/** 兼容图表时间类型，所有显示统一转换为北京时间，不偏移实际数据。 */
function chartTimeDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`)
  return new Date(Date.UTC(time.year, time.month - 1, time.day))
}
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
const viewportChannel = inject(macroViewportKey, undefined)
let unsubscribeViewport: (() => void) | undefined
let applyingViewport = false
let calendarKeys: number[] = []
let viewportFrame: number | undefined
const periodSeconds = () => ({ '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 })[props.period]

/** 只由鼠标所在图表广播横向窗口；每帧合并事件，避免十二张图重复重绘。 */
function publishViewport() {
  if (!pointerInside || applyingViewport || !viewportChannel?.enabled.value || !calendarKeys.length) return
  if (viewportFrame !== undefined) return
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = undefined
    if (!pointerInside || applyingViewport || !viewportChannel.enabled.value || !calendarKeys.length) return
    const range = chart?.timeScale().getVisibleLogicalRange()
    if (!range) return
    viewportChannel.publish({ source: props.market.id, period: props.period,
      from: logicalToCalendar(calendarKeys, range.from, periodSeconds()),
      to: logicalToCalendar(calendarKeys, range.to, periodSeconds()) })
  })
}

/** 各市场用自己的交易日历换算窗口，仅修改时间轴，绝不修改价格轴。 */
function receiveViewport(viewport: MacroViewport) {
  if (!chart || !calendarKeys.length || !viewportChannel?.enabled.value
    || viewport.source === props.market.id || viewport.period !== props.period) return
  applyingViewport = true
  try {
    chart.timeScale().setVisibleLogicalRange({
      from: calendarToLogical(calendarKeys, viewport.from, periodSeconds()),
      to: calendarToLogical(calendarKeys, viewport.to, periodSeconds()),
    })
    if (crosshairChannel?.pinned.value) receiveCrosshair(crosshairChannel.pinned.value)
  } finally { applyingViewport = false }
}

// 重新开启时沿用该周期最近一次联动窗口；关闭后各图可以独立操作。
watch(() => viewportChannel?.enabled.value, enabled => {
  const viewport = viewportChannel?.latest.get(props.period)
  if (enabled && viewport) receiveViewport(viewport)
})
let pointerInside = false
let applyingCrosshair = false
let unsubscribeCrosshair: (() => void) | undefined
const crosshairBars = new Map<number, { time: UTCTimestamp; close: number }>()
const selectedBar = ref<{ time: UTCTimestamp; close: number } | null>(null)
const latestBar = ref<{ time: UTCTimestamp; close: number } | null>(null)

// 用所选 K 线收盘价作为收益基准；时间差使用真实时间戳，包含休市时段。
const comparison = computed(() => {
  const selected = selectedBar.value
  const latest = latestBar.value
  if (!selected || !latest) return null
  const percent = selected.close !== 0 ? (latest.close - selected.close) / selected.close * 100 : null
  const minutes = Math.floor(Math.abs(latest.time - selected.time) / 60)
  const formatPrice = (price: number) => `${price.toLocaleString('zh-CN', {
    minimumFractionDigits: props.market.yield ? 3 : props.market.id === 'btc' ? 1 : 2,
    maximumFractionDigits: props.market.yield ? 3 : props.market.id === 'btc' ? 1 : 2,
  })}${props.market.yield ? '%' : ''}`
  return {
    from: formatPrice(selected.close), to: formatPrice(latest.close),
    percent: percent === null ? '—' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`,
    changeClass: percent === null || percent === 0 ? '' : percent > 0 ? 'positive' : 'negative',
    duration: `${Math.floor(minutes / 1440)}天${Math.floor(minutes % 1440 / 60)}小时${minutes % 60}分钟`,
  }
})

/** 汇总直接匹配固定日期的缓存，滚出视区仍展示真实比较，不借用最近交易日。 */
watch(() => {
  const pinned = crosshairChannel?.pinned.value
  if (!pinned) return null
  const summary: MacroPinnedSummary = { marketId: props.market.id, key: pinned.key, period: props.period, status: '' }
  if (pinned.period !== props.period) return { ...summary, status: '周期不同' }
  const latest = latestBar.value
  const selected = crosshairBars.get(pinned.key)
  if (!selected || !latest) return { ...summary, status: loading.value ? '加载中' : '固定时间无数据 / 休市' }
  const formatPrice = (price: number) => `${price.toLocaleString('zh-CN', {
    minimumFractionDigits: props.market.yield ? 3 : props.market.id === 'btc' ? 1 : 2,
    maximumFractionDigits: props.market.yield ? 3 : props.market.id === 'btc' ? 1 : 2,
  })}${props.market.yield ? '%' : ''}`
  const percent = selected.close === 0 ? null : (latest.close - selected.close) / selected.close * 100
  const minutes = Math.floor(Math.abs(latest.time - selected.time) / 60)
  return { ...summary, status: '可比较', from: formatPrice(selected.close), to: formatPrice(latest.close),
    percent: percent === null ? '—' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`,
    changeClass: percent === null || percent === 0 ? '' : percent > 0 ? 'positive' : 'negative',
    duration: `${Math.floor(minutes / 1440)}天${Math.floor(minutes % 1440 / 60)}小时${minutes % 60}分钟`,
    selectedTime: selected.time, latestTime: latest.time }
}, summary => { if (summary) emit('pinned-summary', summary) }, { immediate: true })

/** 使用独立处理函数标记当前鼠标所在的来源图。 */
function enterChart() {
  pointerInside = true
}

/** 只有用户实际指向的图表发送事件；程序设置产生的事件不能再广播。 */
function onCrosshairMove(event: MouseEventParams) {
  if (applyingCrosshair) return
  if (crosshairChannel?.pinned.value) {
    receiveCrosshair(crosshairChannel.pinned.value)
    return
  }
  if (!pointerInside) return
  const point = event.point
  if (typeof event.time !== 'number' || !point || point.x < 0 || point.y < 0
    || point.x >= (chart?.timeScale().width() ?? 0) || point.y >= (chart?.paneSize().height ?? 0)) {
    selectedBar.value = null
    crosshairChannel?.publish(null)
    return
  }
  selectedBar.value = crosshairBars.get(crosshairTimeKey(event.time, props.period, props.market.id)) ?? null
  crosshairChannel?.publish({ source: props.market.id, period: props.period,
    key: crosshairTimeKey(event.time, props.period, props.market.id) })
}

/** 精确匹配本图交易时间；缺失、周期不同或超出视区时清除，不移动视区。 */
function receiveCrosshair(position: MacroCrosshairPosition | null) {
  if (!chart || !series || (position?.source === props.market.id && !crosshairChannel?.pinned.value)) return
  applyingCrosshair = true
  try {
    const bar = position?.period === props.period ? crosshairBars.get(position.key) : undefined
    const x = bar ? chart.timeScale().timeToCoordinate(bar.time) : null
    if (!bar || x === null || x < 0 || x >= chart.timeScale().width()) {
      selectedBar.value = null
      chart.clearCrosshairPosition()
    } else {
      selectedBar.value = bar
      chart.setCrosshairPosition(bar.close, bar.time, series)
    }
  } finally {
    applyingCrosshair = false
  }
}

/** 单击有效 K 线固定共享日期；固定期间任意图再次单击即可解除。 */
function onChartClick(event: MouseEventParams) {
  if (!crosshairChannel) return
  if (crosshairChannel.pinned.value) {
    crosshairChannel.pinned.value = null
    crosshairChannel.publish(null)
    return
  }
  const point = event.point
  if (typeof event.time !== 'number' || !point || point.x < 0 || point.y < 0
    || point.x >= (chart?.timeScale().width() ?? 0) || point.y >= (chart?.paneSize().height ?? 0)) return
  const key = crosshairTimeKey(event.time, props.period, props.market.id)
  if (!crosshairBars.has(key)) return
  const position = { source: props.market.id, period: props.period, key }
  crosshairChannel.pinned.value = position
  crosshairChannel.publish(position)
}

/** 离开来源图后清理所有同步线，避免停留在过期日期。 */
function clearSyncedCrosshair() {
  pointerInside = false
  if (crosshairChannel?.pinned.value) {
    receiveCrosshair(crosshairChannel.pinned.value)
    return
  }
  selectedBar.value = null
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
    const last = result.data[result.data.length - 1]
    latestBar.value = last ? { time: last.t as UTCTimestamp, close: last.c } : null
    // 定时刷新后更新比较基准，已移出缓存的光标数据不再继续显示。
    if (selectedBar.value) selectedBar.value = crosshairBars.get(crosshairTimeKey(selectedBar.value.time, props.period, props.market.id)) ?? null
    // 更新数据前保存日期窗口，新增 K 线或历史扩充时也不会挤走用户观察位置。
    const previousRange = chart?.timeScale().getVisibleLogicalRange()
    const previousViewport = !firstLoad && previousRange && calendarKeys.length ? {
      source: '', period: props.period,
      from: logicalToCalendar(calendarKeys, previousRange.from, periodSeconds()),
      to: logicalToCalendar(calendarKeys, previousRange.to, periodSeconds()),
    } : undefined
    calendarKeys = result.data.map(bar => crosshairTimeKey(bar.t, props.period, props.market.id))
    applyingViewport = true
    series?.setData(result.data.map(bar => ({ time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c })))
    applyingViewport = false
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
    const sharedViewport = viewportChannel?.enabled.value ? viewportChannel.latest.get(props.period) : undefined
    if (sharedViewport && sharedViewport.source !== props.market.id) receiveViewport(sharedViewport)
    else if (previousViewport && chart && calendarKeys.length) {
      // 关闭联动时仍保持本图窗口，恢复过程不向其他图广播。
      applyingViewport = true
      try {
        chart.timeScale().setVisibleLogicalRange({
          from: calendarToLogical(calendarKeys, previousViewport.from, periodSeconds()),
          to: calendarToLogical(calendarKeys, previousViewport.to, periodSeconds()),
        })
      } finally { applyingViewport = false }
    }
    // 刷新或周期数据到达后重新匹配固定日期，不改变固定位置。
    if (crosshairChannel?.pinned.value) receiveCrosshair(crosshairChannel.pinned.value)
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
    localization: { locale: 'zh-CN', timeFormatter: (time: Time) => `${beijingCrosshairTime.format(chartTimeDate(time))} 北京时间` },
    timeScale: {
      timeVisible: true, secondsVisible: false, rightOffset: RIGHT_OFFSET_BARS,
      tickMarkFormatter: (time: Time, type: TickMarkType) => beijingTicks[type].format(chartTimeDate(time)),
    },
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
  chart.subscribeClick(onChartClick)
  chart.timeScale().subscribeVisibleLogicalRangeChange(publishViewport)
  unsubscribeViewport = viewportChannel?.subscribe(receiveViewport)
  unsubscribeCrosshair = crosshairChannel?.subscribe(receiveCrosshair)
  void load()
  timer = setInterval(() => { if (!document.hidden && !loading.value) void load() }, 30000)
})

watch(() => props.period, () => {
  // 切换固定来源图的周期后解除，避免固定日期仍引用旧周期。
  if (crosshairChannel?.pinned.value?.source === props.market.id) crosshairChannel.pinned.value = null
  crosshairChannel?.publish(null)
  crosshairBars.clear()
  calendarKeys = []
  selectedBar.value = null
  latestBar.value = null
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
  unsubscribeViewport?.()
  if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame)
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(publishViewport)
  chart?.unsubscribeCrosshairMove(onCrosshairMove)
  chart?.unsubscribeClick(onChartClick)
  if (timer) clearInterval(timer)
  chart?.remove()
})
</script>

<style scoped>
.macro-local-chart { position: relative; height: 100%; }
.canvas { position: absolute; inset: 0 0 22px; }
.crosshair-comparison { position: absolute; top: 6px; left: 8px; max-width: calc(100% - 16px); box-sizing: border-box; padding: 4px 6px; border-radius: 4px; background: rgba(17, 17, 17, 0.88); color: #d1d5db; font-size: 11px; line-height: 18px; pointer-events: none; z-index: 2; font-variant-numeric: tabular-nums; }
.positive { color: #26a69a; }
.negative { color: #ef5350; }
.empty-state { position: absolute; inset: 0 0 22px; display: flex; align-items: center; justify-content: center; gap: 8px; color: #aeb5c3; font-size: 12px; background: #111; z-index: 1; }
.empty-state button { background: #2962ff; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 4px 8px; }
.source-status { position: absolute; bottom: 0; left: 8px; right: 8px; height: 22px; line-height: 22px; color: #9299a5; font-size: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
