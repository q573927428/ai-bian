<!-- ==================== 持仓止盈止损价格区域 ==================== -->
<template>
  <button ref="toggleButton" class="risk-toggle" type="button" :aria-pressed="enabled" @click="enabled = !enabled">{{ enabled ? '隐藏止盈止损' : '止盈止损' }}</button>
  <svg v-if="geometry" ref="overlay" class="position-risk-overlay" :class="{ 'is-hovered': hovered }" :width="geometry.width" :height="geometry.height" aria-label="持仓止盈止损区域">
    <rect v-for="zone in fillZones" :key="zone.key" :x="geometry.left" :y="zone.top" :width="geometry.right - geometry.left" :height="zone.height" :fill="zone.color" fill-opacity="0.16" />
    <text v-if="geometry.strategyId" :x="Math.max(5, geometry.left + 5)" :y="geometry.strategyY" class="price-value risk-detail">{{ geometry.strategyId }}</text>
    <g v-for="zone in geometry.zones" :key="zone.label">
      <rect :x="geometry.left" :y="Math.min(geometry.entry, zone.y)" :width="geometry.right - geometry.left" :height="Math.abs(geometry.entry - zone.y)" :stroke="zone.color" :stroke-dasharray="zone.label === 'TP1' ? '5 4' : undefined" fill="none" :stroke-opacity="hovered ? 1 : 0" stroke-width="1.5" />
      <text class="risk-detail" :x="geometry.left + 5" :y="zone.y < geometry.entry ? zone.y + 16 : zone.y - 6" :fill="zone.color">{{ zone.label }}<tspan class="price-value" dx="5">{{ zone.price }}</tspan></text>
    </g>
    <line class="risk-detail" :x1="geometry.left" :x2="geometry.right" :y1="geometry.entry" :y2="geometry.entry" stroke="#e6a23c" stroke-width="1.5" />
    <text class="risk-detail" :x="geometry.left + 5" :y="geometry.entry + (geometry.isLong ? -6 : 16)" fill="#e6a23c">入场<tspan class="price-value" dx="5">{{ geometry.entryPrice }}</tspan></text>
    <g v-if="geometry.tp1" class="risk-detail">
      <line :x1="geometry.left" :x2="geometry.right" :y1="geometry.tp1.y" :y2="geometry.tp1.y" :stroke="TP1_COLOR" stroke-dasharray="5 4" />
      <text :x="geometry.left + 5" :y="geometry.tp1.y + (geometry.isLong ? 16 : -6)" :fill="TP1_COLOR">TP1<tspan class="price-value" dx="5">{{ geometry.tp1.price }}</tspan></text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import type { TradeHistory } from '../../../types'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import { useChartPosition } from '../../composables/usePositionChart'
import { useChartOverlayPreference } from '../../composables/useChartOverlayPreference'
import { formatPrice } from './utils/kline-formatters'

/** 获取实时图表实例，以适应交易对或指标切换时的图表重建。 */
interface Props {
  symbol?: string
  klines: SimpleKLineData[]
  getChart: () => IChartApi | null
  getSeries: () => ISeriesApi<'Candlestick'> | null
  loading?: boolean
  historicalOrder?: TradeHistory | null
}
const props = defineProps<Props>()
const livePosition = useChartPosition(() => props.symbol)
// 历史复盘使用冻结的入场风险价格，避免混入同一交易对当前持仓的数据。
const position = computed(() => {
  const order = props.historicalOrder
  return order ? { ...order, initialStopLoss: order.stopLossPrice, stopLoss: order.stopLossPrice,
    takeProfit1: order.takeProfit1Price, takeProfit2: order.takeProfit2Price } : livePosition.value
})
/** SVG 使用主价格轴坐标；所有区域会随缩放、拖动及实时价格同步移动。 */
interface Geometry {
  width: number
  height: number
  left: number
  right: number
  entry: number
  isLong: boolean
  entryPrice: string
  strategyId: string
  strategyY: number
  zones: { label: string; y: number; price: string; color: string }[]
  tp1: { y: number; price: string } | null
}
const geometry = shallowRef<Geometry | null>(null)
const toggleButton = shallowRef<HTMLButtonElement | null>(null)
const overlay = shallowRef<SVGSVGElement | null>(null)
const pointer = shallowRef<{ x: number; y: number } | null>(null)
// 用实际鼠标位置命中风险色块，不受十字光标吸附或锁定状态影响。
const hovered = computed(() => {
  const area = geometry.value
  const point = pointer.value
  if (!area || !point || !area.zones.length) return false
  return point.x >= Math.max(0, area.left) && point.x <= Math.min(area.width, area.right)
    && point.y >= Math.max(0, Math.min(area.entry, ...area.zones.map(zone => zone.y)))
    && point.y <= Math.min(area.height, Math.max(area.entry, ...area.zones.map(zone => zone.y)))
})
let hoverContainer: HTMLElement | null = null

