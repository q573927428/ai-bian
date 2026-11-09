<!-- ==================== 价格轴左侧实时盘口挂单条 ==================== -->
<template>
  <template v-if="!historical && symbol">
    <button class="depth-toggle" type="button" :aria-pressed="enabled" @click="$emit('toggle')">
      {{ enabled ? '隐藏盘口挂单' : '盘口挂单' }}
    </button>
    <span v-if="enabled" class="depth-status" :class="{ live: geometry, 'depth-capacity': connectionStatus === 'capacity' }" :title="connectionStatus === 'capacity' ? '最多同时观察 3 个交易对，关闭其他盘口后重试' : description">
      {{ connectionStatus === 'capacity' ? '' : '盘口 · ' }}{{ statusLabel }}{{ geometry?.partial ? ' · 部分覆盖' : '' }}
      <button v-if="connectionStatus === 'capacity'" class="depth-retry" type="button" @click.stop="reconnect">重试</button>
    </span>
    <svg v-if="enabled && geometry" class="depth-overlay" :width="geometry.width" :height="geometry.height" aria-label="当前可见盘口挂单分布">
      <rect :x="geometry.width - geometry.barWidth" y="0" :width="geometry.barWidth" :height="geometry.height" fill="currentColor" fill-opacity="0.025" />
      <rect v-for="bar in geometry.bars" :key="bar.key" :x="geometry.width - bar.width" :y="bar.y"
        :width="bar.width" height="2" :fill="bar.side === 'bid' ? '#22c55e' : '#ef4444'" fill-opacity="0.85"
        class="depth-bar" @pointerdown.stop @click.stop @dblclick.stop>
        <title>{{ bar.title }}</title>
      </rect>
    </svg>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { OrderBookSnapshot } from '../../../types/order-book'

/** 图层只观察当前盘口；历史复盘禁止叠加今天的挂单。 */
interface Props {
  enabled: boolean
  symbol?: string
  historical?: boolean
  loading?: boolean
  getChart: () => IChartApi | null
  getSeries: () => ISeriesApi<'Candlestick'> | null
}
/** 按屏幕价格区域合并后的横条，悬停展示原始金额和区间。 */
interface Bar {
  key: string
  y: number
  side: 'bid' | 'ask'
  amount: number
  quantity: number
  lower: number
  upper: number
  width: number
  title: string
}
/** 几何尺寸取自主图绘图区，不包含右侧价格轴和下方指标窗格。 */
interface Geometry {
  width: number
  height: number
  barWidth: number
  partial: boolean
  bars: Bar[]
}
const props = defineProps<Props>()
defineEmits<{ toggle: [] }>()
const enabled = computed(() => props.enabled)
const snapshot = shallowRef<OrderBookSnapshot | null>(null)
const connectionStatus = shallowRef('syncing')
const geometry = shallowRef<Geometry | null>(null)
const description = '当前普通可见挂单（不含 RPI），红卖绿买；长度按 USDT 金额平方根缩放。仅覆盖已同步区间，不代表历史成交或大户身份。'
const statusLabel = computed(() => {
  if (connectionStatus.value === 'capacity') return '盘口已满'
  if (props.loading) return '等待图表'
  if (geometry.value) return '实时挂单'
  return connectionStatus.value === 'disconnected' ? '连接中'
    : connectionStatus.value === 'stale' ? '数据已过期'
    : connectionStatus.value === 'live' ? '当前视区无挂单' : '同步中'
})
let source: EventSource | null = null
let mounted = false
let frame = 0
let lastDraw = 0
let lastReceipt = 0
let previous = ''

/** 切换交易对/关闭图层时主动关闭 SSE，服务端随最后一个观察者离开释放连接。 */
function reconnect() {
  source?.close()
  source = null
  snapshot.value = null
  geometry.value = null
  previous = ''
  lastReceipt = 0
  connectionStatus.value = 'syncing'
  if (!mounted || !enabled.value || props.historical || !props.symbol) return
  const current = new EventSource(`/api/market/order-book/stream?symbol=${encodeURIComponent(props.symbol)}`)
  source = current
  current.addEventListener('capacity', () => {
    if (source !== current) return
    // 满额时停止浏览器自动重连，只允许用户点击重试或切换到其他交易对。
    current.close()
    source = null
    snapshot.value = null
    geometry.value = null
    previous = ''
    connectionStatus.value = 'capacity'
  })
  current.addEventListener('depth', (event) => {
    if (source !== current) return
    try {
      const data = JSON.parse((event as MessageEvent).data) as OrderBookSnapshot
      const symbol = props.symbol!.toUpperCase().replace(/:USDT$/, '').replace('/', '')
      if (data.symbol !== symbol) return
      snapshot.value = data
      lastReceipt = performance.now()
      connectionStatus.value = data.status
      if (data.status !== 'live') { geometry.value = null; previous = '' }
    } catch { snapshot.value = null; geometry.value = null; previous = '' }
  })
  current.onerror = () => {
    if (source !== current) return
    snapshot.value = null
    geometry.value = null
    previous = ''
    connectionStatus.value = 'disconnected'
    // EventSource 自动重连；错误时立即撤下旧挂单，不能等重连成功才清除。
  }
}

