<!-- ==================== 持仓止盈止损价格区域 ==================== -->
<template>
  <button class="risk-toggle" type="button" :aria-pressed="enabled" @click="enabled = !enabled">{{ enabled ? '隐藏止盈止损' : '止盈止损' }}</button>
  <svg v-if="geometry" class="position-risk-overlay" :width="geometry.width" :height="geometry.height" aria-label="持仓止盈止损区域">
    <text v-if="geometry.strategyId" :x="Math.max(5, geometry.left + 5)" :y="geometry.strategyY" class="price-value">{{ geometry.strategyId }}</text>
    <g v-for="zone in geometry.zones" :key="zone.label">
      <rect :x="geometry.left" :y="Math.min(geometry.entry, zone.y)" :width="geometry.right - geometry.left" :height="Math.abs(geometry.entry - zone.y)" :stroke="zone.color" :fill="zone.color" fill-opacity="0.06" stroke-width="1.5" />
      <text :x="geometry.left + 5" :y="zone.y < geometry.entry ? zone.y + 16 : zone.y - 6" :fill="zone.color">{{ zone.label }}<tspan class="price-value" dx="5">{{ zone.price }}</tspan></text>
    </g>
    <line :x1="geometry.left" :x2="geometry.right" :y1="geometry.entry" :y2="geometry.entry" stroke="#e6a23c" stroke-width="1.5" />
    <text :x="geometry.left + 5" :y="geometry.entry + 16" fill="#e6a23c">入场<tspan class="price-value" dx="5">{{ geometry.entryPrice }}</tspan></text>
    <g v-if="geometry.tp1">
      <line :x1="geometry.left" :x2="geometry.right" :y1="geometry.tp1.y" :y2="geometry.tp1.y" stroke="#8abd38" stroke-dasharray="5 4" />
      <text :x="geometry.left + 5" :y="geometry.tp1.y - 6" fill="#8abd38">TP1<tspan class="price-value" dx="5">{{ geometry.tp1.price }}</tspan></text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, ref } from 'vue'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import { useChartPosition } from '../../composables/usePositionChart'
import { formatPrice } from './utils/kline-formatters'

/** 获取实时图表实例，以适应交易对或指标切换时的图表重建。 */
interface Props {
  symbol?: string
  klines: SimpleKLineData[]
  getChart: () => IChartApi | null
  getSeries: () => ISeriesApi<'Candlestick'> | null
  loading?: boolean
}
const props = defineProps<Props>()
const position = useChartPosition(() => props.symbol)
/** SVG 使用主价格轴坐标；所有区域会随缩放、拖动及实时价格同步移动。 */
interface Geometry {
  width: number
  height: number
  left: number
  right: number
  entry: number
  entryPrice: string
  strategyId: string
  strategyY: number
  zones: { label: string; y: number; price: string; color: string }[]
  tp1: { y: number; price: string } | null
}
const geometry = shallowRef<Geometry | null>(null)
// 沿用默认显示，允许用户单独关闭风险区域，不影响订单标记及持仓监控。
const enabled = ref(true)
// 保证短期持仓的标签空间，同时让框体覆盖持仓期间的全部 K 线。
const MIN_RISK_BOX_WIDTH = 100
const LATEST_KLINE_PADDING = 30
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
        { value: target, label: Number(selected.takeProfit2) > 0 ? 'TP2' : 'TP1', color: '#8abd38' }
      ]) {
        const y = series.priceToCoordinate(item.value)
        if (Number.isFinite(item.value) && item.value > 0 && y !== null) {
          zones.push({ label: item.label, color: item.color, y, price: formatPrice(item.value) })
        }
      }
      const tp1 = Number(selected.takeProfit1)
      const tp1Y = series.priceToCoordinate(tp1)
      next = { width: scale.width(), height: chart.panes()[0]?.getHeight() ?? 0, left, right, entry,
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
onMounted(() => { frame = requestAnimationFrame(updateGeometry) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<style scoped>
.risk-toggle { position: absolute; left: 12px; bottom: 58px; z-index: 3; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card, #141414); color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 3px 6px; }
.position-risk-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: hidden; z-index: 1; }
text { font-size: 12px; font-weight: 600; paint-order: stroke; stroke: var(--bg-card, #141414); stroke-width: 3px; stroke-linejoin: round; }
/* 数值使用主题正文色，标签颜色继续表达价位的业务含义。 */
.price-value { fill: var(--text-primary, #e5eaf3); }
</style>
