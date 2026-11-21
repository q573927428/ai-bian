<template>
  <div class="chart-controls" :class="{ 'has-chart-settings': !timeline }" role="group" aria-label="K 线工具栏">
    <div class="quote-tools">
      <div v-if="marketQuote !== undefined" class="market-quote">
        <button type="button" class="market-quote-pair" aria-haspopup="dialog"
          :aria-label="`${displaySymbol}，打开价格卡片`" title="打开价格卡片" @click="emit('open-price-cards')">
          <img v-if="coinIconUrl && coinIconUrl !== failedIconUrl" :src="coinIconUrl" alt="" class="market-quote-icon"
            @error="failedIconUrl = coinIconUrl">
          <span v-else class="market-quote-icon market-quote-icon-placeholder" aria-hidden="true">{{ displaySymbol[0] }}</span>
          <strong>{{ displaySymbol }}</strong>
          <svg class="market-quote-caret" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M2 4h8L6 9z" />
          </svg>
        </button>
        <dl class="market-quote-values">
          <div class="market-quote-price-block" :class="{ 'quote-up': quoteChange > 0, 'quote-down': quoteChange < 0 }">
            <dt class="market-quote-sr-only">最新价格与 24 小时涨跌</dt>
            <dd>
              <span class="market-quote-price">{{ quotePrice }}</span>
              <span class="market-quote-change" title="24 小时涨跌额和涨跌幅">
                <span v-if="quoteChangeAmountLabel">{{ quoteChangeAmountLabel }}</span>
                <span>{{ quoteChangeLabel }}</span>
              </span>
            </dd>
          </div>
          <div class="market-quote-volume" title="24 小时成交额（USDT）">
            <dt>24h 成交量</dt>
            <dd>{{ quoteVolume }}</dd>
          </div>
        </dl>
      </div>
      <div v-else class="symbol-badge">{{ displaySymbol }}</div>
    </div>

    <div class="controls-tools">
      <!-- 与价格看板共用默认小尺寸单选按钮样式，分时仍作为独立显示模式。 -->
      <el-radio-group
        :model-value="timeline ? 'timeline' : selectedTimeframe"
        class="timeframe-buttons"
        aria-label="K线周期"
        @change="value => selectTimeframe(String(value))"
      >
        <el-radio-button
          v-for="option in visibleTimeframeOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>

      <div v-if="!timeline" class="settings-tools">
        <el-popover v-model:visible="settingsVisible" trigger="click" placement="bottom-end" :width="324"
          :show-arrow="false" :hide-after="0" :persistent="false" role="dialog" title="图表设置"
          popper-class="chart-settings-popover" @after-enter="focusChartSettings">
          <template #reference>
            <button ref="settingsButton" type="button" class="settings-button" aria-haspopup="dialog"
              aria-label="图表设置" title="图表设置" :aria-expanded="settingsVisible" @keydown.esc="handleSettingsEscape">
              <el-icon aria-hidden="true"><ElIconSetting /></el-icon>
            </button>
          </template>

          <div ref="settingsPanel" class="chart-settings" tabindex="-1" @keydown.esc="handleSettingsEscape">
            <div class="layer-setting">
              <div class="layer-setting-row">
                <span>EMA 均线</span>
                <el-switch v-model="showEMALines" aria-label="EMA 均线" class="marker-switch" @change="handleEMALinesChange" />
              </div>
              <div class="layer-setting-row layer-setting-secondary">
                <span>周期</span>
                <small>选 2–3 个</small>
              </div>
              <div class="ema-periods" role="group" aria-label="EMA 周期">
                <el-checkbox
                  v-for="period in availableEmaPeriods"
                  :key="period"
                  size="small"
                  :model-value="selectedEmaPeriods.includes(period)"
                  :disabled="selectedEmaPeriods.includes(period) ? selectedEmaPeriods.length <= 2 : selectedEmaPeriods.length >= 3"
                  @change="toggleEmaPeriod(period)"
                >{{ period }}</el-checkbox>
              </div>
            </div>

            <div class="layer-setting">
              <div class="layer-setting-row">
                <div>
                  <div>历史策略扫描</div>
                  <small>{{ scanSupported ? `当前周期 ${scanCount} 条结果` : '当前周期没有对应的扫描策略' }}</small>
                </div>
                <el-switch v-model="showScanMarkers" aria-label="历史策略扫描" class="marker-switch"
                  :loading="scanLoading" :disabled="!scanSupported" @change="handleScanMarkersChange" />
              </div>
              <div v-if="showScanMarkers && scanSupported && scanRangeBounds" class="scan-range-panel">
                <!-- 日期面板留在同一弹层内，选日期时不会被判定为点击设置外部。 -->
                <el-date-picker
                  v-model="scanDateRange"
                  type="datetimerange"
                  range-separator="至"
                  start-placeholder="开始时间"
                  end-placeholder="结束时间"
                  format="YYYY-MM-DD HH:mm"
                  value-format="x"
                  :disabled-date="disableScanRangeDate"
                  :teleported="false"
                  single-panel
                  clearable
                  size="small"
                  class="scan-range-picker"
                />
                <div class="scan-range-actions">
                  <el-button size="small" @click="resetScanTimeRange">重置</el-button>
                  <el-button size="small" type="primary" @click="applyScanTimeRange">应用</el-button>
                </div>
              </div>
            </div>

            <div class="layer-setting">
              <div class="layer-setting-row">
                <span>历史订单标记</span>
                <el-switch v-model="showOrderMarkers" aria-label="历史订单标记" class="marker-switch" @change="handleOrderMarkersChange" />
              </div>
              <div v-if="showOrderMarkers" class="layer-setting-row layer-setting-secondary">
                <span>仅显示同周期订单</span>
                <el-switch v-model="filterOrderMarkersByTimeframe" aria-label="仅显示同周期订单" class="marker-switch"
                  @change="handleOrderTimeframeFilterChange" />
              </div>
            </div>

            <div class="layer-setting" role="group" aria-label="图表叠加">
              <div class="layer-setting-secondary">图表叠加</div>
              <div class="overlay-settings-grid">
                <div class="layer-setting-row">
                  <span>成交分布</span>
                  <el-switch v-model="volumeProfileEnabled" aria-label="成交分布" class="marker-switch" />
                </div>
                <div class="layer-setting-row">
                  <span>盘口挂单</span>
                  <el-switch v-model="orderBookEnabled" aria-label="盘口挂单" class="marker-switch"
                    :disabled="orderBookUnavailable" />
                </div>
                <div class="layer-setting-row">
                  <span>止盈止损</span>
                  <el-switch v-model="positionRiskEnabled" aria-label="止盈止损" class="marker-switch" />
                </div>
                <div class="layer-setting-row">
                  <span>支撑阻力</span>
                  <el-switch v-model="supportResistanceEnabled" aria-label="支撑阻力" class="marker-switch" />
                </div>
              </div>
              <div class="layer-setting-secondary">
                {{ orderBookUnavailable ? '订单回看时不显示实时盘口' : '成交分布与盘口挂单不能同时显示' }}
              </div>
            </div>

            <el-button size="small" class="settings-refresh" @click="refreshFromSettings">
              <el-icon><ElIconRefresh /></el-icon> 刷新图表
            </el-button>
          </div>
        </el-popover>
      </div>
    </div>

    <div class="action-buttons" role="group" aria-label="图表操作">
      <el-button size="small" class="action-btn toolbar-refresh" title="刷新图表" aria-label="刷新图表" @click="emit('refresh')">
        <el-icon><ElIconRefresh /></el-icon>
      </el-button>
      <el-button
        size="small"
        class="action-btn"
        :title="expanded ? '还原图表（Esc）' : '放大图表至整个页面'"
        :aria-label="expanded ? '还原K线图表' : '放大K线图表至整个页面'"
        :aria-pressed="expanded"
        @click="emit('toggle-fullscreen')"
      >
        <el-icon>
          <svg v-if="expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6" />
          </svg>
          <ElIconFullScreen v-else />
        </el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { PriceData } from '../../../types/websocket'
