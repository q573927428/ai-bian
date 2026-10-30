<!-- ==================== 当前合约相对 BTC、ETH 的同期表现 ==================== -->
<template>
  <section class="relative-card" v-loading="loading">
    <header><strong>{{ title }}</strong><span>{{ timeframe }} · 起点 = 100</span></header>
    <div v-if="error" class="error" role="status">{{ error }}</div>
    <div ref="canvas" class="relative-chart" :aria-label="title + '，同期归一化比较'" />
    <div class="description">{{ description }}</div>
  </section>
</template>
<script setup lang="ts">
import * as echarts from 'echarts'
import type { KLineApiResponse } from '../../types/kline-simple'

/** 周期随上方主图切换；仅比较本地已有的合约收盘价。 */
interface Props { symbol: string; timeframe: string }
const props = defineProps<Props>()
const canvas = ref<HTMLDivElement>()
const loading = ref(false)
const error = ref('')
const description = ref('')
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
let timer: ReturnType<typeof setInterval> | undefined
let version = 0
let disposed = false
const normalize = (symbol: string) => symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
// 当前市场本身是基准时只与另一基准比较，标题与实际曲线保持一致。
const title = computed(() => normalize(props.symbol) === 'BTCUSDT' ? 'BTC 相对 ETH 表现'
  : normalize(props.symbol) === 'ETHUSDT' ? 'ETH 相对 BTC 表现' : '相对 BTC / ETH 表现')
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`
const date = (time: number) => new Date(time * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** 对齐所有可用市场的共同首尾时刻，内部缺口留空，不插值或用不同时间比较收益。 */
async function load() {
  const request = ++version
  loading.value = true
  error.value = ''
  try {
    const symbols = [...new Set([normalize(props.symbol), 'BTCUSDT', 'ETHUSDT'])]
    const step = ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as Record<string, number>)[props.timeframe] || 3600
    const now = Date.now() / 1000
    const results = await Promise.allSettled(symbols.map(symbol => $fetch<KLineApiResponse>('/api/kline-simple', { query: { symbol, timeframe: props.timeframe } })))
    if (disposed || request !== version) return
    const markets = results.flatMap((result, index) => {
      if (result.status !== 'fulfilled' || !result.value.success) return []
      const bars = result.value.data?.data?.filter(bar => bar.t + step <= now && Number.isFinite(bar.c) && bar.c > 0) || []
      return bars.length ? [{ symbol: symbols[index]!, prices: new Map(bars.map(bar => [bar.t, bar.c])) }] : []
    })
    const current = markets.find(market => market.symbol === symbols[0])
    if (!current || markets.length < 2) throw new Error('当前交易对或基准行情不足，暂无法比较')
    const common = [...current.prices.keys()].filter(time => markets.every(market => market.prices.has(time))).sort((a, b) => a - b)
    const end = common.at(-1)
    if (end == null) throw new Error('没有共同时间点，暂无法比较')
    // 默认比较最近80根的共同有效窗口，较晚上市或缺少历史时缩短范围。
    const start = common.find(time => time >= end - 79 * step)
    if (start == null || start === end) throw new Error('共同历史不足两根，暂无法比较')
    const times = Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => start + i * step)
    const returns = markets.map(market => ({ symbol: market.symbol, value: (market.prices.get(end)! / market.prices.get(start)! - 1) * 100 }))
    const ownReturn = returns.find(market => market.symbol === symbols[0])!.value
    const missing = symbols.filter(symbol => !markets.some(market => market.symbol === symbol))
    const stale = now - end - step > step * 2
    error.value = [missing.length ? `${missing.join('、')} 暂无本地行情` : '', stale ? '共同行情较旧，当前显示历史比较' : ''].filter(Boolean).join('；')
    // 按显示的起止边界计算时长；短周期保留分钟，避免不足一小时被显示成零小时。
    const totalMinutes = Math.floor((end + step - start) / 60)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor(totalMinutes % 1440 / 60)
    const minutes = totalMinutes % 60
    const duration = `${days}天${hours}小时${minutes ? `${minutes}分钟` : ''}`
    description.value = `${date(start)} — ${date(end + step)}（已收盘，共${duration}）\n${symbols[0]} ${signed(ownReturn)}%；${returns.filter(market => market.symbol !== symbols[0]).map(market => `${ownReturn >= market.value ? '跑赢' : '跑输'} ${market.symbol.replace('USDT', '')} ${Math.abs(ownReturn - market.value).toFixed(2)}%`).join('，')}。`
    if (!canvas.value) return
    chart ||= echarts.init(canvas.value, undefined, { renderer: 'svg' })
    const color = getComputedStyle(canvas.value).getPropertyValue('--el-text-color-secondary').trim() || '#909399'
    chart.setOption({
      animation: false,
      grid: { left: 43, right: 78, top: 36, bottom: 25 },
      legend: { top: 0, textStyle: { color, fontSize: 10 }, itemWidth: 14, data: returns.map(market => `${market.symbol} ${signed(market.value)}%`) },
      tooltip: { trigger: 'axis', confine: true, padding: [5, 7], borderWidth: 1,
        textStyle: { fontSize: 10, lineHeight: 15 },
        extraCssText: 'background:var(--el-bg-color-overlay)!important;color:var(--el-text-color-primary)!important;border-color:var(--el-border-color)!important;box-shadow:0 2px 8px rgba(0,0,0,.15);line-height:15px;',
        // 仅显示悬停时刻的收益，不重复图例中的区间收益和归一化数值。
        formatter: (params: any) => {
          const entries = Array.isArray(params) ? params : [params]
          return [entries[0]?.axisValueLabel || '', ...entries.map((entry: any) => {
            const symbol = markets[entry.seriesIndex]?.symbol || ''
            const value = typeof entry.value === 'number' ? `${signed(entry.value - 100)}%` : '--'
            return `<span style="color:${entry.color}">●</span> ${symbol}　${value}`
          })].join('<br>')
        }
      },
      xAxis: { type: 'category', boundaryGap: false, data: times.map(date), axisLabel: { color, fontSize: 9, hideOverlap: true }, axisTick: { show: false } },
      yAxis: { type: 'value', scale: true, axisLabel: { color, fontSize: 9 }, splitLine: { lineStyle: { color, opacity: .12 } } },
      series: markets.map((market, i) => ({ name: `${market.symbol} ${signed(returns[i]!.value)}%`, type: 'line', showSymbol: false, connectNulls: false,
        endLabel: { show: true, formatter: `${signed(returns[i]!.value)}%`, fontSize: 12, fontWeight: 600, distance: 8,
          color: market.symbol === 'BTCUSDT' ? '#e6a23c' : market.symbol === 'ETHUSDT' ? '#9b8afb' : '#409eff',
          textBorderWidth: 0, textShadowBlur: 0 },
        labelLayout: { moveOverlap: 'shiftY' },
        data: times.map(time => market.prices.has(time) ? market.prices.get(time)! / market.prices.get(start)! * 100 : null),
        lineStyle: { width: market.symbol === symbols[0] ? 2 : 1.3 }, itemStyle: { color: market.symbol === 'BTCUSDT' ? '#e6a23c' : market.symbol === 'ETHUSDT' ? '#9b8afb' : '#409eff' }
      }))
    } as echarts.EChartsOption, true)
  } catch (reason) {
    if (!disposed && request === version) { chart?.clear(); description.value = ''; error.value = reason instanceof Error ? reason.message : '相对表现加载失败' }
  } finally { if (!disposed && request === version) loading.value = false }
}
watch(() => [props.symbol, props.timeframe], () => { chart?.clear(); description.value = ''; void load() })
onMounted(() => {
  observer = new ResizeObserver(() => chart?.resize())
  if (canvas.value) observer.observe(canvas.value)
  void load()
  timer = setInterval(() => { if (!loading.value) void load() }, 30_000)
})
onBeforeUnmount(() => { disposed = true; version++; if (timer) clearInterval(timer); observer?.disconnect(); chart?.dispose() })
</script>
<style scoped>
.relative-card { display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--bg-card, var(--el-bg-color)); }
header { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
header span, .description { color: var(--el-text-color-secondary); font-size: 10px; }
.relative-chart { flex: 1; min-height: 0; margin-top: 8px; }
.description { white-space: pre-line; flex-shrink: 0; line-height: 1.6; }
.error { font-size: 11px; color: var(--el-color-warning); }
</style>