/** 在图表父容器上旁听鼠标移动，保持 SVG 穿透，不拦截拖动、缩放和点击。 */
function trackPointer(event: PointerEvent) {
  const bounds = overlay.value?.getBoundingClientRect()
  pointer.value = bounds && event.pointerType !== 'touch'
    ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null
}

/** 鼠标离开图表后立即收起风险详情。 */
function clearPointer() {
  pointer.value = null
}
// 沿用默认显示，允许用户单独关闭风险区域，不影响订单标记及持仓监控。
const enabled = useChartOverlayPreference('chart-position-risk-enabled', true)
// 保证短期持仓的标签空间，同时让框体覆盖持仓期间的全部 K 线。
const MIN_RISK_BOX_WIDTH = 100
const LATEST_KLINE_PADDING = 30
// 用同色系深浅及虚实区分分批止盈阶段，只有 TP1 时也沿用浅绿色虚线。
const TP1_COLOR = '#95d475'
const TP2_COLOR = '#529b2e'
// 填色独立于悬停边框；两段止盈不叠加，避免透明度累积改变阶段颜色。
const fillZones = computed(() => {
  const area = geometry.value
  if (!area) return []
  return area.zones.flatMap(zone => {
    const tp1Y = area.tp1?.y
    // 只有 TP1 位于入场和 TP2 之间才分段，多空方向均按坐标范围判断。
    if (zone.label === 'TP2' && tp1Y != null
      && tp1Y > Math.min(area.entry, zone.y) && tp1Y < Math.max(area.entry, zone.y)) {
      return [
        { key: 'TP1', top: Math.min(area.entry, tp1Y), height: Math.abs(area.entry - tp1Y), color: TP1_COLOR },
        { key: 'TP2', top: Math.min(tp1Y, zone.y), height: Math.abs(tp1Y - zone.y), color: TP2_COLOR }
      ]
    }
    // 缺少中间目标时仍保留有效价位的完整色块。
    return [{ key: zone.label, top: Math.min(area.entry, zone.y), height: Math.abs(area.entry - zone.y), color: zone.color }]
  })
})
let frame = 0
let previous = ''