import { useCoinIcon } from '../../composables/useCoinIcon'
import { KLINE_WORKSPACE_PERIODS } from '../../utils/kline-indicators'
import { formatTradePrice } from './utils/kline-formatters'

/**
 * K线控制栏属性，包含图表状态、标记开关和周期过滤配置。
 */
interface Props {
  /** 副图与环境详情只跟踪受支持的原生 K 线周期。 */
  linkedIndicators?: boolean
  /** 是否已在浏览器页面内展开，用于切换按钮提示和还原图标。 */
  expanded?: boolean
  timeline?: boolean
  symbol?: string
  /** undefined 保留原徽章，null 表示当前交易对的行情尚未到达。 */
  marketQuote?: PriceData | null
  timeframe?: string
  theme?: 'light' | 'dark'
  loading?: boolean
  showEmaMarkers?: boolean
  showOrderMarkers?: boolean
  filterOrderMarkersByTimeframe?: boolean
  showEmaLines?: boolean
  showScanMarkers?: boolean
  scanLoading?: boolean
  scanSupported?: boolean
  scanCount?: number
  scanTimeRange?: [number, number] | null
  scanRangeBounds?: [number, number] | null
  emaPeriods?: number[]
  /** 查看历史订单时禁用实时盘口，但保留原来的开关偏好。 */
  orderBookUnavailable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  theme: 'light',
  loading: false,
  showEmaMarkers: false,
  showOrderMarkers: false,
  filterOrderMarkersByTimeframe: false,
  showEmaLines: true,
  showScanMarkers: false,
  scanLoading: false,
  scanSupported: true,
  scanCount: 0,
  scanTimeRange: null,
  scanRangeBounds: null,
  emaPeriods: () => [20, 200]
})

