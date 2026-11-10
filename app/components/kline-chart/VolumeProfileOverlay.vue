<!-- ==================== 可见K线估算成交分布与主密集区 ==================== -->
<template>
  <button ref="toggleButton" class="profile-toggle" type="button" :aria-pressed="enabled" title="历史成交分布，与实时盘口互斥显示" @click="$emit('toggle')">
    {{ enabled ? '隐藏成交分布' : '成交分布' }}
  </button>
  <svg v-if="enabled && !loading && geometry" ref="overlay" class="profile-overlay" :width="geometry.width" :height="geometry.height" aria-label="可见K线估算成交分布：条长为成交额，青色净买占比至少5%，红色净卖占比至少5%，灰色差额不足5%，斜纹表示方向数据缺失">
    <defs>
      <pattern :id="patternId" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#909399" fill-opacity="0.2" />
        <path d="M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5" stroke="#909399" stroke-width="1.5" />
      </pattern>
    </defs>
    <template v-if="geometry.zone">
      <rect x="0" :y="geometry.zone.y" :width="geometry.width" :height="geometry.zone.height" fill="#d8b456" fill-opacity="0.065" />
      <line x1="0" :x2="geometry.width" :y1="geometry.peakY" :y2="geometry.peakY" stroke="#d8b456" stroke-opacity="0.65" stroke-dasharray="4 4" />
      <text v-if="zoneHovered" :x="geometry.width - geometry.barWidth - 8" :y="geometry.zone.labelY" text-anchor="end">主密集区 {{ geometry.zone.label }}</text>
    </template>
    <rect v-for="bar in geometry.bars" :key="bar.index" :x="geometry.width - bar.width" :y="bar.y" :width="bar.width" :height="bar.height" :fill="bar.missing ? `url(#${patternId})` : bar.color" :fill-opacity="bar.opacity" class="profile-bar" @pointerdown.stop @click.stop @dblclick.stop>
      <title>{{ bar.title }}</title>
    </rect>
  </svg>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useId, watch } from 'vue'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../types/kline-simple'
import { calculateVolumeProfile } from '../../utils/volume-profile'

/** 使用主图实例和可见K线计算历史分布，加载期间不展示旧交易对数据。 */
interface Props {
  enabled: boolean
  symbol?: string
  timeframe?: string
  klines: SimpleKLineData[]
  loading?: boolean
  getChart: () => IChartApi | null
  getSeries: () => ISeriesApi<'Candlestick'> | null
}
/** 裁剪到主价格窗格的分布与密集带坐标，不覆盖下方成交量/指标窗格。 */
interface Geometry {
  width: number
  height: number
  barWidth: number
  peakY: number
  zone: { y: number; height: number; labelY: number; label: string } | null
  bars: { index: number; y: number; height: number; width: number; color: string; missing: boolean; opacity: number; title: string }[]
}
const props = defineProps<Props>()
defineEmits<{ toggle: [] }>()
// 每张图使用独立的斜纹ID，避免多交易对面板之间引用到其他图的定义。
const patternId = `profile-missing-${useId().replace(/:/g, '-')}`
const directionThreshold = 0.05
const geometry = shallowRef<Geometry | null>(null)
const toggleButton = shallowRef<HTMLButtonElement | null>(null)
const overlay = shallowRef<SVGSVGElement | null>(null)
const pointer = shallowRef<{ x: number; y: number } | null>(null)
// 虚线上下各留 5px 容差，便于命中细线，同时不因经过整个密集带而显示文字。
const zoneHovered = computed(() => {
  const area = geometry.value
  const point = pointer.value
  return !!(props.enabled && !props.loading && area?.zone && point
    && point.x >= 0 && point.x <= area.width && point.y >= 0 && point.y <= area.height
    && Math.abs(point.y - area.peakY) <= 5)
})
let hoverContainer: HTMLElement | null = null

/** 旁听图表容器的鼠标移动，不让虚线拦截图表拖动及十字光标操作。 */
function trackPointer(event: PointerEvent) {
  const bounds = overlay.value?.getBoundingClientRect()
  pointer.value = bounds && event.pointerType !== 'touch'
    ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null
}

