<template>
  <div class="chart-controls">
    <div class="controls-left">
      <el-button class="symbol-badge" @click="emit('open-price-drawer')">
        <img
          v-if="!iconFailed[displaySymbol] && coinIconUrl(displaySymbol)"
          :src="coinIconUrl(displaySymbol)"
          :alt="displaySymbol"
          class="symbol-icon"
          @error="onIconError(displaySymbol)"
        > 
        <span
          v-else
          class="symbol-icon-placeholder"
          :style="{ backgroundColor: placeholderColor(displaySymbol) }"
          aria-hidden="true"
        >{{ baseAsset(displaySymbol).slice(0, 1) }}</span>
        {{ displaySymbol }}
        <el-icon><ElIconArrowDown /></el-icon>
      </el-button>

      <el-button-group size="small" class="timeframe-buttons">
          <el-button
            size="small"
            :type="selectedTimeframe === '5m' ? 'primary' : 'default'"
            @click="selectTimeframe('5m')"
            class="timeframe-btn"
          >
            5m
          </el-button>
          <el-button
            size="small"
            :type="selectedTimeframe === '15m' ? 'primary' : 'default'"
            @click="selectTimeframe('15m')"
            class="timeframe-btn"
          >
            15m
          </el-button>
          <el-button
            size="small"
            :type="selectedTimeframe === '1h' ? 'primary' : 'default'"
            @click="selectTimeframe('1h')"
            class="timeframe-btn"
          >
            1h
          </el-button>
          <el-button
            size="small"
            :type="selectedTimeframe === '4h' ? 'primary' : 'default'"
            @click="selectTimeframe('4h')"
            class="timeframe-btn"
          >
            4h
          </el-button>
          <el-button
            size="small"
            :type="selectedTimeframe === '1d' ? 'primary' : 'default'"
            @click="selectTimeframe('1d')"
            class="timeframe-btn"
          >
            1d
          </el-button>
          <el-button
            size="small"
            :type="selectedTimeframe === '1w' ? 'primary' : 'default'"
            @click="selectTimeframe('1w')"
            class="timeframe-btn"
          >
            1w
          </el-button>
      </el-button-group>

      <!-- EMA周期选择器 -->
      <el-button-group size="small" class="ema-period-buttons">
          <el-button
            v-for="period in availableEmaPeriods"
            :key="period"
            size="small"
            :type="selectedEmaPeriods.includes(period) ? 'primary' : 'default'"
            @click="toggleEmaPeriod(period)"
            :disabled="!selectedEmaPeriods.includes(period) && selectedEmaPeriods.length >= 3"
            class="ema-period-btn"
          > 
            {{ period }}
          </el-button>
      </el-button-group>
    </div>

    <div class="controls-right">
      <!-- 图表标记控制开关 -->
      <div class="marker-controls">
        <div class="scan-controls-group">
          <el-tooltip
            :content="scanSupported ? `显示当前周期的历史策略扫描结果（${scanCount}）` : '当前周期没有对应的扫描策略'"
            placement="top"
          >
            <el-switch
              v-model="showScanMarkers"
              size="small"
              inactive-text="扫描"
              :loading="scanLoading"
              :disabled="!scanSupported"
              class="marker-switch scan-marker-switch"
              @change="handleScanMarkersChange"
            />
          </el-tooltip>

          <el-popover
            v-if="showScanMarkers"
            v-model:visible="scanRangePopoverVisible"
            placement="bottom-end"
            :width="390"
            trigger="click"
            popper-class="scan-range-popover"
          >
            <template #reference>
              <el-button
                size="small"
                :type="scanTimeRange ? 'primary' : 'default'"
                :disabled="!scanSupported || !scanRangeBounds"
                class="scan-range-btn"
                title="设置扫描时间范围"
              >
                <el-icon><ElIconCalendar /></el-icon>
              </el-button>
            </template>

            <div class="scan-range-panel">
              <!-- 日期面板留在 Popover 内，并解除左右月份联动以支持选择较长时间范围。 -->
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
                unlink-panels
                clearable
                class="scan-range-picker"
                style="width: 100%; min-width: 0; --el-date-editor-width: 100%; --el-date-editor-datetimerange-width: 100%"
              />
              <div class="scan-range-actions">
                <el-button size="small" @click="resetScanTimeRange">重置</el-button>
                <el-button size="small" type="primary" @click="applyScanTimeRange">应用</el-button>
              </div>
            </div>
          </el-popover>
        </div>

        <!-- <el-tooltip content="显示/隐藏EMA金叉死叉标记" placement="top">
          <el-switch
            v-model="showEMAMarkers"
            size="small"
            inactive-text="交叉"
            @change="handleEMAMarkersChange"
            class="marker-switch"
          />
        </el-tooltip> -->
        
        <el-tooltip content="显示/隐藏历史订单开仓平仓标记" placement="top">
          <el-switch
            v-model="showOrderMarkers"
            size="small"
            inactive-text="订单"
            @change="handleOrderMarkersChange"
            class="marker-switch"
          />
        </el-tooltip>

        <el-tooltip
          v-if="showOrderMarkers"
          content="仅显示主周期与当前K线周期一致的历史订单"
          placement="top"
        >
          <el-switch
            v-model="filterOrderMarkersByTimeframe"
            size="small"
            inactive-text="周期"
            @change="handleOrderTimeframeFilterChange"
            class="marker-switch"
          />
        </el-tooltip>
        
        <el-tooltip content="显示/隐藏EMA快慢线" placement="top">
          <el-switch
            v-model="showEMALines"
            size="small"
            inactive-text="EMA线"
            @change="handleEMALinesChange"
            class="marker-switch"
          />
        </el-tooltip>
      </div>
      
      <el-button-group size="small" class="action-buttons">
        <!-- 引擎切换按钮 -->
        <el-tooltip :content="activeEngine === 'native' ? '切换到TradingView图表' : '切换到自研K线图表'" placement="top">
          <el-button
            size="small"
            type="default"
            @click="$emit('switch-engine', activeEngine === 'native' ? 'tradingview' : 'native')"
            :title="activeEngine === 'native' ? '切换至TradingView' : '切换至自研K线'"
            class="action-btn"
          >
            <el-icon><ElIconCoin v-if="activeEngine === 'native'" /><ElIconTrendCharts v-else /></el-icon>
          </el-button>
        </el-tooltip>

        <el-button
          type="primary"
          size="small"
          @click="$emit('refresh')"
          title="刷新图表"
          class="action-btn"
        >
          <el-icon><ElIconRefresh /></el-icon>
        </el-button>

        <el-button
          type="warning"
          size="small"
          @click="$emit('toggle-fullscreen')"
          title="全屏"
          class="action-btn"
        >
          <el-icon>
            <ElIconFullScreen />
          </el-icon>
        </el-button>
      </el-button-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useCoinIcon } from '../../composables/useCoinIcon'

