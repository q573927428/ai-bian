<template>
  <div v-if="visible" class="tradingview-card">
    <!-- 图表控制栏 -->
    <div class="chart-controls">
      <div class="controls-left">
        <div class="symbol-badge">{{ symbol }}</div>
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

      <div class="header-right">
        <!-- 控制按钮 -->
        <el-button-group size="small">
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
            type="info"
            size="small"
            @click="toggleFullscreen"
            title="切换全屏"
          >
            <el-icon>
              <ElIconFullScreen v-if="!isFullscreen" />
              <ElIconClose v-else />
            </el-icon>
          </el-button>
        
          <el-button
            type="danger"
            size="small"
            @click="handleClose"
            title="关闭图表"
          >
            <el-icon><ElIconClose /></el-icon>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

// Props
const props = defineProps<{
  modelValue: boolean
  symbol: string
  visible: boolean
}>()

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'close': []
}>()

// 响应式数据
const timeframe = ref('60')
const theme = ref('light')
const chartType = ref('candlesticks')
const isFullscreen = ref(false)
const isLoading = ref(false)
const isChartLoaded = ref(false)
const chartError = ref('')
const chartContainer = ref<HTMLDivElement>()
const tradingViewWidget = ref<any>(null)

// 辅助函数：将符号转换为TradingView格式
function getTradingViewSymbol(symbol: string): string {
  // 黄金和白银在TradingView中需要.P后缀
  if (symbol === 'XAUUSDT') {
    return 'XAUUSDT.P'
  }
  if (symbol === 'XAGUSDT') {
    return 'XAGUSDT.P'
  }
  // 其他符号保持不变
  return symbol
}

// 计算属性
const dialogTitle = computed(() => {
  return props.symbol ? `${props.symbol} K线图` : 'K线图'
})

const chartHeight = computed(() => {
  if (isFullscreen.value) {
    return 'calc(100vh - 200px)'
  }
  
  // 响应式高度：根据屏幕宽度调整
  // 使用process.client检查是否在客户端，避免SSR错误
  if (process.client) {
    const screenWidth = window.innerWidth
    
    if (screenWidth < 480) {
      // 手机端：较小高度
      return '300px'
    } else if (screenWidth < 768) {
      // 平板端：中等高度
      return '450px'
    }
  }
  
  // 默认桌面端高度或SSR时的高度
  return '450px'
})

// 监听symbol变化
watch(() => props.symbol, (newSymbol) => {
  if (newSymbol && props.visible) {
    initChart()
  }
})

// 监听弹窗显示状态
watch(() => props.visible, (newVisible) => {
  if (newVisible && props.symbol) {
    nextTick(() => {
      initChart()
    })
  } else {
    destroyChart()
  }
})

// 初始化TradingView图表
async function initChart() {
  if (!props.symbol) {
    chartError.value = '缺少交易对'
    return
  }

  // 销毁现有图表
  destroyChart()

  isLoading.value = true
  isChartLoaded.value = false
  chartError.value = ''

  try {
    // 动态加载TradingView脚本
    await loadTradingViewScript()
    
    // 等待DOM渲染完成
    await nextTick()
    
    // 等待chartContainer引用可用
    let retryCount = 0
    const maxRetries = 10
    
    while (!chartContainer.value && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 100))
      retryCount++
    }
    
    if (!chartContainer.value) {
      throw new Error('图表容器未找到')
    }

    // 确保容器有ID
    if (!chartContainer.value.id) {
      chartContainer.value.id = 'tradingview-chart-' + Date.now()
    }
    
    // 创建TradingView Widget
    tradingViewWidget.value = new (window as any).TradingView.widget({
      container_id: chartContainer.value.id,
      symbol: getTradingViewSymbol(props.symbol),
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
          styles: {
            lineColor: "#2962FF",
            lineWidth: 2
          }
        },
        {
          id: "MAExp@tv-basicstudies",
          inputs: { length: 120 },
          styles: {
            lineColor: "#FFD700",
            lineWidth: 2
          }
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
    ElMessage.success('图表加载成功')
  } catch (error: any) {
    console.error('初始化TradingView图表失败:', error)
    chartError.value = `加载图表失败: ${error.message || '未知错误'}`
    ElMessage.error('图表加载失败，请检查网络连接')
  } finally {
    isLoading.value = false
  }
}

