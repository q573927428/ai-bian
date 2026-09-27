<template>
  <div class="tradingview-panel" style="margin-bottom: -43px;">
    <!-- 图表控制栏 -->
    <div class="chart-controls">
      <div class="controls-left">
        <div class="symbol-badge">{{ displaySymbol }}</div>
        <el-select
          v-model="timeframe"
          placeholder="时间周期"
          size="small"
          style="width: 100px"
          @change="updateChart"
        >
          <el-option label="1分钟" value="1" />
          <el-option label="5分钟" value="5" />
          <el-option label="15分钟" value="15" />
          <el-option label="1小时" value="60" />
          <el-option label="4小时" value="240" />
          <el-option label="1天" value="1D" />
          <el-option label="1周" value="1W" />
        </el-select>

        <el-select
          v-model="theme"
          placeholder="主题"
          size="small"
          style="width: 100px; margin-left: 8px"
          @change="updateChart"
        >
          <el-option label="深色" value="dark" />
          <el-option label="浅色" value="light" />
        </el-select>

        <el-select
          v-model="chartType"
          placeholder="图表类型"
          size="small"
          style="width: 100px; margin-left: 8px"
          @change="updateChart"
        >
          <el-option label="蜡烛图" value="candlesticks" />
          <el-option label="线图" value="line" />
          <el-option label="面积图" value="area" />
          <el-option label="柱状图" value="bars" />
        </el-select>
      </div>

      <div class="controls-right">
        <el-button-group size="small">
          <!-- 引擎切换按钮 -->
          <el-tooltip content="切换到自研K线图表" placement="top">
            <el-button
              size="small"
              type="default"
              @click="$emit('switch-engine', 'native')"
              title="切换至自研K线"
            >
              <el-icon><ElIconTrendCharts /></el-icon>
            </el-button>
          </el-tooltip>

          <el-button
            type="primary"
            size="small"
            @click="refreshChart"
            :loading="isLoading"
            title="刷新图表"
          >
            <el-icon><ElIconRefresh /></el-icon>
          </el-button>
          
          <el-button
            type="warning"
            size="small"
            @click="toggleFullscreen"
            title="全屏"
          >
            <el-icon><ElIconFullScreen /></el-icon>
          </el-button>
        </el-button-group>
      </div>
    </div>

    <!-- 图表容器 -->
    <div class="chart-container">
      <div 
        v-if="!isChartLoaded && !chartError" 
        class="chart-loading"
      >
        <el-skeleton :rows="5" animated />
        <div class="loading-text">正在加载TradingView图表...</div>
      </div>

      <div 
        ref="chartContainer"
        class="tradingview-chart"
        :style="{ 
          height: chartHeight,
          display: isChartLoaded ? 'block' : 'none'
        }"
      ></div>

      <!-- 错误状态 -->
      <div 
        v-if="chartError" 
        class="chart-error"
      >
        <el-alert
          :title="chartError"
          type="error"
          :closable="false"
          show-icon
        />
        <div class="error-actions">
          <el-button type="primary" @click="initChart">
            重试
          </el-button>
          <el-button @click="useFallbackChart">
            使用备用图表
          </el-button>
        </div>
      </div>
    </div>

    <!-- 图表信息 -->
    <!-- <div class="chart-info-wrapper">
      <KLineChartInfo
        :kline-data="klineData"
        :updated="lastUpdated"
      />
    </div> -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTheme } from '../../composables/useTheme'
// import KLineChartInfo from './KLineChartInfo.vue'

const props = defineProps<{
  symbol: string
  timeframe?: string
  activeEngine?: 'native' | 'tradingview'
}>()

const emit = defineEmits<{
  'switch-engine': [engine: 'native' | 'tradingview']
}>()

const { theme: globalTheme } = useTheme()

// 响应式数据
const timeframe = ref(props.timeframe || '60')
const theme = ref(globalTheme.value)
const chartType = ref('candlesticks')
const isFullscreen = ref(false)
const isLoading = ref(false)
const isChartLoaded = ref(false)
const chartError = ref('')
const chartContainer = ref<HTMLDivElement>()
const tradingViewWidget = ref<any>(null)

// 图表信息数据（与KLineChartSimple保持一致）
const klineData = ref<any[]>([])
const lastUpdated = ref(0)

// 计算显示的symbol
const displaySymbol = computed(() => {
  return props.symbol || 'BTCUSDT'
})

/**
 * 将内部符号格式（如 "BTC/USDT"）转换为 TradingView 兼容格式
 *
 * 固定使用 Binance 数据源，所有 USDT 交易对统一加 ".P" 后缀。
 */
function getTradingViewSymbol(symbol: string): string {
  // 统一移除斜杠，得到 "BASEUSDT" 格式
  const cleaned = symbol.replace('/', '')
  // 固定 Binance 数据源 + .P 后缀
  return `BINANCE:${cleaned}.P`
}

// 计算属性
const chartHeight = computed(() => {
  if (isFullscreen.value) return 'calc(100vh - 200px)'
  if (process.client) {
    const screenWidth = window.innerWidth
    if (screenWidth < 480) return '300px'
    if (screenWidth < 768) return '450px'
  }
  return '500px'
})

// 监听全局主题变化，自动同步到TradingView
watch(globalTheme, (newTheme) => {
  theme.value = newTheme
  if (tradingViewWidget.value) {
    updateChart()
  }
})

// 监听symbol变化
watch(() => props.symbol, (newSymbol) => {
  if (newSymbol) {
    initChart()
  }
})