/**
 * K线控制栏属性，包含图表状态、标记开关和周期过滤配置。
 */
interface Props {
  symbol?: string
  timeframe?: string
  theme?: 'light' | 'dark'
  loading?: boolean
  showEMAMarkers?: boolean
  showOrderMarkers?: boolean
  filterOrderMarkersByTimeframe?: boolean
  showEMALines?: boolean
  showScanMarkers?: boolean
  scanLoading?: boolean
  scanSupported?: boolean
  scanCount?: number
  scanTimeRange?: [number, number] | null
  scanRangeBounds?: [number, number] | null
  emaPeriods?: number[]
  activeEngine?: 'native' | 'tradingview'
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  theme: 'light',
  loading: false,
  showEMAMarkers: false,
  showOrderMarkers: false,
  filterOrderMarkersByTimeframe: false,
  showEMALines: true,
  showScanMarkers: false,
  scanLoading: false,
  scanSupported: true,
  scanCount: 0,
  scanTimeRange: null,
  scanRangeBounds: null,
  emaPeriods: () => [20, 200],
  activeEngine: 'native'
})

// 定义emits
const emit = defineEmits<{
  'timeframe-change': [timeframe: string]
  'refresh': []
  'toggle-theme': []
  'toggle-fullscreen': []
  'ema-markers-change': [show: boolean]
  'order-markers-change': [show: boolean]
  'order-timeframe-filter-change': [filter: boolean]
  'ema-lines-change': [show: boolean]
  'scan-markers-change': [show: boolean]
  'scan-range-change': [range: [number, number] | null]
  'ema-periods-change': [periods: number[]]
  'switch-engine': [engine: 'native' | 'tradingview']
  'open-price-drawer': []
}>()

// 可用的EMA周期选项
const availableEmaPeriods = [7, 14, 20, 30, 50, 60, 120, 200]

// 响应式数据
const selectedTimeframe = ref(props.timeframe)
const selectedEmaPeriods = ref<number[]>([...props.emaPeriods])
const showEMAMarkers = ref(props.showEMAMarkers)
const showOrderMarkers = ref(props.showOrderMarkers)
const filterOrderMarkersByTimeframe = ref(props.filterOrderMarkersByTimeframe)
const showEMALines = ref(props.showEMALines)
const showScanMarkers = ref(props.showScanMarkers)
const scanRangePopoverVisible = ref(false)
const scanDateRange = ref<[number, number] | null>(props.scanTimeRange ? [...props.scanTimeRange] : null)
const iconFailed = ref<Record<string, boolean>>({})
const { getCoinIconUrl } = useCoinIcon()

// 计算显示的symbol
const displaySymbol = computed(() => {
  return props.symbol || 'BTCUSDT'
})

/** 将交易对统一为图标清单格式，并在缺少官方图标时提供稳定占位信息。 */
function coinIconUrl(symbol: string) {
  return getCoinIconUrl(symbol.replace('/', '')) || ''
}