/** 价格轴缩放没有独立事件，低频读取坐标；同一屏幕区域合并，避免密集档位重叠。 */
function draw(now: number) {
  frame = requestAnimationFrame(draw)
  if (now - lastDraw < 100) return
  lastDraw = now
  const data = snapshot.value
  const chart = props.getChart()
  const series = props.getSeries()
  if (!enabled.value || props.historical || props.loading || !chart || !series || data?.status !== 'live'
    || !data.coverage || now - lastReceipt > 3000) {
    if (data?.status === 'live' && now - lastReceipt > 3000) connectionStatus.value = 'stale'
    geometry.value = null
    previous = ''
    return
  }
  const width = chart.timeScale().width()
  const height = chart.panes()[0]?.getHeight() ?? 0
  if (width <= 0 || height <= 0) { geometry.value = null; previous = ''; return }
  const barWidth = Math.min(110, width * 0.22)
  const buckets = new Map<string, Bar>()
  for (const [side, levels] of [['bid', data.bids], ['ask', data.asks]] as const) {
    for (const [price, quantity] of levels) {
      const coordinate = series.priceToCoordinate(price)
      if (coordinate == null || coordinate < 0 || coordinate >= height) continue
      const y = Math.floor(coordinate / 4) * 4
      const key = `${side}:${y}`
      let bar = buckets.get(key)
      if (!bar) {
        bar = { key, y, side, amount: 0, quantity: 0, lower: price, upper: price, width: 0, title: '' }
        buckets.set(key, bar)
      }
      bar.amount += price * quantity
      bar.quantity += quantity
      bar.lower = Math.min(bar.lower, price)
      bar.upper = Math.max(bar.upper, price)
    }
  }
  const bars = [...buckets.values()]
  const maxAmount = Math.max(1, ...bars.map(bar => bar.amount))
  const price = (value: number) => Number(value.toPrecision(8)).toString()
  for (const bar of bars) {
    // 共用金额比例，平方根压缩极端大墙，避免其余挂单缩成不可见像素。
    bar.width = Math.max(1, Math.sqrt(bar.amount / maxAmount) * barWidth)
    if (bar.side === 'ask') bar.y = Math.min(height - 2, bar.y + 2)
    bar.title = `${bar.side === 'bid' ? '买盘' : '卖盘'} ${price(bar.lower)}${bar.lower === bar.upper ? '' : ` ～ ${price(bar.upper)}`}\n数量：${bar.quantity.toLocaleString(undefined, { maximumSignificantDigits: 8 })}\n金额：${bar.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`
  }
  const top = series.coordinateToPrice(0)
  const bottom = series.coordinateToPrice(height)
  const partial = top == null || bottom == null || Math.max(top, bottom) > data.coverage.upper || Math.min(top, bottom) < data.coverage.lower
  const next = bars.length ? { width, height, barWidth, partial, bars } : null
  const serialized = JSON.stringify(next)
  if (serialized !== previous) { geometry.value = next; previous = serialized }
}

watch([enabled, () => props.symbol, () => props.historical], reconnect)
onMounted(() => { mounted = true; reconnect(); frame = requestAnimationFrame(draw) })
onBeforeUnmount(() => { mounted = false; source?.close(); cancelAnimationFrame(frame) })
</script>

<style scoped>
.depth-toggle { position: absolute; left: 12px; bottom: 86px; z-index: 3; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card, #141414); color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 3px 6px; }
.depth-status { position: absolute; left: 20px; top: 76px; z-index: 3; font-size: 10px; color: var(--text-secondary, #909399); background: var(--bg-card, #141414); padding: 2px 4px; border-radius: 3px; }
.depth-status.live { color: var(--text-primary, #e5eaf3); }
.depth-retry { margin-left: 6px; border: 1px solid var(--border-color); border-radius: 3px; background: var(--bg-card, #141414); color: var(--text-primary, #e5eaf3); cursor: pointer; font-size: 11px; padding: 1px 5px; }
.depth-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: hidden; z-index: 2; color: var(--text-secondary, #909399); }
.depth-bar { pointer-events: auto; }
</style>
