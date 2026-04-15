<template>
  <el-card class="card" shadow="hover">
    <template #header>
      <div class="card-header">
        <span>📈 {{ chartTitle }}</span>
        <div class="header-actions">
          <el-radio-group v-model="chartMode" size="small" style="margin-right: 10px">
            <el-radio-button value="pnl">盈亏</el-radio-button>
            <el-radio-button value="winrate">胜率</el-radio-button>
          </el-radio-group>
          <el-select
            v-model="selectedSymbol"
            placeholder="选择交易对"
            size="small"
            style="width: 100px; margin-right: 10px"
            clearable
          >
            <el-option label="全部交易对" value="" />
            <el-option
              v-for="symbol in availableSymbols"
              :key="symbol"
              :label="symbol"
              :value="symbol"
            />
          </el-select>
          <el-button text type="primary" @click="refreshData">
            <el-icon><ElIconRefresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>
    </template>

    <div v-if="hasData" class="chart-container">
      <div ref="chartRef" style="height: 255px; width: 100%"></div>
    </div>
    <el-empty v-else description="暂无交易数据，无法生成走势图" />

    <!-- 统计摘要 -->
    <div v-if="hasData" class="stats-summary">
      <el-row :gutter="20">
        <el-col :span="6">
          <div class="stat-box">
            <span class="stat-label">交易次数</span>
            <span class="stat-value">{{ totalTrades }}</span>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-box">
            <span class="stat-label">累计盈亏</span>
            <span :class="['stat-value', totalPnL >= 0 ? 'text-success' : 'text-danger']">
              {{ totalPnL >= 0 ? '+' : '' }}{{ totalPnL.toFixed(2) }} U
            </span>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-box">
            <span class="stat-label">总胜率</span>
            <span class="stat-value">{{ overallWinRate.toFixed(1) }}%</span>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-box">
            <span class="stat-label">平均盈亏</span>
            <span :class="['stat-value', averagePnL >= 0 ? 'text-success' : 'text-danger']">
              {{ averagePnL >= 0 ? '+' : '' }}{{ averagePnL.toFixed(2) }} U
            </span>
          </div>
        </el-col>
      </el-row>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'
import type { EChartsOption } from 'echarts'
import { ElMessage } from 'element-plus'
import type { TradeHistory, HistoryResponse } from '../../types'

const botStore = useBotStore()

// 独立的历史记录状态，用于图表显示
const chartHistory = ref<TradeHistory[]>([])

// 独立获取图表数据
async function fetchChartHistory() {
  try {
    const response = await $fetch<HistoryResponse>('/api/bot/history', {
      query: { page: 1, pageSize: 1000 }
    })
    if (response.success && response.data) {
      chartHistory.value = response.data
    }
  } catch (error) {
    console.error('获取图表数据失败:', error)
    ElMessage.error('获取图表数据失败')
  }
}

// 图表引用和实例
const chartRef = ref<HTMLDivElement>()
let chartInstance: any = null

// 图表模式：pnl=总盈亏，winrate=胜率
const chartMode = ref<'pnl' | 'winrate'>('pnl')

// 选中的交易对
const selectedSymbol = ref('')

// 可用的交易对列表
const availableSymbols = computed(() => {
  if (!chartHistory.value || chartHistory.value.length === 0) return []
  const symbols = new Set<string>()
  chartHistory.value.forEach(trade => {
    symbols.add(trade.symbol)
  })
  return Array.from(symbols).sort()
})

// 图表标题
const chartTitle = computed(() => {
  return chartMode.value === 'pnl' ? '盈亏走势' : '胜率走势'
})

// 是否有数据
const hasData = computed(() => chartHistory.value && chartHistory.value.length > 0)

// 总交易次数（基于筛选后的数据）
const totalTrades = computed(() => sortedHistory.value.length)

// 按时间排序的交易历史（从早到晚），根据选中的交易对筛选
const sortedHistory = computed(() => {
  if (!chartHistory.value || chartHistory.value.length === 0) return []
  
  let filteredHistory = [...chartHistory.value]
  
  // 根据选中的交易对进行筛选
  if (selectedSymbol.value) {
    filteredHistory = filteredHistory.filter(trade => trade.symbol === selectedSymbol.value)
  }
  
  return filteredHistory.sort((a, b) => a.closeTime - b.closeTime)
})

// 计算累计盈亏数据
const cumulativePnLData = computed(() => {
  let cumulative = 0
  return sortedHistory.value.map(trade => {
    cumulative += trade.pnl
    return {
      time: trade.closeTime,
      value: cumulative,
      symbol: trade.symbol,
      pnl: trade.pnl
    }
  })
})