function onIconError(symbol: string) {
  iconFailed.value[symbol] = true
}

function baseAsset(symbol: string) {
  return symbol.replace('/', '').replace(/(USDT|USDC|FDUSD|BUSD)$/, '').toUpperCase()
}

/** 使用基础资产生成固定颜色，避免图标缺失时按钮布局跳动。 */
function placeholderColor(symbol: string) {
  let hash = 0
  for (const character of baseAsset(symbol)) {
    hash = character.charCodeAt(0) + ((hash << 5) - hash)
  }
  return `hsl(${Math.abs(hash) % 360} 48% 42%)`
}

// 选择周期
const selectTimeframe = (timeframe: string) => {
  if (selectedTimeframe.value === timeframe) return
  selectedTimeframe.value = timeframe
  emit('timeframe-change', timeframe)
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
  scanRangePopoverVisible.value = false
}

/**
 * 恢复为当前已加载 K 线的完整时间范围。
 */
const resetScanTimeRange = () => {
  scanDateRange.value = null
  emit('scan-range-change', null)
  scanRangePopoverVisible.value = false
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

// 监听props.showEMAMarkers变化
watch(() => props.showEMAMarkers, (newValue) => {
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

// 监听props.showEMALines变化
watch(() => props.showEMALines, (newValue) => {
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
</script>

<style scoped>
.chart-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.controls-left {
  display: flex;
  flex: 1 1 20px;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.controls-right {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 16px;
  margin-left: auto;
}

/* 标记控制开关 */
.marker-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.marker-switch {
  --el-switch-on-color: var(--color-primary);
  --el-switch-off-color: var(--border-lighter);
}

.marker-switch :deep(.el-switch__label) {
  font-size: 12px;
  font-weight: 500;
}

.marker-switch :deep(.el-switch__label.is-active) {
  color: var(--color-primary);
}

.scan-controls-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
  border-right: 1px solid var(--border-color);
}

.scan-marker-switch {
  flex-shrink: 0;
}

.scan-range-btn {
  flex-shrink: 0;
  width: 32px;
  padding: 1px;
  border-radius: 12px;
}

.scan-range-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.scan-range-picker {
  width: 100% !important;
  max-width: 100%;
  min-width: 0 !important;
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

:global(.scan-range-popover.el-popover) {
  width: min(390px, calc(100vw - 24px)) !important;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
}

/* 日期范围组件默认固定为 400px，需要按 Popover 的实际内容宽度收缩。 */
:global(.scan-range-popover .scan-range-picker.el-date-editor--datetimerange) {
  --el-date-editor-width: 100%;
  --el-date-editor-datetimerange-width: 100%;
  width: 100% !important;
  max-width: 100%;
  min-width: 0 !important;
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
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.symbol-icon,
.symbol-icon-placeholder {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border-radius: 50%;
}

.symbol-icon {
  display: block;
  object-fit: cover;
  margin-right: 5px;
}

.symbol-icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.timeframe-buttons,
.ema-period-buttons {
  display: inline-flex;
  border-radius: 12px;
  overflow: hidden;
}

.timeframe-buttons :deep(.el-button:first-child),
.ema-period-buttons :deep(.el-button:first-child) {
  border-radius: 12px 0 0 12px;
}

.timeframe-buttons :deep(.el-button:last-child),
.ema-period-buttons :deep(.el-button:last-child) {
  border-radius: 0 12px 12px 0;
}

.timeframe-btn {
  padding: 12px 8px;
  font-size: 13px;
}

/* EMA周期选择器 */
.ema-period-btn {
  padding: 12px 8px;
  font-size: 12px;
}

.ema-period-btn:deep(.el-button.is-disabled) {
  color: var(--text-disabled);
  cursor: not-allowed;
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  gap: 1px;
}

@media (max-width: 576px) {
  .chart-controls {
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }
  
  .controls-left {
    width: 100%;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  
  .symbol-badge {
    width: 100%;
    text-align: center;
    padding: 4px 8px;
    font-size: 13px;
    border-radius: 12px;
  }
  
  .timeframe-buttons {
    width: 100%;
    justify-content: center;
  }

  .ema-period-buttons {
    width: 100%;
    justify-content: center;
  }
  
  .controls-right {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 8px;
  }
  
  .marker-controls {
    width: 100%;
    box-sizing: border-box;
    flex: none;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 8px;
    border-radius: 6px;
  }

  .scan-controls-group {
    gap: 4px;
    padding-right: 6px;
  }
  
  .marker-switch :deep(.el-switch__label) {
    font-size: 11px;
  }
  
  .action-buttons {
    align-self: flex-end;
    gap: 4px;
  }
  
  .action-btn {
    padding: 6px 8px;
  }
  
  .action-btn .el-icon {
    font-size: 14px;
  }
  
}
</style>