// 初始化TradingView图表
async function initChart() {
  const symbolToUse = displaySymbol.value
  if (!symbolToUse) {
    chartError.value = '缺少交易对'
    return
  }

  destroyChart()

  isLoading.value = true
  isChartLoaded.value = false
  chartError.value = ''

  try {
    await loadTradingViewScript()
    await nextTick()

    let retryCount = 0
    const maxRetries = 10
    while (!chartContainer.value && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 100))
      retryCount++
    }

    if (!chartContainer.value) {
      throw new Error('图表容器未找到')
    }

    if (!chartContainer.value.id) {
      chartContainer.value.id = 'tradingview-chart-' + Date.now()
    }

    // 填充图表信息数据，使 KLineChartInfo 组件正常显示
    klineData.value = [{ t: Math.floor(Date.now() / 1000) }]
    lastUpdated.value = Date.now()

    tradingViewWidget.value = new (window as any).TradingView.widget({
      container_id: chartContainer.value.id,
      symbol: getTradingViewSymbol(symbolToUse),
      interval: timeframe.value,
      theme: theme.value,
      style: chartType.value === 'candlesticks' ? '1' : 
             chartType.value === 'line' ? '2' : 
             chartType.value === 'area' ? '3' : '0',
      locale: 'zh_CN',
      toolbar_bg: '#f1f3f6',
      enable_publishing: false,
      allow_symbol_change: false,
      hide_side_toolbar: false,
      hide_top_toolbar: true,
      studies: [
        {
          id: "MAExp@tv-basicstudies",
          inputs: { length: 14 },
          styles: { lineColor: "#2962FF", lineWidth: 2 }
        },
        {
          id: "MAExp@tv-basicstudies",
          inputs: { length: 50 },
          styles: { lineColor: "#ff9800", lineWidth: 3 }
        }
      ],
      show_popup_button: true,
      popup_width: '1000',
      popup_height: '850',
      autosize: true,
      disabled_features: [
        'use_localstorage_for_settings',
        'header_symbol_search'
      ],
      enabled_features: [
        'study_templates',
        'move_logo_to_main_pane'
      ],
      overrides: {
        'mainSeriesProperties.candleStyle.upColor': '#26a69a',
        'mainSeriesProperties.candleStyle.downColor': '#ef5350',
        'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
        'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350'
      }
    })

    isChartLoaded.value = true
  } catch (error: any) {
    console.error('初始化TradingView图表失败:', error)
    chartError.value = `加载图表失败: ${error.message || '未知错误'}`
  } finally {
    isLoading.value = false
  }
}

// 加载TradingView脚本
function loadTradingViewScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).TradingView) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.type = 'text/javascript'
    script.async = true

    script.onload = () => resolve()
    script.onerror = () => reject(new Error('加载TradingView脚本失败，请检查网络连接'))

    document.head.appendChild(script)
  })
}

// 更新图表
function updateChart() {
  if (tradingViewWidget.value) {
    destroyChart()
    initChart()
  }
}

// 刷新图表
function refreshChart() {
  updateChart()
}

// 切换全屏
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  if (tradingViewWidget.value) {
    setTimeout(() => {
      tradingViewWidget.value.chart().executeActionById('timeScaleReset')
    }, 100)
  }
}

// 使用备用图表（切换到自研引擎）
function useFallbackChart() {
  chartError.value = ''
  destroyChart()
  emit('switch-engine', 'native')
}

// 销毁图表
function destroyChart() {
  if (tradingViewWidget.value) {
    try {
      if (chartContainer.value) {
        chartContainer.value.innerHTML = ''
      }
      tradingViewWidget.value = null
    } catch (error) {
      console.error('销毁图表失败:', error)
    }
  }
}

// 组件挂载时初始化
onMounted(() => {
  if (props.symbol) {
    initChart()
  }
})

// 组件卸载时清理
onUnmounted(() => {
  destroyChart()
})

// 扩展Window接口
declare global {
  interface Window {
    TradingView: any
  }
}
</script>

<style scoped>
.tradingview-panel {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  margin: -20px;
  transition: all 0.3s ease;
}

.tradingview-panel:hover {
  box-shadow: var(--shadow-card-hover);
}

.symbol-badge {
  background: var(--color-primary);
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
}

/* 图表控制栏 */
.chart-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 图表容器 */
.chart-container {
  position: relative;
  min-height: 500px;
  border-radius: 8px;
  overflow: hidden;
}

.tradingview-chart {
  width: 100%;
  min-height: 500px;
}

.chart-loading {
  padding: 60px 20px;
  text-align: center;
  background: var(--bg-card);
}

.loading-text {
  margin-top: 20px;
  color: var(--text-secondary);
  font-size: 16px;
  font-weight: 500;
}

.chart-error {
  padding: 60px 20px;
  text-align: center;
  background: var(--bg-card);
}

.error-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
  gap: 16px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 12px 16px;
  }

  .controls-left {
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .controls-left .el-select {
    flex: 1;
    min-width: 120px;
  }

  .controls-right .el-button-group {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .chart-container {
    margin: 12px;
    min-height: 400px;
  }

  .tradingview-chart {
    min-height: 400px;
  }
}

@media (max-width: 480px) {
  .chart-controls {
    padding: 10px 12px;
    gap: 10px;
  }

  .controls-left {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: 100%;
  }

  .controls-left .el-select {
    width: 100% !important;
    margin-left: 0 !important;
  }

  .controls-right {
    width: 100%;
  }

  .controls-right .el-button-group {
    display: flex;
    width: 100%;
    gap: 4px;
  }

  .chart-container {
    min-height: 300px;
    margin: 8px;
  }

  .tradingview-chart {
    min-height: 300px;
  }

  .chart-loading,
  .chart-error {
    padding: 30px 10px;
  }
}
</style>