/** 离开图表后收起主密集区说明。 */
function clearPointer() {
  pointer.value = null
}
const profile = shallowRef<ReturnType<typeof calculateVolumeProfile> | null>(null)
let frame = 0
let lastDraw = 0
let dirty = true
let rangeKey = ''
let previous = ''
const price = (value: number) => Number(value.toPrecision(7)).toString()
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** 低频同步价格轴缩放；只在K线或可见时间范围变化时重新分桶。 */
function draw(now: number) {
  frame = requestAnimationFrame(draw)
  if (now - lastDraw < 150) return
  lastDraw = now
  const chart = props.getChart()
  const series = props.getSeries()
  if (!props.enabled || props.loading || !chart || !series) {
    geometry.value = null
    profile.value = null
    dirty = true
    previous = ''
    return
  }
  const range = chart.timeScale().getVisibleRange()
  // 按时间筛选，避免指标前置数据或图表去重导致逻辑索引与原始数组错位。
  const key = range ? `${range.from}:${range.to}` : ''
  if (dirty || key !== rangeKey) {
    profile.value = calculateVolumeProfile(range ? props.klines.filter(bar => bar.t >= Number(range.from) && bar.t <= Number(range.to)) : [])
    dirty = false
    rangeKey = key
  }
  const data = profile.value!
  const width = chart.timeScale().width()
  const height = chart.panes()[0]?.getHeight() ?? 0
  if (width <= 0 || height <= 0 || data.peakIndex < 0) { geometry.value = null; previous = ''; return }
  const barWidth = Math.min(110, width * 0.2)
  const maximum = data.bins[data.peakIndex]!.amount
  const bars: Geometry['bars'] = []
  for (let index = 0; index < data.bins.length; index++) {
    const bin = data.bins[index]!
    if (bin.amount <= 0) continue
    const a = series.priceToCoordinate(bin.upper)
    const b = series.priceToCoordinate(bin.lower)
    if (a == null || b == null) continue
    const top = Math.max(0, Math.min(a, b))
    const bottom = Math.min(height, Math.max(a, b) + (a === b ? 2 : 0))
    if (bottom <= top) continue
    const ratio = bin.delta === null ? null : bin.delta / bin.amount
    const direction = ratio === null ? '方向缺失（斜纹）' : Math.abs(ratio) < directionThreshold ? '买卖接近平衡（净额占比不足5%）' : ratio > 0 ? '主动买入占优' : '主动卖出占优'
    bars.push({ index, y: top, height: Math.max(0.5, bottom - top - Math.min(1, (bottom - top) * 0.15)),
      width: bin.amount / maximum * barWidth,
      color: ratio === null || Math.abs(ratio) < directionThreshold ? '#909399' : ratio > 0 ? '#25b8a7' : '#ed6069',
      missing: ratio === null,
      // 整体调淡约20%，让重叠的K线和仓位标记更容易辨认，同时保留净额强弱差异。
      opacity: ratio === null ? 0.68 : 0.36 + Math.min(1, Math.abs(ratio)) * 0.4,
      title: `K线估算 ${price(bin.lower)} ～ ${price(bin.upper)}\n成交额：${amount(bin.amount)} USDT\n主动净额：${bin.delta === null ? '暂无完整数据' : `${bin.delta > 0 ? '+' : ''}${amount(bin.delta)} USDT`}\n${direction}${ratio === null ? '' : ` · 净额占比 ${(ratio * 100).toFixed(2)}%`}` })
  }
  const peak = data.bins[data.peakIndex]!
  const peakY = series.priceToCoordinate((peak.lower + peak.upper) / 2) ?? -1
  const upperY = data.zone ? series.priceToCoordinate(data.zone.upper) : null
  const lowerY = data.zone ? series.priceToCoordinate(data.zone.lower) : null
  const top = upperY === null || lowerY === null ? -1 : Math.max(0, Math.min(upperY, lowerY))
  const bottom = upperY === null || lowerY === null ? -1 : Math.min(height, Math.max(upperY, lowerY) + (upperY === lowerY ? 2 : 0))
  // 文字基线始终贴在最大成交价位虚线上方6px，不再跟随密集带上沿或强制避让顶部100px。
  // 窄屏仍保留横条和悬停；上下边界只做必要裁剪保护。
  const zone = data.zone && bottom > top ? { y: top, height: bottom - top, labelY: width < 420 ? -20 : Math.min(height - 5, Math.max(12, peakY - 6)), label: `${price(data.zone.lower)}–${price(data.zone.upper)}` } : null
  const next: Geometry = { width, height, barWidth, peakY, zone, bars }
  const serialized = JSON.stringify(next)
  if (serialized !== previous) { geometry.value = next; previous = serialized }
}

// 实时价格会高频修改末根K线，保留旧几何直到下一帧结果就绪，避免清空SVG造成闪烁。
watch(() => props.klines, () => {
  dirty = true
  if (!props.klines.length) { geometry.value = null; profile.value = null; previous = '' }
}, { deep: true })
watch(() => props.enabled, () => { dirty = true; geometry.value = null; profile.value = null; previous = '' })
// 切换交易对/周期必须立即撤下旧分布，不能沿用普通实时更新的保留策略。
watch([() => props.symbol, () => props.timeframe], () => {
  dirty = true; geometry.value = null; profile.value = null; previous = ''
}, { flush: 'sync' })
onMounted(() => {
  hoverContainer = toggleButton.value?.parentElement ?? null
  hoverContainer?.addEventListener('pointermove', trackPointer, { passive: true })
  hoverContainer?.addEventListener('pointerleave', clearPointer)
  frame = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  hoverContainer?.removeEventListener('pointermove', trackPointer)
  hoverContainer?.removeEventListener('pointerleave', clearPointer)
  cancelAnimationFrame(frame)
})
</script>

<style scoped>
.profile-toggle { position: absolute; left: 12px; bottom: 114px; z-index: 3; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card, #141414); color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 3px 6px; }
.profile-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: hidden; z-index: 2; }
.profile-bar { pointer-events: auto; }
text { font-size: 11px; fill: var(--text-primary, #e5eaf3); paint-order: stroke; stroke: var(--bg-card, #141414); stroke-width: 3px; }
</style>