// 加载TradingView脚本
function loadTradingViewScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // 检查是否已加载
    if ((window as any).TradingView) {
      console.log('TradingView脚本已加载')
      resolve()
      return
    }

    // 创建脚本元素
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.type = 'text/javascript'
    script.async = true

    script.onload = () => {
      console.log('TradingView脚本加载成功')
      resolve()
    }

    script.onerror = (error) => {
      console.error('TradingView脚本加载失败:', error)
      reject(new Error('加载TradingView脚本失败，请检查网络连接'))
    }

    // 添加到文档
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
  ElMessage.info('正在刷新图表...')
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

// 使用备用图表
function useFallbackChart() {
  chartError.value = ''
  ElMessage.info('正在准备备用图表...')
  // 这里可以集成ECharts作为备用
}

// 销毁图表
function destroyChart() {
  if (tradingViewWidget.value) {
    try {
      // TradingView Widget没有标准的销毁方法
      // 我们通过清空容器来移除它
      if (chartContainer.value) {
        chartContainer.value.innerHTML = ''
      }
      tradingViewWidget.value = null
    } catch (error) {
      console.error('销毁图表失败:', error)
    }
  }
}

// 处理modelValue更新
function handleModelValueUpdate(value: boolean) {
  emit('update:modelValue', value)
}

// 处理关闭
function handleClose() {
  destroyChart()
  emit('update:modelValue', false)
  emit('close')
}

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
.tradingview-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid #e4e7ed;
  overflow: hidden;
  margin-bottom: 20px;
  transition: all 0.3s ease;
}

.tradingview-card:hover {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
}

.symbol-badge {
  background: #409eff;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
}

.header-right {
  display: flex;
  align-items: center;
}

/* 图表控制栏 */
.chart-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e4e7ed;
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 图表容器 */
.chart-container {
  position: relative;
  min-height: 500px;
  margin: 20px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
  background: #f8f9fa;
}

.tradingview-chart {
  width: 100%;
  min-height: 500px;
}

.chart-loading {
  padding: 60px 20px;
  text-align: center;
  background: white;
}

.loading-text {
  margin-top: 20px;
  color: #6c757d;
  font-size: 16px;
  font-weight: 500;
}

.chart-error {
  padding: 60px 20px;
  text-align: center;
  background: white;
}

.error-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
  gap: 16px;
}

/* 响应式设计 - 平板端 (768px以下) */
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
  
  .header-right .el-button-group {
    display: flex;
    justify-content: center;
    width: 100%;
  }
  
  .header-right .el-button {
    flex: 1;
    min-width: 60px;
  }
  
  .chart-container {
    margin: 12px;
    min-height: 400px;
  }
  
  .tradingview-chart {
    min-height: 400px;
  }
}

/* 响应式设计 - 手机端 (480px以下) */
@media (max-width: 480px) {
  .symbol-badge {
    font-size: 12px;
    padding: 3px 8px;
    margin-bottom: 8px;
    text-align: center;
    width: 100%;
  }
  
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
    margin-bottom: 0;
  }
  
  .controls-left .el-select:last-child {
    margin-bottom: 0;
  }
  
  .header-right {
    width: 100%;
  }
  
  .header-right .el-button-group {
    display: flex;
    width: 100%;
    gap: 4px;
  }
  
  .header-right .el-button {
    flex: 1;
    padding: 8px 4px;
    font-size: 12px;
    min-height: 36px;
  }
  
  .header-right .el-button .el-icon {
    font-size: 14px;
  }
  
  /* 优化按钮图标显示 */
  .header-right .el-button span {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .chart-container {
    min-height: 300px;
    margin: 8px;
    border-radius: 6px;
  }
  
  .tradingview-chart {
    min-height: 300px;
  }
  
  .chart-loading,
  .chart-error {
    padding: 30px 10px;
  }
  
  .loading-text {
    font-size: 14px;
  }
  
  .error-actions {
    flex-direction: column;
    gap: 8px;
  }
  
  .error-actions .el-button {
    width: 100%;
  }
}

/* 响应式设计 - 超小屏幕 (360px以下) */
@media (max-width: 360px) {
  .chart-controls {
    padding: 8px 10px;
    gap: 8px;
  }
  
  .controls-left .el-select {
    font-size: 12px;
  }
  
  .header-right .el-button {
    padding: 6px 3px;
    font-size: 11px;
    min-height: 32px;
  }
  
  .header-right .el-button .el-icon {
    font-size: 12px;
  }
  
  .symbol-badge {
    font-size: 11px;
    padding: 2px 6px;
  }
  
  .chart-container {
    margin: 6px;
    min-height: 280px;
  }
  
  .tradingview-chart {
    min-height: 280px;
  }
}
</style>