const volumeProfileEnabled = defineModel<boolean>('volumeProfileEnabled', { required: true })
const orderBookEnabled = defineModel<boolean>('orderBookEnabled', { required: true })
const positionRiskEnabled = defineModel<boolean>('positionRiskEnabled', { required: true })
const supportResistanceEnabled = defineModel<boolean>('supportResistanceEnabled', { required: true })

// 定义emits
const emit = defineEmits<{
  'timeline-change': [enabled: boolean]
  'timeframe-change': [timeframe: string]
  'refresh': []
  'toggle-theme': []
  'toggle-fullscreen': []
  'open-price-cards': []
  'ema-markers-change': [show: boolean]
  'order-markers-change': [show: boolean]
  'order-timeframe-filter-change': [filter: boolean]
  'ema-lines-change': [show: boolean]
  'scan-markers-change': [show: boolean]
  'scan-range-change': [range: [number, number] | null]
  'ema-periods-change': [periods: number[]]
}>()

// 可用的EMA周期选项
const availableEmaPeriods = [7, 14, 20, 30, 50, 60, 120, 200]

// 分时仅作为显示模式，其余周期值与 K 线接口保持一致。
const timeframeOptions = [
  { label: '1s', value: 'timeline' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
  { label: '1w', value: '1w' }
]
const visibleTimeframeOptions = computed(() => props.linkedIndicators
  ? timeframeOptions.filter(option => KLINE_WORKSPACE_PERIODS.some(period => period === option.value))
  : timeframeOptions)

// 响应式数据
const selectedTimeframe = ref(props.timeframe)
const selectedEmaPeriods = ref<number[]>([...props.emaPeriods])
// 与父组件的 show-ema-* 绑定保持标准驼峰命名，避免缩写全大写导致属性无法匹配。
const showEMAMarkers = ref(props.showEmaMarkers)
const showOrderMarkers = ref(props.showOrderMarkers)
const filterOrderMarkersByTimeframe = ref(props.filterOrderMarkersByTimeframe)
const showEMALines = ref(props.showEmaLines)
const showScanMarkers = ref(props.showScanMarkers)
const settingsVisible = ref(false)
const settingsButton = ref<HTMLButtonElement | null>(null)
const settingsPanel = ref<HTMLElement | null>(null)
const scanDateRange = ref<[number, number] | null>(props.scanTimeRange ? [...props.scanTimeRange] : null)

// 计算显示的symbol
const displaySymbol = computed(() => {
  return props.symbol || 'BTCUSDT'
})

const { getCoinIconUrl } = useCoinIcon()
const coinIconUrl = computed(() => getCoinIconUrl(displaySymbol.value))
const failedIconUrl = ref<string | null>(null)
const quotePrice = computed(() => {
  const price = props.marketQuote?.price
  return price != null && price > 0 ? formatTradePrice(price) : '--'
})
// 涨跌额、涨跌幅和成交额均来自滚动 24h 行情，不随 K 线周期改变。
const quoteChange = computed(() => props.marketQuote?.change24hPercent ?? NaN)
const quoteChangeLabel = computed(() => Number.isFinite(quoteChange.value)
  ? `${quoteChange.value > 0 ? '+' : ''}${quoteChange.value.toFixed(2)}%` : '--')
const quoteChangeAmountLabel = computed(() => {
  const amount = props.marketQuote?.change24hAmount
  // 缺失绝对涨跌额时只显示百分比，避免从已经舍入的百分比反推价格差。
  if (amount == null || !Number.isFinite(amount)) return ''
  return `${amount > 0 ? '+' : ''}${formatTradePrice(amount)}`
})
const volumeFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const quoteVolume = computed(() => {
  const volume = props.marketQuote?.volume24h
  return volume != null && Number.isFinite(volume) && volume >= 0 ? volumeFormatter.format(volume) : '--'
})

// 分时不传给 K 线接口；退出分时时，即使选中原周期也需要通知父组件切换模式。
const selectTimeframe = (timeframe: string) => {
  if (timeframe === 'timeline') {
    if (!props.timeline) emit('timeline-change', true)
    return
  }
  if (!props.timeline && selectedTimeframe.value === timeframe) return
  selectedTimeframe.value = timeframe
  emit('timeframe-change', timeframe)
}

/** 弹层传送到页面外层，打开后把焦点移入表单，避免 Tab 跳去图表之外。 */
function focusChartSettings() {
  if (settingsVisible.value && document.activeElement === settingsButton.value) {
    settingsPanel.value?.focus({ preventScroll: true })
  }
}

/** 先关闭设置，避免同一次 Esc 把全屏图表也还原。 */
function handleSettingsEscape(event: KeyboardEvent) {
  if (!settingsVisible.value || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  closeChartSettings()
}

/** 收起设置并将焦点还给触发按钮，避免焦点留在已隐藏的弹层中。 */
function closeChartSettings() {
  settingsVisible.value = false
  settingsButton.value?.focus({ preventScroll: true })
}

/** 手机将刷新放进设置，给完整交易对和报价留出空间。 */
function refreshFromSettings() {
  closeChartSettings()
  emit('refresh')
}

// 切换EMA周期
const toggleEmaPeriod = (period: number) => {
  const index = selectedEmaPeriods.value.indexOf(period)
  
  if (index > -1) {
    // 已选择，取消选择（但确保至少保留2个）
    if (selectedEmaPeriods.value.length > 2) {
      selectedEmaPeriods.value.splice(index, 1)
      emit('ema-periods-change', [...selectedEmaPeriods.value])
    }
  } else {
    // 未选择，添加选择（最多3个）
    if (selectedEmaPeriods.value.length < 3) {
      selectedEmaPeriods.value.push(period)
      // 排序
      selectedEmaPeriods.value.sort((a, b) => a - b)
      emit('ema-periods-change', [...selectedEmaPeriods.value])
    }
  }
}

// 处理EMA标记开关变化
const handleEMAMarkersChange = (show: string | number | boolean) => {
  emit('ema-markers-change', Boolean(show))
}

// 处理订单标记开关变化
const handleOrderMarkersChange = (show: string | number | boolean) => {
  emit('order-markers-change', Boolean(show))
}

/**
 * 切换历史扫描结果图层，具体数据加载由父组件统一处理。
 */
const handleScanMarkersChange = (show: string | number | boolean) => {
  emit('scan-markers-change', Boolean(show))
}

/**
 * 控制历史订单是否只显示在其策略主周期对应的K线上。
 */
const handleOrderTimeframeFilterChange = (filter: string | number | boolean) => {
  emit('order-timeframe-filter-change', Boolean(filter))
}

// 处理EMA线开关变化
const handleEMALinesChange = (show: string | number | boolean) => {
  emit('ema-lines-change', Boolean(show))
}

/**
 * 应用用户选择的扫描时间范围。
 */
const applyScanTimeRange = () => {
  const range = scanDateRange.value
    ? [Number(scanDateRange.value[0]), Number(scanDateRange.value[1])] as [number, number]
    : null
  emit('scan-range-change', range)
}

/**
 * 恢复为当前已加载 K 线的完整时间范围。
 */
const resetScanTimeRange = () => {
  scanDateRange.value = null
  emit('scan-range-change', null)
}

/**
 * 禁止选择当前 K 线数据覆盖范围以外的日期。
 */
const disableScanRangeDate = (date: Date) => {
  if (!props.scanRangeBounds) return false
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
  return dayEnd < props.scanRangeBounds[0] || dayStart > props.scanRangeBounds[1]
}

// 监听props.timeframe变化
watch(() => props.timeframe, (newTimeframe) => {
  if (newTimeframe && newTimeframe !== selectedTimeframe.value) {
    selectedTimeframe.value = newTimeframe
  }
})

// 监听props.emaPeriods变化
watch(() => props.emaPeriods, (newPeriods) => {
  if (newPeriods) {
    selectedEmaPeriods.value = [...newPeriods]
  }
}, { deep: true })

// 监听全局配置同步到控制栏的 EMA 标记状态。
watch(() => props.showEmaMarkers, (newValue) => {
  if (newValue !== undefined && newValue !== showEMAMarkers.value) {
    showEMAMarkers.value = newValue
  }
})

// 监听props.showOrderMarkers变化
watch(() => props.showOrderMarkers, (newValue) => {
  if (newValue !== undefined && newValue !== showOrderMarkers.value) {
    showOrderMarkers.value = newValue
  }
})

watch(() => props.filterOrderMarkersByTimeframe, (newValue) => {
  if (newValue !== undefined && newValue !== filterOrderMarkersByTimeframe.value) {
    filterOrderMarkersByTimeframe.value = newValue
  }
})

// 监听全局配置同步到控制栏的 EMA 线状态。
watch(() => props.showEmaLines, (newValue) => {
  if (newValue !== undefined && newValue !== showEMALines.value) {
    showEMALines.value = newValue
  }
})

// 扫描按钮状态由父组件统一管理，切换周期和请求失败时也能保持一致。
watch(() => props.showScanMarkers, (newValue) => {
  if (newValue !== undefined && newValue !== showScanMarkers.value) {
    showScanMarkers.value = newValue
  }
})

watch(() => props.scanTimeRange, (newRange) => {
  scanDateRange.value = newRange ? [...newRange] : null
}, { deep: true })

// 分时没有这组 K 线设置；切回 K 线时不恢复之前打开的菜单。
watch(() => props.timeline, (timeline) => {
  if (timeline) settingsVisible.value = false
})
</script>

<style scoped>
.chart-controls {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
  /* 窄图表横向滚动，保留所有按钮和周期，不把工具栏挤成第二行。 */
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-lighter) transparent;
}

.quote-tools {
  flex: none;
}

.controls-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  margin-inline-start: auto;
}