// 计算胜率数据（使用所有历史记录）
const winRateData = computed(() => {
  const history = sortedHistory.value
  
  return history.map((trade, index) => {
    // 获取当前及之前的所有交易
    const allTrades = history.slice(0, index + 1)
    
    // 计算累计胜率
    const wins = allTrades.filter(t => t.pnl > 0).length
    const winRate = (wins / allTrades.length) * 100
    
    return {
      time: trade.closeTime,
      value: winRate,
      totalTrades: allTrades.length
    }
  })
})

// 总盈亏
const totalPnL = computed(() => {
  if (cumulativePnLData.value.length === 0) return 0
  const lastItem = cumulativePnLData.value[cumulativePnLData.value.length - 1]
  return lastItem?.value ?? 0
})

// 总胜率（基于筛选后的数据）
const overallWinRate = computed(() => {
  if (sortedHistory.value.length === 0) return 0
  const wins = sortedHistory.value.filter(t => t.pnl > 0).length
  return (wins / sortedHistory.value.length) * 100
})

// 平均盈亏
const averagePnL = computed(() => {
  if (sortedHistory.value.length === 0) return 0
  const total = sortedHistory.value.reduce((sum, trade) => sum + trade.pnl, 0)
  return total / sortedHistory.value.length
})

// 图表配置
const chartOption = computed<EChartsOption>(() => {
  const pnlValues = cumulativePnLData.value.map(d => d.value)
  const winRateValues = winRateData.value.map(d => d.value)
  
  // 分离盈利和亏损数据
  const positiveData = pnlValues.map((value, index) => value >= 0 ? value : 0)
  const negativeData = pnlValues.map((value, index) => value < 0 ? value : 0)

  // 根据数据量动态调整X轴显示
  const dataCount = cumulativePnLData.value.length
  let xAxisConfig: any = {
    type: 'category',
    boundaryGap: false,
    axisLabel: {
      rotate: 45,
      fontSize: 10
    }
  }

  // 根据数据量调整X轴显示策略
  if (dataCount <= 10) {
    // 数据量少，显示所有时间点
    xAxisConfig.data = cumulativePnLData.value.map(d => dayjs(d.time).format('MM/DD HH:mm'))
  } else if (dataCount <= 30) {
    // 数据量中等，显示部分时间点
    xAxisConfig.data = cumulativePnLData.value.map((d, index) => {
      // 每3个点显示一个，或者首尾和中间点
      if (index === 0 || index === dataCount - 1 || index % 3 === 0) {
        return dayjs(d.time).format('MM/DD HH:mm')
      }
      return ''
    })
  } else {
    // 数据量多，显示简化时间
    xAxisConfig.data = cumulativePnLData.value.map((d, index) => {
      // 显示首尾和每10个点
      if (index === 0 || index === dataCount - 1 || index % 10 === 0) {
        return dayjs(d.time).format('MM/DD')
      }
      return ''
    })
  }

  // 根据模式构建不同的图表配置
  if (chartMode.value === 'pnl') {
    // 总盈亏模式
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          const dataIndex = params[0]?.dataIndex
          if (dataIndex === undefined || dataIndex < 0) return ''
          
          const trade = sortedHistory.value[dataIndex]
          const pnlData = cumulativePnLData.value[dataIndex]
          
          if (!trade || !pnlData) return ''
          
          let html = `<div style="font-weight: bold; margin-bottom: 5px">${dayjs(trade.closeTime).format('YYYY-MM-DD HH:mm')}</div>`
          html += `<div>交易对: ${trade.symbol}</div>`
          html += `<div>方向: ${trade.direction}</div>`
          html += `<div style="color: ${trade.pnl >= 0 ? '#67c23a' : '#f56c6c'}">本次盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} U</div>`
          html += `<div style="color: ${pnlData.value >= 0 ? '#67c23a' : '#f56c6c'}">累计盈亏: ${pnlData.value >= 0 ? '+' : ''}${pnlData.value.toFixed(2)} U</div>`
          
          return html
        }
      },
      legend: {
        data: ['累计盈亏', '盈利区域', '亏损区域'],
        top: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '40px',
        containLabel: true
      },
      xAxis: xAxisConfig,
      yAxis: {
        type: 'value',
        name: '盈亏(U)',
        position: 'left',
        axisLine: {
          show: true,
          lineStyle: {
            color: '#67c23a'
          }
        },
        axisLabel: {
          formatter: '{value}'
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        }
      },
      series: [
        {
          name: '盈利区域',
          type: 'line',
          data: positiveData,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 0
          },
          itemStyle: {
            color: '#67c23a'
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(103, 194, 58, 0.5)' },
                { offset: 1, color: 'rgba(103, 194, 58, 0.05)' }
              ]
            }
          },
          stack: undefined,
          showSymbol: false
        },
        {
          name: '亏损区域',
          type: 'line',
          data: negativeData,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 0
          },
          itemStyle: {
            color: '#f56c6c'
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(245, 182, 182, 0.05)' },
                { offset: 1, color: 'rgba(245, 85, 85, 0.5)' }
              ]
            }
          },
          stack: undefined,
          showSymbol: false
        },
        {
          name: '累计盈亏',
          type: 'line',
          data: pnlValues,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            width: 2,
            color: '#67c23a'
          },
          itemStyle: {
            color: '#67c23a'
          }
        }
      ]
    }
  } else {
    // 胜率模式
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          const dataIndex = params[0]?.dataIndex
          if (dataIndex === undefined || dataIndex < 0) return ''
          
          const trade = sortedHistory.value[dataIndex]
          const rateData = winRateData.value[dataIndex]
          
          if (!trade || !rateData) return ''
          
          let html = `<div style="font-weight: bold; margin-bottom: 5px">${dayjs(trade.closeTime).format('YYYY-MM-DD HH:mm')}</div>`
          html += `<div>交易对: ${trade.symbol}</div>`
          html += `<div>方向: ${trade.direction}</div>`
          html += `<div style="color: ${trade.pnl >= 0 ? '#67c23a' : '#f56c6c'}">本次盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} U</div>`
          html += `<div style="color: #409eff">累计胜率(${rateData.totalTrades}笔): ${rateData.value.toFixed(1)}%</div>`
          
          return html
        }
      },
      legend: {
        data: ['累计胜率'],
        top: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '40px',
        containLabel: true
      },
      xAxis: xAxisConfig,
      yAxis: {
        type: 'value',
        name: '胜率(%)',
        position: 'left',
        min: 0,
        max: 100,
        axisLine: {
          show: true,
          lineStyle: {
            color: '#409eff'
          }
        },
        axisLabel: {
          formatter: '{value}%'
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        }
      },
      series: [
        {
          name: '累计胜率',
          type: 'line',
          data: winRateValues,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          lineStyle: {
            width: 2,
            color: '#409eff'
          },
          itemStyle: {
            color: '#409eff'
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(64, 158, 255, 0.3)' },
                { offset: 1, color: 'rgba(64, 158, 255, 0.05)' }
              ]
            }
          }
        }
      ]
    }
  }
})

