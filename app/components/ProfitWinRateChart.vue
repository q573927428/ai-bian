<template>
  <el-card class="chart-card">
    <template #header>
      <div class="card-header">
        <span>📈 盈亏走势</span>
        <el-button type="primary" size="small" text :loading="loading" @click="refreshData">
          <el-icon><ElIconRefresh /></el-icon>
          刷新
        </el-button>
      </div>
    </template>

    <!-- 筛选器 -->
    <div class="filters">
      <el-radio-group v-model="chartType" size="small" @change="renderChart" class="filter-item">
        <el-radio-button value="pnl">盈亏</el-radio-button>
        <el-radio-button value="winRate">胜率</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="selectedPeriod" size="small" class="filter-item">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="today">当日</el-radio-button>
      </el-radio-group>
      
      <el-select v-model="selectedStrategy" placeholder="选择策略" clearable size="small" class="filter-item">
        <el-option label="全部策略" value="" />
        <el-option
          v-for="strategy in strategies"
          :key="strategy.id"
          :label="strategy.name"
          :value="strategy.id"
        />
      </el-select>

      <el-select v-model="selectedSymbol" placeholder="选择交易对" clearable size="small" class="filter-item">
        <el-option label="全部交易对" value="" />
        <el-option
          v-for="symbol in symbols"
          :key="symbol"
          :label="symbol"
          :value="symbol"
        />
      </el-select>

    </div>

    <!-- 图表容器 -->
    <!-- 无数据时只显示空状态，避免空图表和空状态重复占用高度。 -->
    <div v-show="chartData.length > 0" ref="chartRef" class="chart-container"></div>

    <!-- 统计数据 -->
    <div v-if="chartData.length > 0" class="stats-container">
      <div class="stat-item">
        <div class="stat-label">交易次数</div>
        <div class="stat-value">{{ stats.totalTrades }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">累计盈亏</div>
        <div :class="['stat-value', stats.totalPnl >= 0 ? 'text-success' : 'text-danger']">
          {{ stats.totalPnl >= 0 ? '+' : '' }}{{ stats.totalPnl.toFixed(2) }} U
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">总胜率</div>
        <div class="stat-value">{{ stats.winRate.toFixed(2) }}%</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">总手续费</div>
        <div class="stat-value">{{ stats.totalFee.toFixed(2) }} U</div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && chartData.length === 0" class="empty-state">
      <el-icon class="empty-icon"><ElIconDataAnalysis /></el-icon>
      <span>暂无数据</span>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { LineChart } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { graphic, init, use, type ECharts } from 'echarts/core'
import { useStrategiesStore } from '../stores/strategies'
import { useTradeHistoryStore } from '../stores/tradeHistory'
import { useTheme } from '../composables/useTheme'

use([LineChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer])

const strategiesStore = useStrategiesStore()
const tradeHistoryStore = useTradeHistoryStore()

const chartRef = ref<HTMLElement | null>(null)
let chartResizeObserver: ResizeObserver | undefined
const loading = ref(false)
const selectedStrategy = ref('')
const selectedSymbol = ref('')
const selectedPeriod = ref<'all' | 'today'>('all')
const chartType = ref<'pnl' | 'winRate'>('pnl')
const strategies = ref<any[]>([])
const symbols = ref<string[]>([])
const chartData = ref<any[]>([])
const stats = ref({
  totalTrades: 0,
  totalPnl: 0,
  winRate: 0,
  totalFee: 0
})
const { theme } = useTheme()
let chartInstance: ECharts | null = null

/** 使用浏览器本地自然日边界，确保服务端时区不会改变“当日”的范围。 */
const getPeriodParams = () => {
  if (selectedPeriod.value !== 'today') return {}
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    startTime: start.getTime(),
    endTime: end.getTime(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

// 加载历史数据
const loadData = async (force = false) => {
  loading.value = true
  try {
    const response = await $fetch('/api/bot/history-summary', {
      params: {
        strategyId: selectedStrategy.value || undefined,
        symbol: selectedSymbol.value || undefined,
        ...getPeriodParams(),
      },
    }) as any
    chartData.value = response.success ? response.data || [] : []
    if (response.stats) stats.value = response.stats

    // 汇总足以绘图；先等 v-show 更新容器，再绘制，避免初始化时高度为零。
    await nextTick()
    renderChart()

    // 策略与完整历史仅用于筛选选项，放在首次绘图之后加载。
    await Promise.all([
      tradeHistoryStore.fetchAllHistory(force),
      strategiesStore.strategies.length === 0 ? strategiesStore.loadStrategies() : Promise.resolve(),
    ])
    const allHistory = tradeHistoryStore.allHistory

    const strategySet = new Set<string>()
    const symbolSet = new Set<string>()
    
    allHistory.forEach(trade => {
      if (trade.strategyId) strategySet.add(trade.strategyId)
      symbolSet.add(trade.symbol)
    })

    strategies.value = strategiesStore.strategies.filter(s => strategySet.has(s.id))
    symbols.value = Array.from(symbolSet).sort()

  } catch (error) {
    console.error('加载历史数据失败:', error)
  } finally {
    loading.value = false
  }
}

// 强制刷新
const refreshData = async () => {
  await loadData(true)
}

/** 根据筛选条件获取服务端汇总，避免在浏览器扫描完整订单。 */
const loadSummary = async () => {
  try {
    const response = await $fetch('/api/bot/history-summary', {
      params: {
        strategyId: selectedStrategy.value || undefined,
        symbol: selectedSymbol.value || undefined,
        ...getPeriodParams(),
      },
    }) as any
    chartData.value = response.success ? response.data || [] : []
    if (response.stats) stats.value = response.stats
    // 筛选从无数据切换为有数据时，同样需要等待容器恢复显示。
    await nextTick()
    renderChart()
  } catch (error) {
    console.error('加载盈亏汇总失败:', error)
  }
}

// 处理图表数据
const processChartData = () => {
  // 过滤数据
  let filteredData = [...tradeHistoryStore.allHistory]
  
  if (selectedStrategy.value) {
    filteredData = filteredData.filter(t => t.strategyId === selectedStrategy.value)
  }
  
  if (selectedSymbol.value) {
    filteredData = filteredData.filter(t => t.symbol === selectedSymbol.value)
  }

  // 按时间排序
  filteredData.sort((a, b) => a.closeTime - b.closeTime)

  // 计算累计盈亏和胜率
  let cumulativePnl = 0
  let winCount = 0
  let totalCount = 0
  let totalFee = 0

  filteredData.forEach(trade => {
    totalFee += trade.totalCommission || 0
  })

  // 按日期分组，保留每个日期最后一笔交易
  const dateMap = new Map()
  filteredData.forEach(trade => {
    cumulativePnl += trade.pnl
    totalCount++
    if (trade.pnl > 0) winCount++
    
    const date = formatChartTime(trade.closeTime)
    const winRate = totalCount > 0 ? (winCount / totalCount) * 100 : 0
    
    dateMap.set(date, {
      time: date,
      pnl: Number(cumulativePnl.toFixed(2)),
      winRate: Number(winRate.toFixed(2)),
      tradeCount: totalCount
    })
  })

  chartData.value = Array.from(dateMap.values())

  // 更新统计数据
  stats.value = {
    totalTrades: totalCount,
    totalPnl: cumulativePnl,
    winRate: totalCount > 0 ? (winCount / totalCount) * 100 : 0,
    totalFee: totalFee
  }

  renderChart()
}

// 格式化图表时间
const formatChartTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// 渲染图表
const renderChart = () => {
  if (!chartRef.value || chartData.value.length === 0) return

  if (!chartInstance) {
    chartInstance = init(chartRef.value)
  }

  const isPnl = chartType.value === 'pnl'
  const data = isPnl ? chartData.value.map(d => d.pnl) : chartData.value.map(d => d.winRate)
  const name = isPnl ? '累计盈亏' : '胜率'
  const color = isPnl ? '#10b981' : '#3b82f6'
  const yAxisName = isPnl ? '盈亏(USDT)' : '胜率(%)'

  // 面积包含零轴，用零轴在填充区域中的位置分色，跨零时保持明确的红绿边界。
  const minPnl = Math.min(0, ...data)
  const maxPnl = Math.max(0, ...data)
  const zeroOffset = maxPnl / (maxPnl - minPnl || 1)
  // 跨零折线使用硬切换渐变，让两个采样点之间的曲线也恰好在零轴处变色。
  const pnlLineColor = minPnl >= 0 ? '#10b981' : maxPnl <= 0 ? '#ef4444'
    : new graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: '#10b981' },
        { offset: zeroOffset, color: '#10b981' },
        { offset: zeroOffset, color: '#ef4444' },
        { offset: 1, color: '#ef4444' }
      ])
  const pnlAreaColor = new graphic.LinearGradient(0, 0, 0, 1,
    minPnl >= 0
      ? [
          { offset: 0, color: 'rgba(16, 185, 129, 0.65)' },
          { offset: 1, color: 'rgba(16, 185, 129, 0.18)' }
        ]
      : maxPnl <= 0
        ? [
            { offset: 0, color: 'rgba(239, 68, 68, 0.18)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.65)' }
          ]
        : [
            { offset: 0, color: 'rgba(16, 185, 129, 0.65)' },
            { offset: zeroOffset, color: 'rgba(16, 185, 129, 0.18)' },
            { offset: zeroOffset, color: 'rgba(239, 68, 68, 0.18)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.65)' }
          ])

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      },
      formatter: (params: any) => {
        if (!params || params.length === 0) return ''
        const dataIndex = params[0].dataIndex
        const item = chartData.value[dataIndex]
        if (!item) return ''
        return `${item.time}<br/>${name}: ${params[0].value}${isPnl ? ' USDT' : '%'}`
      }
    },
    title: {
      text: yAxisName,
      left: 'center',
      top: 0,
      textStyle: {
        fontSize: 13,
        color: theme.value === 'dark' ? '#C8C8C8' : '#606266'
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: chartData.value.map(d => d.time),
      axisLabel: {
        rotate: 45,
        fontSize: 10,
        color: theme.value === 'dark' ? '#B8B8B8' : '#333333'
      }
    },
    yAxis: {
      type: 'value',
      position: 'left',
      min: isPnl ? undefined : 0,
      max: isPnl ? undefined : 100,
      axisLabel: {
        formatter: isPnl ? '{value}' : '{value}%',
        color: theme.value === 'dark' ? '#B8B8B8' : '#333333'
      }
    },
    series: [
      {
        name: name,
        type: 'line',
        smooth: true,
        // 限制平滑曲线沿时间轴单调，避免插值超出数据范围导致零轴分色偏移。
        smoothMonotone: 'x',
        data: data,
        lineStyle: {
          color: isPnl ? pnlLineColor : color
        },
        itemStyle: {
          // 数据点按自身盈亏值着色，零值沿用盈利绿色。
          color: isPnl ? (params: { value: number }) => params.value < 0 ? '#ef4444' : '#10b981' : color
        },
        areaStyle: {
          origin: 0,
          color: isPnl ? pnlAreaColor : new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: isPnl ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)' },
            { offset: 1, color: isPnl ? 'rgba(16, 185, 129, 0.05)' : 'rgba(59, 130, 246, 0.05)' }
          ])
        }
      }
    ]
  }

  chartInstance.setOption(option)
}

