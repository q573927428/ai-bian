<template>
  <div class="chart-controls">
    <div class="controls-left">
      <div class="symbol-badge">{{ displaySymbol }}</div>

      <div class="timeframe-selector">
        <div class="timeframe-buttons">
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
        </div>
      </div>

      <!-- EMA周期选择器 -->
      <div class="ema-period-selector">
        <div class="ema-period-buttons">
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
        </div>
      </div>
    </div>

    <div class="controls-right">
      <!-- 图表标记控制开关 -->
      <div class="marker-controls">
        <el-tooltip
          :content="scanSupported ? '显示当前周期的历史策略扫描结果' : '当前周期没有对应的扫描策略'"
          placement="top"
        >
          <el-button
            size="small"
            :type="showScanMarkers ? 'warning' : 'default'"
            :loading="scanLoading"
            :disabled="!scanSupported"
            class="scan-marker-btn"
            @click="$emit('scan-markers-change', !showScanMarkers)"
          >
            <el-icon v-if="!scanLoading"><ElIconDataAnalysis /></el-icon>
            <span>扫描<span v-if="showScanMarkers">({{ scanCount }})</span></span>
          </el-button>
        </el-tooltip>

        <el-popover
          v-model:visible="scanRangePopoverVisible"
          placement="bottom-end"
          :width="390"
          trigger="click"
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
            <el-date-picker
              v-model="scanDateRange"
              type="datetimerange"
              range-separator="至"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
              format="YYYY-MM-DD HH:mm"
              value-format="x"
              :disabled-date="disableScanRangeDate"
              clearable
              class="scan-range-picker"
            />
            <div class="scan-range-actions">
              <el-button size="small" @click="resetScanTimeRange">重置</el-button>
              <el-button size="small" type="primary" @click="applyScanTimeRange">应用</el-button>
            </div>
          </div>
        </el-popover>

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

// 定义props
interface Props {
  symbol?: string
  timeframe?: string
  theme?: 'light' | 'dark'
  loading?: boolean
  showEMAMarkers?: boolean
  showOrderMarkers?: boolean
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
  'ema-lines-change': [show: boolean]
  'scan-markers-change': [show: boolean]
  'scan-range-change': [range: [number, number] | null]
  'ema-periods-change': [periods: number[]]
  'switch-engine': [engine: 'native' | 'tradingview']
}>()

// 可用的EMA周期选项
const availableEmaPeriods = [7, 14, 20, 30, 50, 60, 120, 200]

// 响应式数据
const selectedTimeframe = ref(props.timeframe)
const selectedEmaPeriods = ref<number[]>([...props.emaPeriods])
const showEMAMarkers = ref(props.showEMAMarkers)
const showOrderMarkers = ref(props.showOrderMarkers)
const showEMALines = ref(props.showEMALines)
const showScanMarkers = ref(props.showScanMarkers)
const scanRangePopoverVisible = ref(false)
const scanDateRange = ref<[number, number] | null>(props.scanTimeRange ? [...props.scanTimeRange] : null)

// 计算显示的symbol
const displaySymbol = computed(() => {
  return props.symbol || 'BTCUSDT'
})

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

.scan-marker-btn {
  min-width: 66px;
}

.scan-range-btn {
  width: 32px;
  padding: 5px;
}

.scan-range-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scan-range-picker {
  width: 100% !important;
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

/* 周期选择器 */
.timeframe-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 15px;
}

.timeframe-buttons {
  display: flex;
  gap: 2px;
  padding: 3px 10px;
}

.timeframe-btn {
  padding: 2px 5px;
  font-size: 13px;
  border-radius: 15px;
  transition: all 0.2s ease;
}

.timeframe-btn:deep(.el-button--default) {
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--text-regular);
}

.timeframe-btn:deep(.el-button--primary) {
  border-radius: 6px;
  box-shadow: none;
}

.timeframe-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* EMA周期选择器 */
.ema-period-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-hover);
  border: 1px solid var(--color-primary);
  border-radius: 12px;
}

.ema-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--bg-card);
  border-radius: 4px;
}

.ema-period-buttons {
  display: flex;
  gap: 2px;
  padding: 2px 8px;
}

.ema-period-btn {
  padding: 2px 5px;
  font-size: 12px;
  border-radius: 10px;
  transition: all 0.2s ease;
}

.ema-period-btn:deep(.el-button--default) {
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-primary);
}

.ema-period-btn:deep(.el-button--primary) {
  border-radius: 6px;
  box-shadow: none;
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
  
  .timeframe-selector {
    width: 100%;
    justify-content: center;
    background: var(--bg-hover);
    border: 1px solid var(--border-color);
    border-radius: 15px;
}
  
  .timeframe-buttons {
    display: flex;
    gap: 2px;
  }

  .ema-period-selector {
    width: 100%;
    justify-content: center;
    background: var(--bg-hover);
    border: 1px solid var(--color-primary);
    border-radius: 15px
  }
  
  .controls-right {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }
  
  .marker-controls {
    flex: 1;
    gap: 8px;
    padding: 2px 8px;
    border-radius: 6px;
  }
  
  .marker-switch :deep(.el-switch__label) {
    font-size: 11px;
  }
  
  .action-buttons {
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