// 刷新数据
async function refreshData() {
  await fetchChartHistory()
  ElMessage.success('图表数据已刷新')
}

// 初始化图表
async function initChart() {
  if (!chartRef.value || !hasData.value) return
  
  try {
    // 动态导入echarts
    const echarts = await import('echarts')
    
    // 销毁现有图表实例
    if (chartInstance) {
      chartInstance.dispose()
      chartInstance = null
    }
    
    // 创建新的图表实例
    chartInstance = echarts.init(chartRef.value)
    
    // 设置图表选项
    chartInstance.setOption(chartOption.value)
    
    // 监听窗口大小变化
    const handleResize = () => {
      if (chartInstance) {
        chartInstance.resize()
      }
    }
    
    window.addEventListener('resize', handleResize)
    
    // 返回清理函数
    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartInstance) {
        chartInstance.dispose()
        chartInstance = null
      }
    }
  } catch (error) {
    console.error('初始化图表失败:', error)
  }
}

// 更新图表
function updateChart() {
  if (chartInstance && chartOption.value) {
    // 清除之前的图表配置，然后重新设置
    chartInstance.clear()
    chartInstance.setOption(chartOption.value)
  }
}

// 监听数据变化
watch(chartHistory, () => {
  if (hasData.value) {
    initChart()
  }
}, { deep: true })

// 监听图表模式变化
watch(chartMode, () => {
  updateChart()
})

// 监听交易对筛选变化
watch(selectedSymbol, () => {
  updateChart()
})

// 监听图表配置变化
watch(chartOption, () => {
  updateChart()
})

// 组件挂载时确保有数据并初始化图表
onMounted(async () => {
  // 获取图表数据
  await fetchChartHistory()
  
  // 延迟初始化图表，确保DOM已渲染
  setTimeout(() => {
    if (hasData.value) {
      initChart()
    }
  }, 100)
})

// 组件卸载时清理
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})
</script>

<style scoped>

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
}

.chart-container {
  width: 100%;
  min-height: 255px;
}

.stats-summary {
  margin-top: -6px;
  border-top: 1px solid #ebeef5;
}

.stat-box {
  text-align: center;
  padding: 10px;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-bottom: 5px;
}

.stat-value {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.text-success {
  color: #67c23a;
}

.text-danger {
  color: #f56c6c;
}

@media (max-width: 768px) {
  .header-actions {
    flex-direction: column;
    gap: 8px;
  }
  
  .stat-box {
    padding: 5px;
  }
  
  .stat-value {
    font-size: 14px;
  }
}
</style>