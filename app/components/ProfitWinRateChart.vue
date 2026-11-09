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
      <el-radio-group v-model="chartType" size="small" class="filter-item">
        <el-radio-button value="pnl">盈亏</el-radio-button>
        <el-radio-button value="winRate">胜率</el-radio-button>
      </el-radio-group>
      <el-select v-model="selectedPeriod" size="small" class="filter-item" aria-label="收益分析时间范围">
        <el-option label="全部" value="all" />
        <el-option label="今日" value="today" />
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
      <div class="stat-item">
        <div class="stat-label" title="当前筛选范围内已平仓交易的净盈亏合计 ÷ 交易次数，已包含结算费用">单均盈亏</div>
        <div :class="['stat-value', stats.averagePnl >= 0 ? 'text-success' : 'text-danger']">
          {{ stats.averagePnl >= 0 ? '+' : '' }}{{ stats.averagePnl.toFixed(2) }} U
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="按平仓时间筛选，统计入选交易的完整持仓时长；缺失或异常时间不参与平均">平均持仓</div>
        <div class="stat-value">{{ stats.validHoldCount ? formatHoldDuration(stats.averageHoldDurationMs) : '—' }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="当前筛选结果按平仓时间排序后的最长连续盈利笔数，亏损或保本交易中断连续统计">最长连盈</div>
        <div :class="['stat-value', { 'text-success': stats.maxConsecutiveWins > 0 }]">{{ stats.maxConsecutiveWins }} 笔</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="当前筛选结果按平仓时间排序后的最长连续亏损笔数，盈利或保本交易中断连续统计">最长连亏</div>
        <div :class="['stat-value', { 'text-danger': stats.maxConsecutiveLosses > 0 }]">{{ stats.maxConsecutiveLosses }} 笔</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="当前筛选范围内单笔已结算净盈利的最大值，无盈利交易时为 0">最大盈利</div>
        <div class="stat-value text-success">{{ stats.maxTradeProfit.toFixed(2) }} U</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="当前筛选范围内单笔已结算净亏损的最大绝对值，无亏损交易时为 0">最大亏损</div>
        <div class="stat-value text-danger">{{ stats.maxTradeLoss.toFixed(2) }} U</div>
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
import { getChartTooltipTheme } from '../utils/chart-tooltip-theme'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const strategiesStore = useStrategiesStore()

const chartRef = ref<HTMLElement | null>(null)
let chartResizeObserver: ResizeObserver | undefined
const loading = ref(false)
const selectedStrategy = ref('')
const selectedSymbol = ref('')
const selectedPeriod = ref<'all' | 'today' | 'yesterday' | '7days' | '30days' | 'month'>('today')
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
  maxDrawdown: 0,
  averagePnl: 0,
  averageHoldDurationMs: 0,
  validHoldCount: 0,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
  maxTradeProfit: 0,
  maxTradeLoss: 0
})
const { theme } = useTheme()
let chartInstance: ECharts | null = null
let summaryRequestId = 0

/** 小时最多保留一位小数并省略末尾 .0；短线持仓保留分钟，避免显示为 0h。 */
const formatHoldDuration = (durationMs: number) => {
  if (durationMs < 60_000) return '<1m'
  if (durationMs >= 3_600_000) return `${Number((durationMs / 3_600_000).toFixed(1))}h`
  return `${Math.floor(durationMs / 60_000)}m`
}

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

/** 加载当前筛选结果；仅首次加载允许在今日无成交时回退昨日，保留后续手动选择。 */
const loadData = async ({ fallbackToYesterday = false } = {}) => {
  const requestId = ++summaryRequestId
  loading.value = true
  try {
    const response = await $fetch('/api/bot/history-summary', {
      params: {
        strategyId: selectedStrategy.value || undefined,
        symbol: selectedSymbol.value || undefined,
        ...getPeriodParams(),
      },
    }) as any
    // 快速切换筛选或刷新时，只允许最新请求更新曲线、统计和选项。
    if (requestId !== summaryRequestId) return
    // 以有无已平仓交易判断，零收益也属于有数据；请求失败不能误判为今日无成交。
    if (fallbackToYesterday && selectedPeriod.value === 'today' && response.success && response.data?.length === 0) {
      selectedPeriod.value = 'yesterday'
      // 由筛选监听统一加载昨日，避免重复请求；昨日也无数据时显示空状态。
      return
    }
    chartData.value = response.success ? response.data || [] : []
    if (response.stats) stats.value = response.stats

    // 汇总足以绘图；先等 v-show 更新容器，再绘制，避免初始化时高度为零。
    await nextTick()
    renderChart()

    // 下拉选项由全量历史的服务端元数据提供，不下载完整订单。
    if (strategiesStore.strategies.length === 0) await strategiesStore.loadStrategies()
    if (requestId !== summaryRequestId) return
    const strategySet = new Set<string>(response.options?.strategies || [])
    strategies.value = strategiesStore.strategies.filter(s => strategySet.has(s.id))
    symbols.value = response.options?.symbols || []

  } catch (error) {
    console.error('加载历史数据失败:', error)
  } finally {
    if (requestId === summaryRequestId) loading.value = false
  }
}

// 强制刷新
const refreshData = async () => {
  await loadData()
}

/** 按当前指标重绘最新筛选结果，切换指标时重置坐标范围和曲线配置。 */
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
      ...getChartTooltipTheme(chartRef.value),
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
      axisLine: {
        lineStyle: { color: theme.value === 'dark' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.18)' }
      },
      axisTick: { show: false },
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
      // 网格仅用于辅助读数，降低明暗主题下的对比度，避免抢占收益曲线的视觉焦点。
      splitLine: {
        lineStyle: {
          color: theme.value === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
          width: 1
        }
      },
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
        // 隐藏常驻采样圆点，避免日内数据密集时遮挡走势；悬停仍可查看数值。
        showSymbol: false,
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

  // 盈亏与胜率的量纲、范围不同，完整替换配置，避免沿用上个指标的状态。
  chartInstance.setOption(option, { notMerge: true })
}

// 监听筛选变化
watch([selectedStrategy, selectedSymbol, selectedPeriod], () => {
  void loadData()
})

// 指标和主题变化都从当前筛选结果重绘，不依赖单选组件的 change 事件时序。
watch([chartType, theme], () => {
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
  await loadData({ fallbackToYesterday: true })
  
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  // 离开页面后忽略尚未返回的汇总请求，避免重新创建已销毁的图表。
  summaryRequestId++
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
  height: 204px;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  /* 统计区增加 24px 用于每格上下留白，走势图等量缩减，保持组件整体高度。 */
  height: 134px;
  box-sizing: border-box;
  margin-top: 18px;
  border: 1px solid var(--el-border-color-lighter);
}

/* 共用连续网格线，去掉独立卡片背景、圆角和间隙；上下排版适配四列宽度。 */
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  padding: 4px 2px;
  border-right: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.stat-item:nth-child(4n) {
  border-right: 0;
}

.stat-item:nth-last-child(-n + 4) {
  border-bottom: 0;
}

.stat-label {
  max-width: 100%;
  font-size: 11px;
  line-height: 14px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.stat-value {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

</style>