// 监听筛选变化
watch([selectedStrategy, selectedSymbol, selectedPeriod], () => {
  void loadSummary()
})

// 监听主题变化，重新渲染图表以更新坐标轴颜色
watch(theme, () => {
  if (chartData.value.length > 0) {
    renderChart()
  }
})

// 窗口大小变化时重新调整图表
const handleResize = () => {
  chartInstance?.resize()
}

onMounted(async () => {
  // 左列使用剩余空间布局后，卡片变化也需要同步调整 ECharts 画布。
  if (chartRef.value) {
    chartResizeObserver = new ResizeObserver(handleResize)
    chartResizeObserver.observe(chartRef.value)
  }
  await loadData()
  
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  chartResizeObserver?.disconnect()
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})
</script>

<style scoped>
.chart-card {
  margin-bottom: 20px;
}

.card-header {
  font-weight: 600;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 15px;
}

.filter-item {
  flex: 1;
  min-width: 80px;
}

.chart-container {
  width: 100%;
  height: 228px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: var(--text-secondary);
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  color: var(--text-placeholder);
}

:deep(.filter-item .el-select) {
  width: 100%;
}

:deep(.filter-item .el-radio-group) {
  width: auto;
}

.stats-container {
  display: flex;
  justify-content: space-around;
  padding: 10px;
  background: var(--balance-card-bg);
  border: 1px solid var(--balance-card-border);
  border-radius: 8px;
}

.stat-item {
  background: var(--stat-card-bg);
  border: 1px solid var(--stat-card-border);
  border-radius: 10px;
  padding: 12px 15px;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}

.stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

/* 移动端：4项分成2列显示 */
@media (max-width: 640px) {
  .stats-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat-item {
    padding: 10px 12px;
  }

  .stat-value {
    font-size: 14px;
  }
}

</style>
