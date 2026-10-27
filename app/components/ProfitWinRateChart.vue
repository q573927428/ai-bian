<template>
  <el-card class="chart-card">
    <template #header>
      <div class="card-header">
        <span>📈 收益分析</span>
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
      <el-select v-model="selectedPeriod" size="small" class="filter-item" aria-label="收益分析时间范围">
        <el-option label="全部" value="all" />
        <el-option label="当日" value="today" />
        <el-option label="昨日" value="yesterday" />
        <el-option label="近7天" value="7days" />
        <el-option label="近30天" value="30days" />
        <el-option label="本月" value="month" />
      </el-select>
      
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
        <div class="stat-label" title="历史已平仓交易的净盈亏合计，已包含记录中结算的手续费和资金费">累计盈亏</div>
        <div :class="['stat-value', stats.totalPnl >= 0 ? 'text-success' : 'text-danger']">
          {{ stats.totalPnl >= 0 ? '+' : '' }}{{ stats.totalPnl.toFixed(2) }} U
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">总胜率</div>
        <div class="stat-value">{{ stats.winRate.toFixed(2) }}%</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="已计入累计盈亏的交易手续费，仅单独展示，不重复扣除">总手续费</div>
        <div class="stat-value">{{ stats.totalFee.toFixed(2) }} U</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="平均盈利 ÷ 平均亏损绝对值，按已结算净盈亏计算；保本交易不参与，仅有盈利时显示 ∞，无盈利时显示 0.00">盈亏比</div>
        <div class="stat-value">
          {{ stats.payoffRatio === null ? '∞' : stats.payoffRatio.toFixed(2) }}
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="按逐笔已结算净盈亏计算历史峰值到随后低点的最大跌幅，包含起始零收益">最大回撤</div>
        <div class="stat-value text-danger">{{ stats.maxDrawdown.toFixed(2) }} U</div>
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
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { graphic, init, use, type ECharts } from 'echarts/core'
import { useStrategiesStore } from '../stores/strategies'
import { useTheme } from '../composables/useTheme'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const strategiesStore = useStrategiesStore()

const chartRef = ref<HTMLElement | null>(null)
let chartResizeObserver: ResizeObserver | undefined
const loading = ref(false)
const selectedStrategy = ref('')
const selectedSymbol = ref('')
const selectedPeriod = ref<'all' | 'today' | 'yesterday' | '7days' | '30days' | 'month'>('all')
const chartType = ref<'pnl' | 'winRate'>('pnl')
const strategies = ref<any[]>([])
const symbols = ref<string[]>([])
const chartData = ref<any[]>([])
const stats = ref({
  totalTrades: 0,
  totalPnl: 0,
  winRate: 0,
  totalFee: 0,
  payoffRatio: 0 as number | null,
  maxDrawdown: 0
})
const { theme } = useTheme()
let chartInstance: ECharts | null = null

/** 按浏览器本地自然日筛选；最近 N 天包含今天，结束时间不包含次日零点。 */
const getPeriodParams = () => {
  if (selectedPeriod.value === 'all') return {}
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  if (selectedPeriod.value === 'yesterday') {
    end.setTime(start.getTime())
    start.setDate(start.getDate() - 1)
  } else if (selectedPeriod.value === '7days') {
    start.setDate(start.getDate() - 6)
  } else if (selectedPeriod.value === '30days') {
    start.setDate(start.getDate() - 29)
  } else if (selectedPeriod.value === 'month') {
    start.setDate(1)
  }
  return {
    startTime: start.getTime(),
    endTime: end.getTime(),
    granularity: selectedPeriod.value === 'today' || selectedPeriod.value === 'yesterday' ? 'minute' : 'day',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

// 加载历史数据
const loadData = async () => {
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

    // 下拉选项由全量历史的服务端元数据提供，不下载完整订单。
    if (strategiesStore.strategies.length === 0) await strategiesStore.loadStrategies()
    const strategySet = new Set<string>(response.options?.strategies || [])
    strategies.value = strategiesStore.strategies.filter(s => strategySet.has(s.id))
    symbols.value = response.options?.symbols || []

  } catch (error) {
    console.error('加载历史数据失败:', error)
  } finally {
    loading.value = false
  }
}

// 强制刷新
const refreshData = async () => {
  await loadData()
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
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      // 移除标题后只保留少量顶部间距，避免最高刻度文字贴边。
      top: 10,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: chartData.value.map(d => d.time),
      axisLabel: {
        rotate: 0,
        hideOverlap: true,
        // 每个标签预留约 55px；仅减少文字数量，保留全部交易数据点。
        interval: (index: number) => {
          const labelCount = Math.max(2, Math.floor((chartInstance!.getWidth() - 60) / 50))
          const step = Math.max(1, Math.ceil(chartData.value.length / labelCount))
          return index % step === 0
        },
        // 横轴简写为月/日，悬浮提示继续使用原始完整日期；日内时分不变。
        formatter: (value: string) => value.replace(/^\d{4}\//, ''),
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
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 12px;
  padding-top: 10px;
  margin-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

/* 用轻量卡片区分指标，保持横排和紧凑留白，将主要空间留给走势。 */
.stat-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 2px 6px;
  min-width: 0;
  padding: 6px 8px;
  background: var(--stat-card-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* 移动端统计分成2列显示。 */
@media (max-width: 640px) {
  .stats-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
}

</style>
