<template>
  <!-- K线模式：横排数据面板 -->
  <div 
    v-if="mode === 'kline'"
    ref="tooltipRef" 
    class="kline-tooltip"
    :class="{ 'tooltip-visible': visible || klineData.length > 0 }"
    :style="style"
  >
    <div class="tooltip-content" :class="{ 'tooltip-content-hidden': !visible }">
      <span class="symbol">{{ symbol }}</span>
      <span class="symbol-info">永续 Binance</span>
      <span class="timeframe">{{ timeframe }}</span>
      <span class="time">{{ time }}</span>
      <span class="data-item">
        <span class="label">开=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.open) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">高=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.high) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">低=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.low) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">收=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.close) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">量:</span>
        <span class="value">
          {{ formatVolume(data.volume) }}
        </span>
      </span>
    </div>
    <div class="tooltip-content" :class="{ 'tooltip-content-hidden': !visible }">
      <span class="data-item">
        <span class="label">涨跌:</span>
        <span class="value" :class="{ 'price-up': data.changePercent > 0, 'price-down': data.changePercent < 0 }">
          {{ formatPercent(data.changePercent) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">EMA差:</span>
        <span class="value" :class="{ 'price-up': (data.emaDiffPercent ?? 0) > 0, 'price-down': (data.emaDiffPercent ?? 0) < 0 }">
          {{ (data.emaDiffPercent ?? 0) > 0 ? '+' : '' }}{{ (data.emaDiffPercent ?? 0).toFixed(3) }}%
        </span>
      </span>
      <span class="data-item">
        <span class="label">ATR%:</span>
        <span class="value">
          {{ (data.atrPercent ?? 0).toFixed(2) }}%
        </span>
      </span>
      <span class="data-item">
        <span class="label">RSI:</span>
        <span class="value" :class="{ 'price-up': (data.rsi ?? 0) >= 70, 'price-down': (data.rsi ?? 0) <= 30 }">
          {{ (data.rsi ?? 0).toFixed(1) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">ADX:</span>
        <span class="value" :class="{ 'price-up': (data.adx ?? 0) >= 25, 'price-down': (data.adx ?? 0) < 20 }">
          {{ (data.adx ?? 0).toFixed(1) }}
        </span>
      </span>
    </div>

    <!-- 图表统计固定在行情数据下方，并与行情数据共用画布内的悬浮定位。 -->
    <!-- <KLineChartInfo
      floating
      :kline-data="klineData"
      :updated="updated"
    /> -->
  </div>

  <!-- 订单模式：竖排订单详情面板 -->
  <div 
    v-else-if="mode === 'order'"
    ref="tooltipRef" 
    class="order-tooltip"
    :class="{ 'tooltip-visible': visible }"
    :style="style"
  >
    <div class="order-tooltip-content">
      <div class="order-tooltip-header">
        <span class="order-title">📋 订单</span>
        <span class="order-count">{{ orders.length }}笔</span>
        <span class="order-time">{{ time }}</span>
        <span class="order-close" @click="$emit('close')">✕</span>
      </div>
      <div class="order-list">
        <div 
          v-for="order in orders" 
          :key="order.id" 
          class="order-item"
        >
          <div class="order-row">
            <span class="order-direction" :class="getOrderDirClass(order)">
              {{ getOrderActionLabel(order) }}
            </span>
            <span class="order-strategy">{{ getStrategyLabel(order) }}</span>
            <span class="order-pnl" :class="order.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'">
              {{ order.pnl >= 0 ? '+' : '' }}{{ order.pnl.toFixed(2) }} ({{ order.pnlPercentage >= 0 ? '+' : '' }}{{ order.pnlPercentage.toFixed(2) }}%)
            </span>
          </div>
          <div class="order-row order-pnl-row">
            <span class="order-leverage">×{{ order.leverage || 1 }}</span>
            <span class="order-prices">
              开{{ formatPrice(order.entryPrice) }} → 平{{ formatPrice(order.exitPrice) }}
            </span>
          </div>
          <div class="order-row order-meta">
            <span class="order-reason">{{ order.reason || '-' }}</span>
            <span class="order-holding" v-if="order.holdingMinutes">
              {{ order.holdingMinutes }}分钟
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TradeHistory } from '../../../types'
import type { SimpleKLineData } from '../../../types/kline-simple'
import { formatPrice, formatVolume, formatPercent } from './utils/kline-formatters'
import { useBotStore } from '../../stores/bot'
import KLineChartInfo from './KLineChartInfo.vue'

// 获取策略名称映射
const botStore = useBotStore()
const strategyNameMap = computed(() => {
  const map: Record<string, string> = {}
  const strategies = botStore.statusConfig?.strategies || []
  for (const s of strategies) {
    if (s.id && s.name) {
      map[s.id as string] = s.name as string
    }
  }
  return map
})
const getStrategyLabel = (order: TradeHistory): string => {
  const sid = order.strategyId || ''
  if (!sid) return '-'
  return strategyNameMap.value[sid] ?? sid
}

// K线时间对齐
const alignToKlineTime = (ts: number): number => {
  const sec = getTimeframeSeconds(props.timeframe || '1h')
  return Math.floor(ts / 1000 / sec) * sec
}
const getTimeframeSeconds = (tf: string): number => {
  switch (tf) {
    case '5m': return 5 * 60
    case '15m': return 15 * 60
    case '1h': return 60 * 60
    case '4h': return 4 * 60 * 60
    case '1d': return 24 * 60 * 60
    case '1w': return 7 * 24 * 60 * 60
    default: return 60 * 60
  }
}

// 根据 klineTime 判断订单在当前K线是开仓还是平仓
const getOrderActionLabel = (order: TradeHistory): string => {
  const kt = props.klineTime
  if (!kt) return order.direction === 'LONG' ? '做多' : '做空'
  const openAligned = alignToKlineTime(order.openTime)
  const closeAligned = alignToKlineTime(order.closeTime)
  const isOpen = openAligned === kt
  const isClose = closeAligned === kt
  
  if (isOpen && isClose) return order.direction === 'LONG' ? '开多/平多' : '开空/平空'
  if (isOpen) return order.direction === 'LONG' ? '做多' : '做空'
  if (isClose) return order.direction === 'LONG' ? '平多' : '平空'
  return order.direction === 'LONG' ? '做多' : '做空'
}

const getOrderDirClass = (order: TradeHistory): string => {
  const label = getOrderActionLabel(order)
  if (label.includes('开空') || label.includes('平空') || label === '做空') return 'dir-short'
  return 'dir-long'
}

// 定义props
interface Props {
  mode?: 'kline' | 'order'
  visible?: boolean
  symbol?: string
  timeframe?: string
  time?: string
  data?: {
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
  }
  klineTime?: number
  orders?: TradeHistory[]
  klineData?: SimpleKLineData[]
  updated?: number
  position?: {
    left: string
    top: string
  }
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'kline',
  visible: false,
  symbol: 'BTCUSDT',
  timeframe: '1h',
  time: '',
  data: () => ({
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    changePercent: 0,
    emaDiffPercent: 0
  }),
  orders: () => [],
  klineData: () => [],
  updated: 0,
  position: () => ({
    left: '20px',
    top: '20px'
  })
})

// 定义 emits
const emitClose = defineEmits<{ 'close': [] }>()

// 工具引用
const tooltipRef = ref<HTMLElement | null>(null)

// 计算样式
const style = computed(() => ({
  left: props.position.left,
  top: props.position.top
}))

</script>

<style scoped>
.kline-tooltip {
  position: absolute;
  left: 20px;
  top: 20px;
  background: transparent;
  z-index: 20;
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}

.kline-tooltip.tooltip-visible {
  opacity: 1;
  transform: translateY(0);
}

.tooltip-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.tooltip-content-hidden {
  visibility: hidden;
}

.tooltip-content .symbol {
  font-weight: 600;
  color: var(--color-primary);
}

.tooltip-content .symbol-info {
  font-size: 11px;
  color: var(--text-secondary);
}

.tooltip-content .timeframe {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 1px 4px;
  border-radius: 3px;
}

.tooltip-content .time {
  font-size: 11px;
  color: var(--text-secondary);
}

.tooltip-content .data-item {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tooltip-content .data-item .label {
  color: var(--text-secondary);
  font-size: 11px;
}

.tooltip-content .data-item .value {
  font-weight: 600;
  font-family: 'Courier New', monospace;
  text-align: right;
  padding-left: 1px;
  padding-top: 3px;
}

.tooltip-content .data-item .value.price-up {
  color: var(--color-success);
}

.tooltip-content .data-item .value.price-down {
  color: var(--color-danger);
}

/* ========== 订单浮动面板样式 ========== */
.order-tooltip {
  position: absolute;
  left: 20px;
  top: 80px;
  z-index: 21;
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: auto;
}

.order-tooltip.tooltip-visible {
  opacity: 1;
  transform: translateY(0);
}

.order-tooltip-content {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-card-hover);
  padding: 12px;
  min-width: 250px;
  max-width: 380px;
  max-height: 300px;
  overflow-y: auto;
}

.order-tooltip-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}

.order-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.order-count {
  font-size: 12px;
  color: var(--color-primary);
  background: rgba(64, 158, 255, 0.1);
  padding: 1px 6px;
  border-radius: 10px;
}

.order-time {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
}

.order-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.order-item {
  padding: 8px;
  background: var(--bg-hover);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.order-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.order-row + .order-row {
  margin-top: 4px;
}

.order-strategy {
  font-size: 12px;
  color: var(--color-warning);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 4px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-direction {
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.dir-long {
  color: #26a69a;
  background: rgba(38, 166, 154, 0.1);
}

.dir-short {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.1);
}

.order-prices {
  color: var(--text-regular);
  font-family: 'Courier New', monospace;
}

.order-pnl-row {
  gap: 12px;
}

.order-leverage {
  color: var(--text-secondary);
  font-size: 11px;
}

.order-quantity {
  color: var(--text-regular);
}

.order-pnl {
  font-weight: 600;
  font-family: 'Courier New', monospace;
}

.pnl-positive {
  color: #26a69a;
}

.pnl-negative {
  color: #ef5350;
}

.order-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.order-reason {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-close {
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  margin-left: auto;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.2s;
}

.order-close:hover {
  color: var(--color-danger);
}

.order-holding {
  margin-left: auto;
}

/* 响应式设计 - 手机端 (480px以下) */
@media (max-width: 480px) {
  .kline-tooltip {
    left: 20px !important;
    top: 10px !important;
    margin-right: 70px;
  }
  
  .tooltip-content {
    font-size: 11px;
    gap: 4px;
    flex-wrap: wrap;
    max-width: 95vw;
  }
  
  .tooltip-content .symbol,
  .tooltip-content .timeframe,
  .tooltip-content .time {
    font-size: 10px;
  }
  
  .tooltip-content .data-item {
    font-size: 10px;
  }
  
  .tooltip-content .data-item .value {
    min-width: 40px;
    font-size: 10px;
  }
}
</style>
