<!-- ==================== 图表支撑阻力区域 ==================== -->
<template>
  <div v-if="enabled && !loading && klines.length" class="structure-summary">
    <SupportResistanceInfo :snapshot="summary" compact :historical="!!historicalOrder" />
  </div>
  <button class="structure-toggle" type="button" :aria-pressed="enabled" @click="enabled = !enabled">{{ enabled ? '隐藏支撑阻力' : '支撑阻力' }}</button>
  <svg v-if="enabled && geometry" class="structure-overlay" :width="geometry.width" :height="geometry.height" aria-label="支撑阻力区域">
    <g v-for="item in geometry.zones" :key="item.label">
      <rect :x="item.left" :y="item.top" :width="geometry.width - item.left" :height="item.height" :fill="item.color" :fill-opacity="item.touches === 1 ? 0.035 : 0.08" :stroke="item.color" :stroke-dasharray="item.touches === 1 ? '4 4' : undefined" />
      <text :x="geometry.width - 6" :y="Math.max(14, item.top - 5)" text-anchor="end" :fill="item.color">{{ item.label }}</text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import { useChartOverlayPreference } from '../../composables/useChartOverlayPreference'
import SupportResistanceInfo from '../SupportResistanceInfo.vue'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import type { TradeHistory } from '../../../types'
import type { SupportResistanceSnapshot } from '../../../types/support-resistance'

/** 图表实例通过函数获取，兼容重建；历史订单只显示入场快照。 */
interface Props {
  symbol?: string
  timeframe?: string
  klines: SimpleKLineData[]
  loading?: boolean
  historicalOrder?: TradeHistory | null
  getChart: () => IChartApi | null
  getSeries: () => ISeriesApi<'Candlestick'> | null
}
const props = defineProps<Props>()
// 已保存的显示偏好优先，切换历史订单时也不覆盖用户的选择。
const enabled = useChartOverlayPreference('chart-support-resistance-enabled', !!props.historicalOrder)
const snapshot = shallowRef<SupportResistanceSnapshot | null>(null)
// 历史模式只读入场快照，切换到其他周期不把原周期快照当作当前周期结构。
const summary = computed(() => {
  const data = props.historicalOrder ? props.historicalOrder.entrySupportResistance : snapshot.value
  return data?.timeframe === props.timeframe ? data : null
})
/** 区域几何只取当前坐标，缩放与拖动不重新请求行情。 */
interface Geometry {
  width: number
  height: number
  zones: { left: number; top: number; height: number; color: string; touches: number; label: string }[]
}
const geometry = shallowRef<Geometry | null>(null)
let version = 0
let timer: ReturnType<typeof setInterval> | undefined
let frame = 0
let previous = ''
let pending = false

/** 每15秒读取共享区域缓存；切换交易对时丢弃旧请求结果。 */
async function refresh() {
  if (!enabled.value || props.historicalOrder || pending || !props.symbol || !['5m', '15m', '1h', '4h', '1d'].includes(props.timeframe || '')) return
  const current = version
  pending = true
  try {
    const response: any = await $fetch('/api/bot/indicators', { query: {
      symbol: props.symbol, timeframe: props.timeframe, includeSlowStats: 'false', structureOnly: 'true'
    } })
    if (current === version) snapshot.value = response.data?.indicators?.supportResistance?.values ?? null
  } catch {
    if (current === version) snapshot.value = null
  } finally {
    pending = false
    // 切换交易对时旧请求可能仍在途，完成后立即补请求当前周期。
    if (current !== version) void refresh()
  }
}

/** 从确认时间/入场时间开始绘制，不把当前区域倒画到历史。 */
function draw() {
  const chart = props.getChart()
  const series = props.getSeries()
  let next: Geometry | null = null
  const order = props.historicalOrder
  const data = order ? order.entrySupportResistance : snapshot.value
  if (enabled.value && !props.loading && chart && series && data && props.klines.length
    && data.timeframe === props.timeframe) {
    const scale = chart.timeScale()
    const width = scale.width()
    const zones: Geometry['zones'] = []
    for (const [kind, zone] of [['支撑', data.nearestSupport], ['阻力', data.nearestResistance]] as const) {
      if (!zone) continue
      const start = order ? new Date(order.openTime).getTime() / 1000
        : 'lastConfirmedAt' in zone ? Number(zone.lastConfirmedAt) / 1000 : NaN
      // 历史入场定位到开仓所在蜡烛；实时区域仍从确认之后开始，避免提前展示。
      const nextIndex = props.klines.findIndex(bar => bar.t > start)
      const index = order
        ? (nextIndex < 0 ? props.klines.length - 1 : Math.max(0, nextIndex - 1))
        : props.klines.findIndex(bar => bar.t >= start)
      if (!Number.isFinite(start) || index < 0) continue
      const x = scale.logicalToCoordinate(index as any)
      const upper = series.priceToCoordinate(zone.upper)
      const lower = series.priceToCoordinate(zone.lower)
      if (x == null || upper == null || lower == null || x >= width) continue
      const price = (value: number) => Number(value.toPrecision(7)).toString()
      // 沿用快照中到区域近端的 ATR 距离；历史复盘保持入场口径，不使用当前行情重算。
      const distanceATR = kind === '支撑' ? data.supportDistanceATR : data.resistanceDistanceATR
      const atrLabel = distanceATR != null && Number.isFinite(distanceATR) ? distanceATR.toFixed(2) : '--'
      zones.push({ left: Math.max(0, x), top: Math.min(upper, lower), height: Math.max(1, Math.abs(lower - upper)),
        touches: zone.touches, color: kind === '支撑' ? '#67c23a' : '#f56c6c',
        label: `${order ? '入场' : ''}${kind} ${price(zone.lower)}～${price(zone.upper)}（${zone.touches}） · ${atrLabel} ATR` })
    }
    next = { width, height: chart.panes()[0]?.getHeight() ?? 0, zones }
  }
  const serialized = JSON.stringify(next)
  if (serialized !== previous) { geometry.value = next; previous = serialized }
  frame = requestAnimationFrame(draw)
}
watch(() => [props.symbol, props.timeframe, props.historicalOrder], () => {
  version++
  snapshot.value = null
  void refresh()
})
// 开启后立即获取摘要，关闭时连同区域一起隐藏并停止后续轮询请求。
watch(enabled, (visible) => { if (visible) void refresh() })
onMounted(() => {
  void refresh()
  timer = setInterval(() => { void refresh() }, 15_000)
  frame = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  version++
  if (timer) clearInterval(timer)
  cancelAnimationFrame(frame)
})
</script>

<style scoped>
/* 放在原有两行行情指标下方，透明摘要不拦截十字光标与图表拖动。 */
.structure-summary { position: absolute; top: 56px; left: 20px; right: 90px; z-index: 2; pointer-events: none; }
.structure-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: hidden; z-index: 1; }
.structure-toggle { position: absolute; left: 12px; bottom: 30px; z-index: 3; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card, #141414); color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 3px 6px; }
text { font-size: 11px; paint-order: stroke; stroke: var(--bg-card, #141414); stroke-width: 3px; }
</style>
