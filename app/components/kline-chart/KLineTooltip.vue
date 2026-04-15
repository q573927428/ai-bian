<template>
  <div 
    ref="tooltipRef" 
    class="kline-tooltip"
    :class="{ 'tooltip-visible': visible }"
    :style="style"
  >
    <div class="tooltip-content">
      <span class="symbol">{{ symbol }}</span>
      <span class="symbol-info">永续 Binance</span>
      <span class="timeframe">{{ timeframe }}</span>
      <span class="time">{{ time }}</span>
      <span class="data-item">
        <span class="label">开=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.open, isDOGE) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">高=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.high, isDOGE) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">低=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.low, isDOGE) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">收=</span>
        <span class="value" :class="{ 'price-up': data.close > data.open, 'price-down': data.close < data.open }">
          {{ formatPrice(data.close, isDOGE) }}
        </span>
      </span>
      <span class="data-item">
        <span class="label">量:</span>
        <span class="value">
          {{ formatVolume(data.volume) }}
        </span>
      </span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatPrice, formatVolume, formatPercent } from './utils/kline-formatters'
import { isDOGESymbol } from './utils/kline-helpers'

// 定义props
interface Props {
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
  position?: {
    left: string
    top: string
  }
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  symbol: 'BTCUSDT',
  timeframe: '15m',
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
  position: () => ({
    left: '20px',
    top: '20px'
  })
})

// 工具引用
const tooltipRef = ref<HTMLElement | null>(null)

// 计算样式
const style = computed(() => ({
  left: props.position.left,
  top: props.position.top
}))

// 判断是否为DOGE交易对
const isDOGE = computed(() => isDOGESymbol(props.symbol))
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
  color: #333;
  white-space: nowrap;
}

.tooltip-content .symbol {
  font-weight: 600;
  color: #409eff;
}

.tooltip-content .symbol-info {
  font-size: 11px;
  color: #6c757d;
}

.tooltip-content .timeframe {
  font-size: 11px;
  color: #6c757d;
  background: #f0f2f5;
  padding: 1px 4px;
  border-radius: 3px;
}

.tooltip-content .time {
  font-size: 11px;
  color: #6c757d;
}

.tooltip-content .data-item {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tooltip-content .data-item .label {
  color: #6c757d;
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
  color: #67c23a;
}

.tooltip-content .data-item .value.price-down {
  color: #f56c6c;
}

/* 深色主题下的浮动面板 */
:global(.dark) .kline-tooltip {
  background: transparent;
}

:global(.dark) .tooltip-content {
  color: #e4e7ed;
}

:global(.dark) .tooltip-content .symbol {
  color: #66b3ff;
}

:global(.dark) .tooltip-content .symbol-info {
  color: #a0a4ad;
}

:global(.dark) .tooltip-content .timeframe {
  background: #2c2e33;
  color: #a0a4ad;
}

:global(.dark) .tooltip-content .time {
  color: #a0a4ad;
}

:global(.dark) .tooltip-content .data-item .label {
  color: #a0a4ad;
}

:global(.dark) .tooltip-content .data-item .value.price-up {
  color: #85ce61;
}

:global(.dark) .tooltip-content .data-item .value.price-down {
  color: #f78989;
}

/* 响应式设计 - 手机端 (480px以下) */
@media (max-width: 480px) {
  .kline-tooltip {
    left: 10px !important;
    top: 10px !important;
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