<template>
  <div class="chart-controls">
    <div class="controls-left">
      <div class="symbol-badge">{{ displaySymbol }}</div>

      <div class="timeframe-selector">
        <div class="timeframe-buttons">
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
    </div>

    <div class="controls-right">
      <!-- 图表标记控制开关 -->
      <div class="marker-controls">
        <el-tooltip content="显示/隐藏EMA金叉死叉标记" placement="top">
          <el-switch
            v-model="showEMAMarkers"
            size="small"
            inactive-text="交叉信号"
            @change="handleEMAMarkersChange"
            class="marker-switch"
          />
        </el-tooltip>
        
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
        <el-button
          type="primary"
          size="small"
          @click="$emit('refresh')"
          :loading="loading"
          title="刷新图表"
          class="action-btn"
        >
          <el-icon><ElIconRefresh /></el-icon>
        </el-button>
        
        <el-button
          type="info"
          size="small"
          @click="$emit('toggle-theme')"
          title="切换主题"
          class="action-btn"
        >
          <el-icon>
            <ElIconSunny v-if="theme === 'light'" />
            <ElIconMoon v-else />
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
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  theme: 'light',
  loading: false,
  showEMAMarkers: false,
  showOrderMarkers: false,
  showEMALines: true
})

// 定义emits
const emit = defineEmits<{
  'timeframe-change': [timeframe: string]
  'refresh': []
  'toggle-theme': []
  'ema-markers-change': [show: boolean]
  'order-markers-change': [show: boolean]
  'ema-lines-change': [show: boolean]
}>()

// 响应式数据
const selectedTimeframe = ref(props.timeframe)
const showEMAMarkers = ref(props.showEMAMarkers)
const showOrderMarkers = ref(props.showOrderMarkers)
const showEMALines = ref(props.showEMALines)

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

// 监听props.timeframe变化
watch(() => props.timeframe, (newTimeframe) => {
  if (newTimeframe && newTimeframe !== selectedTimeframe.value) {
    selectedTimeframe.value = newTimeframe
  }
})

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
</script>

<style scoped>
.chart-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e4e7ed;
  transition: all 0.3s ease;
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 标记控制开关 */
.marker-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.marker-switch {
  --el-switch-on-color: #409eff;
  --el-switch-off-color: #dcdfe6;
}

.marker-switch :deep(.el-switch__label) {
  font-size: 12px;
  font-weight: 500;
}

.marker-switch :deep(.el-switch__label.is-active) {
  color: #409eff;
}

.symbol-badge {
  background: #409eff;
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
}

.timeframe-buttons {
  display: flex;
  gap: 2px;
  background: #eeeeee;
  border: 1px solid #cccccc;
  border-radius: 15px;
  padding: 3px 10px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.timeframe-btn {
  padding: 2px 8px;
  font-size: 13px;
  border-radius: 15px;
  transition: all 0.2s ease;
}

.timeframe-btn:deep(.el-button--default) {
  border: none;
  background: transparent;
  box-shadow: none;
  color: #606266;
}

.timeframe-btn:deep(.el-button--primary) {
  border-radius: 6px;
  box-shadow: none;
}

.timeframe-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  gap: 8px;
}

/* 手机端响应式 (576px以下) */
@media (max-width: 576px) {
  .chart-controls {
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }
  
  .controls-left {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
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
  }
  
  .timeframe-buttons {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    width: 100%;
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