/** 将真实开仓时间和风险价格投影到画布，缺失价位时只绘制有效区域。 */
function updateGeometry() {
  const chart = props.getChart()
  const series = props.getSeries()
  const selected = position.value
  let next: Geometry | null = null
  if (enabled.value && chart && series && selected && !props.loading && props.klines.length &&
      selected.symbol.replace('/', '').toUpperCase() === props.symbol?.replace('/', '').toUpperCase()) {
    const scale = chart.timeScale()
    const entry = series.priceToCoordinate(Number(selected.entryPrice))
    const openTime = new Date(selected.openTime).getTime() / 1000
    // 开仓落在 K 线内部时取该根蜡烛；早于已加载历史时从左边界开始绘制。
    const laterIndex = props.klines.findIndex(bar => bar.t > openTime)
    const index = laterIndex < 0 ? props.klines.length - 1 : Math.max(0, laterIndex - 1)
    const left = scale.logicalToCoordinate(index as any)
    const latestX = scale.logicalToCoordinate((props.klines.length - 1) as any)
    // 右边界随最新蜡烛延伸并留白；超出可视区域时交给 SVG 裁切。
    const right = left === null ? 0 : Math.max(left + MIN_RISK_BOX_WIDTH, (latestX ?? left) + LATEST_KLINE_PADDING)
    if (entry !== null && Number.isFinite(openTime) && left !== null && left < scale.width() && right > 0) {
      const zones: Geometry['zones'] = []
      const stop = Number(selected.stopLoss) > 0 ? Number(selected.stopLoss) : Number(selected.initialStopLoss)
      const target = Number(selected.takeProfit2) > 0 ? Number(selected.takeProfit2) : Number(selected.takeProfit1)
      for (const item of [
        { value: stop, label: stop !== Number(selected.initialStopLoss) ? '移动止损' : '止损', color: '#f56c6c' },
        { value: target, label: Number(selected.takeProfit2) > 0 ? 'TP2' : 'TP1',
          color: Number(selected.takeProfit2) > 0 ? TP2_COLOR : TP1_COLOR }
      ]) {
        const y = series.priceToCoordinate(item.value)
        if (Number.isFinite(item.value) && item.value > 0 && y !== null) {
          zones.push({ label: item.label, color: item.color, y, price: formatPrice(item.value) })
        }
      }
      const tp1 = Number(selected.takeProfit1)
      const tp1Y = series.priceToCoordinate(tp1)
      next = { width: scale.width(), height: chart.panes()[0]?.getHeight() ?? 0, left, right, entry,
        // 多单按指定布局将入场文字放在线上、TP1 放在线下；空单沿用原位置。
        // 实时持仓可能返回小写方向，历史订单及公共类型使用大写，统一后再判断。
        isLong: selected.direction.toUpperCase() === 'LONG',
        // 策略名称放在整个风险框上方，靠近顶部时保留可读的文字基线。
        strategyId: selected.strategyId || '', strategyY: Math.max(14, Math.min(entry, ...zones.map(zone => zone.y)) - 8),
        entryPrice: formatPrice(Number(selected.entryPrice)), zones,
        tp1: tp1 > 0 && tp1 !== target && tp1Y !== null ? { y: tp1Y, price: formatPrice(tp1) } : null }
    }
  }
  // 价格轴拖动没有独立订阅事件；逐帧读取坐标，仅几何变化时触发 Vue 渲染。
  const serialized = JSON.stringify(next)
  if (serialized !== previous) {
    geometry.value = next
    previous = serialized
  }
  frame = requestAnimationFrame(updateGeometry)
}
onMounted(() => {
  hoverContainer = toggleButton.value?.parentElement ?? null
  hoverContainer?.addEventListener('pointermove', trackPointer, { passive: true })
  hoverContainer?.addEventListener('pointerleave', clearPointer)
  frame = requestAnimationFrame(updateGeometry)
})
onBeforeUnmount(() => {
  hoverContainer?.removeEventListener('pointermove', trackPointer)
  hoverContainer?.removeEventListener('pointerleave', clearPointer)
  cancelAnimationFrame(frame)
})
</script>

<style scoped>
.risk-toggle { position: absolute; left: 12px; bottom: 58px; z-index: 3; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card, #141414); color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 3px 6px; }
.position-risk-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: hidden; z-index: 1; }
/* 默认仅保留风险色块，鼠标进入其中任一区域后显示整组价位详情。 */
.risk-detail { visibility: hidden; }
.is-hovered .risk-detail { visibility: visible; }
text { font-size: 12px; font-weight: 600; paint-order: stroke; stroke: var(--bg-card, #141414); stroke-width: 3px; stroke-linejoin: round; }
/* 数值使用主题正文色，标签颜色继续表达价位的业务含义。 */
.price-value { fill: var(--text-primary, #e5eaf3); }
</style>