.settings-button {
  display: inline-grid;
  place-items: center;
  box-sizing: border-box;
  width: 30px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}

.settings-button:hover,
.settings-button[aria-expanded="true"] {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.marker-switch {
  --el-switch-on-color: var(--color-primary);
  --el-switch-off-color: var(--border-lighter);
}

:global(.chart-settings-popover.el-popover) {
  box-sizing: border-box;
  max-width: calc(100vw - 16px);
}

.chart-settings {
  display: grid;
  font-size: 13px;
}

.chart-settings:focus {
  outline: none;
}

.chart-settings .settings-refresh {
  display: none;
}

.layer-setting {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.layer-setting:last-of-type {
  padding-bottom: 0;
  border-bottom: 0;
}

.layer-setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.layer-setting-row small,
.layer-setting-secondary {
  color: var(--text-secondary);
  font-size: 12px;
}

.overlay-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 112px), 1fr));
  gap: 0 12px;
}

.ema-periods {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2px 6px;
  margin-top: 4px;
}

.ema-periods :deep(.el-checkbox) {
  margin: 0;
}

.scan-range-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  min-width: 0;
}

:global(.chart-settings-popover .scan-range-picker.el-date-editor--datetimerange) {
  --el-date-editor-width: 100%;
  --el-date-editor-datetimerange-width: 100%;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.scan-range-picker :deep(.el-range-input) {
  min-width: 0;
}

.scan-range-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.symbol-badge {
  background: var(--color-primary);
  color: white;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(64, 158, 255, 0.2);
}

.market-quote {
  display: flex;
  align-items: center;
  gap: 6px 16px;
  min-width: 0;
  color: var(--text-primary);
  white-space: nowrap;
}

.market-quote-pair {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 17px;
  line-height: 1.2;
  cursor: pointer;
}

.market-quote-pair strong {
  overflow: hidden;
  text-overflow: ellipsis;
}

.market-quote-pair:hover,
.market-quote-pair:focus-visible {
  background: var(--bg-hover);
}

.market-quote-caret {
  flex: none;
  width: 12px;
  height: 12px;
}

.market-quote-icon {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: contain;
}

.market-quote-icon-placeholder {
  display: grid;
  place-items: center;
  background: var(--border-color);
  font-size: 12px;
}

.market-quote-values {
  display: flex;
  align-items: center;
  gap: 4px 14px;
  margin: 0;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.market-quote-values dd {
  margin: 0;
}

.market-quote-volume {
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--border-color);
}

.market-quote-volume dt {
  color: var(--text-secondary);
  font-size: 11px;
}

.market-quote-volume dd {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 600;
}

.market-quote-price {
  display: block;
  font-size: 19px;
  font-weight: 700;
}

.market-quote-change {
  display: flex;
  gap: 4px;
  margin-top: 1px;
  font-size: 11px;
}

.market-quote-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.market-quote-values .quote-up { color: var(--color-success); }
.market-quote-values .quote-down { color: var(--color-danger); }

/* 略微收紧周期按钮宽度，保留与价格看板一致的高度和选中样式。 */
.timeframe-buttons {
  flex: none;
  flex-wrap: nowrap;
}

.timeframe-buttons :deep(.el-radio-button__inner) {
  padding-right: 8px;
  padding-left: 8px;
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  flex: none;
  gap: 6px;
}

.action-buttons :deep(.el-button) {
  margin: 0;
}

.action-btn {
  min-width: 30px;
  min-height: 28px;
  padding: 0 7px;
}

.action-btn .el-icon {
  font-size: 14px;
}

@media (max-width: 576px) {
  .chart-controls {
    /* 手机优先显示完整报价；所有周期仍在下排，无需横滑。 */
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "quote actions"
      "tools tools";
    padding-inline: 8px;
    gap: 6px 8px;
    overflow-x: visible;
  }

  .quote-tools {
    grid-area: quote;
    min-width: 0;
  }

  .action-buttons {
    grid-area: actions;
    justify-self: end;
    gap: 4px;
  }

  .has-chart-settings .toolbar-refresh {
    display: none;
  }

  .chart-settings .settings-refresh {
    display: inline-flex;
    justify-self: start;
    gap: 4px;
    margin-top: 8px;
  }

  .action-btn {
    min-width: 32px;
    min-height: 34px;
  }

  .controls-tools {
    grid-area: tools;
    gap: 8px;
    margin-inline-start: 0;
  }

  .market-quote {
    display: grid;
    grid-template-columns: fit-content(55%) minmax(0, 1fr);
    gap: 8px;
  }

  .market-quote-pair {
    gap: 4px;
    padding: 2px;
    font-size: 14px;
  }

  .market-quote-pair strong {
    /* 长代码可以断行，但不能因为报价变长而被省略号截掉。 */
    overflow: visible;
    overflow-wrap: anywhere;
    white-space: normal;
    text-overflow: clip;
  }

  .market-quote-icon {
    width: 18px;
    height: 18px;
  }

  .market-quote-values {
    /* 成交量始终保留上下两行；极窄时整组换行，不拆开标签和数值。 */
    flex-wrap: wrap;
    gap: 2px 8px;
  }

  .market-quote-price {
    font-size: 17px;
  }

  .market-quote-change {
    flex-wrap: wrap;
    row-gap: 0;
  }

  .market-quote-volume {
    padding-inline-start: 8px;
  }

  .market-quote-volume dt {
    font-size: 10px;
  }

  .market-quote-volume dd {
    font-size: 12px;
  }

  .timeframe-buttons {
    display: grid;
    flex: 1 1 auto;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    min-width: 0;
  }

  .timeframe-buttons :deep(.el-radio-button__inner) {
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 34px;
    padding: 0 2px;
    font-size: 12px;
  }

  .settings-button {
    width: 34px;
    min-height: 34px;
  }
}
</style>
