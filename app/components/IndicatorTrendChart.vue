<!-- ==================== 三周期行情、结构与条件趋势推演 ==================== -->
<template>
  <section class="trend-card" v-loading="loading">
    <header>
      <strong>{{ label }} · {{ selectedTimeframe }}</strong><span>{{ symbol }}</span>
      <div class="period-buttons" role="group" :aria-label="`${label}图表周期`">
        <button v-for="period in timeframes" :key="period" type="button" :class="{ active: selectedTimeframe === period }" :aria-pressed="selectedTimeframe === period" @click="selectedTimeframe = period">{{ period }}</button>
      </div>
      <el-button text size="small" @click="load">刷新</el-button>
    </header>
    <div class="direction" :style="{ color: score > .2 ? '#67c23a' : score < -.2 ? '#f56c6c' : '#e6a23c' }">{{ direction }} <small>{{ evidence }}</small></div>
    <div v-if="error" class="error" role="status">{{ error }} <button @click="load">重试</button></div>
    <div ref="canvas" class="chart" :aria-label="`${symbol} ${selectedTimeframe} K线及条件推演`" />
  </section>
</template>
<script setup lang="ts">
import * as echarts from 'echarts'
import type { SimpleKLineData, KLineApiResponse } from '../../types/kline-simple'
import type { SupportResistanceSnapshot } from '../../types/support-resistance'
import type { ChartViewport } from '../../types/chart-viewport'
import { calculateEMA } from '../utils/ema-calculator'
import { useBotStore } from '../stores/bot'
/** 同一交易对的一个观察周期，不随主表周期变化。 */
interface Props { symbol: string; timeframe: string; label: string; viewport?: ChartViewport }
const props = defineProps<Props>()
const emit = defineEmits<{ 'viewport-change': [viewport: ChartViewport] }>()
// 每张图独立保留所选周期，切换交易对时继续使用当前观察窗口。
const timeframes = ['5m', '15m', '1h', '4h', '1d']
const selectedTimeframe = ref(props.timeframe)
const botStore = useBotStore()
const canvas = ref<HTMLDivElement>()
const loading = ref(false)
const error = ref('')
const snapshot = ref<SupportResistanceSnapshot>()
const score = ref(0)
const evidence = ref('等待指标')
const direction = computed(() => evidence.value === '等待指标' ? '方向待确认' : score.value > .2 ? '偏多 ↗' : score.value < -.2 ? '偏空 ↘' : '震荡 / 分歧 →')
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
let timer: ReturnType<typeof setInterval> | undefined
let version = 0
let disposed = false
let axisLength = 0

/** 将用户缩放或平移转为距时间轴末端的根数偏移，供其他周期图复用。 */
function publishViewport() {
  if (!chart || axisLength < 2) return
  const zoom = (chart.getOption().dataZoom as { start?: number; end?: number }[] | undefined)?.[0]
  if (zoom?.start == null || zoom.end == null) return
  emit('viewport-change', {
    startOffset: (axisLength - 1) * (1 - zoom.start / 100),
    endOffset: (axisLength - 1) * (1 - zoom.end / 100)
  })
}

/** 静默同步防止三图相互重复广播；历史不足的图限制到自身可用范围。 */
function applyViewport() {
  if (!chart || !props.viewport || axisLength < 2 || !(chart.getOption().dataZoom as unknown[] | undefined)?.length) return
  const last = axisLength - 1
  chart.dispatchAction({
    type: 'dataZoom', dataZoomIndex: 0,
    startValue: Math.max(0, last - props.viewport.startOffset),
    endValue: Math.max(0, last - props.viewport.endOffset)
  }, { silent: true })
}

/** 只让当前交易对的最新请求落图；指标失败时保留真实K线，但不生成推演。 */
async function load() {
  const current = ++version
  loading.value = true
  error.value = ''
  snapshot.value = undefined
  evidence.value = '等待指标'
  chart?.clear()
  try {
    const periods = botStore.botConfig?.emaPeriods?.slice(0, 2) || [20, 60]
    const [candles, diagnostics] = await Promise.allSettled([
      $fetch<KLineApiResponse>('/api/kline-simple', { query: { symbol: props.symbol, timeframe: selectedTimeframe.value, limit: 160 } }),
      $fetch<any>('/api/bot/indicators', { query: { symbol: props.symbol, timeframe: selectedTimeframe.value, emaPeriods: periods.join(','), includeSlowStats: 'false' } })
    ])
    if (disposed || current !== version) return
    if (candles.status !== 'fulfilled' || !candles.value.success) throw new Error('K线加载失败')
    const bars = candles.value.data?.data || []
    if (!bars.length) throw new Error('暂无该周期 K 线数据')
    const data = diagnostics.status === 'fulfilled' && diagnostics.value.success ? diagnostics.value.data : undefined
    snapshot.value = data?.indicators?.supportResistance?.values
    draw(bars, data, periods)
    if (!data) error.value = '指标暂不可用，暂不绘制推演'
  } catch (reason) {
    if (current === version && !disposed) error.value = reason instanceof Error ? reason.message : '行情加载失败'
  } finally {
    if (current === version && !disposed) loading.value = false
  }
}

/** 使用已有诊断字段加权方向；OI/量比只调整强度，避免把增仓或放量直接视为看多。 */
function draw(bars: SimpleKLineData[], data: any, periods: number[]) {
  if (!canvas.value) return
  if (!chart) {
    chart = echarts.init(canvas.value)
    chart.on('datazoom', publishViewport)
  }
  const values = (name: string) => data?.indicators?.[name]?.values || {}
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  const votes: { name: string; value: number; weight: number }[] = []
  const add = (name: string, value: unknown, weight: number) => {
    if (finite(value)) votes.push({ name, value: Math.max(-1, Math.min(1, value)), weight })
  }
  const ema = values('ema').emaMap || {}
  const fast = ema[`EMA${periods[0]}`], slow = ema[`EMA${periods[1]}`]
  const adx = values('adx'), macd = values('macd'), rsi = values('rsi').rsi
  if (finite(fast) && finite(slow)) add('EMA', Math.sign(fast - slow), 2)
  if (finite(adx.pdi) && finite(adx.mdi)) add('DI', (adx.pdi - adx.mdi) / 15, 2)
  if (finite(macd.histogram)) add('MACD', Math.sign(macd.histogram), 2)
  if (finite(rsi)) add('RSI', (rsi - 50) / 25, 1)
  add('资金流', finite(values('moneyFlow').netInflowPercent) ? values('moneyFlow').netInflowPercent / 20 : undefined, .5)
  const heat = values('squareHeat')
  if ((heat.bullishCount || 0) + (heat.bearishCount || 0) > 0) add('情绪', heat.netDirectionalSentimentPercent / 100, .25)
  const total = votes.reduce((sum, vote) => sum + vote.weight, 0)
  score.value = total ? votes.reduce((sum, vote) => sum + vote.value * vote.weight, 0) / total : 0
  evidence.value = total ? votes.map(vote => `${vote.name}${vote.value > .1 ? '↑' : vote.value < -.1 ? '↓' : '→'}`).join(' · ') : '等待指标'
  const last = bars[bars.length - 1]!
  const closes = bars.map(bar => bar.c)
  const atr = values('atr').atr
  // 超过两个周期仍未更新的行情只展示历史，不延伸虚线到过期时间窗口。
  const step = ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as Record<string, number>)[selectedTimeframe.value] || 300
  const fresh = Date.now() / 1000 - last.t < step * 2
  const canProject = votes.length >= 3 && finite(atr) && atr > 0 && bars.length >= 30 && fresh
  if (!canProject && data) error.value = fresh ? '指标或历史数据不足，暂不绘制推演' : '行情已过期，暂不绘制推演'
  // 时间轴额外预留 30 根位置，让最新 K 线及 12 根推演线与右侧价格轴保持距离。
  const times = [...bars.map(bar => bar.t), ...Array.from({ length: 30 }, (_, i) => last.t + (i + 1) * step)]
  axisLength = times.length
  const forecast: (number | null)[] = bars.map(() => null)
  if (canProject) {
    forecast[bars.length - 1] = last.c
    const strength = finite(adx.adx) ? Math.max(.35, Math.min(1.3, adx.adx / 30)) : .7
    const volume = values('volume').ratio
    const participation = finite(volume) ? Math.max(.5, Math.min(1.2, volume)) : 1
    const oiChange = values('oi').changePercent ?? data?.oiMemory?.calculatedChangePercent
    // 增仓增强既有方向，减仓降低延续幅度；不把 OI 的正负当作价格方向。
    const positioning = finite(oiChange) ? 1 + Math.max(-.25, Math.min(.25, oiChange / 100)) : 1
    evidence.value += `${finite(volume) ? ` · 量比 ${volume.toFixed(2)}` : ''}${finite(oiChange) ? ` · OI ${oiChange.toFixed(2)}%` : ''}`
    const support = snapshot.value?.nearestSupport?.upper
    const resistance = snapshot.value?.nearestResistance?.lower
    for (let i = 1; i <= 12; i++) {
      // 基准情景假设未确认突破区域，因此在已识别障碍前收敛，不暗示必然突破。
      let price = last.c + score.value * atr * 2 * strength * participation * positioning * i / 12
      if (resistance != null && resistance > last.c) price = Math.min(price, resistance)
      if (support != null && support < last.c) price = Math.max(price, support)
      forecast.push(Math.max(last.c * .001, price))
    }
  }
  const color = getComputedStyle(canvas.value).getPropertyValue('--el-text-color-secondary').trim() || '#909399'
  const priceLabel = (value: number) => Number(value.toPrecision(7)).toString()
  const distanceLabel = (value: number | null | undefined) => value == null ? '--' : value.toFixed(2)
  // 标注直接绑定对应价格线，放在线内侧起点上方，随价格轴缩放保持对齐。
  const levels = [
    { title: '支撑', zone: snapshot.value?.nearestSupport, percent: snapshot.value?.supportDistancePercent, atr: snapshot.value?.supportDistanceATR, color: '#67c23a', edge: 'upper' as const },
    { title: '阻力', zone: snapshot.value?.nearestResistance, percent: snapshot.value?.resistanceDistancePercent, atr: snapshot.value?.resistanceDistanceATR, color: '#f56c6c', edge: 'lower' as const }
  ].flatMap(level => level.zone ? [{
    name: `${level.title} ${priceLabel(level.zone.lower)}～${priceLabel(level.zone.upper)} · ${distanceLabel(level.percent)}% / ${distanceLabel(level.atr)} ATR`,
    yAxis: level.zone[level.edge],
    lineStyle: { color: level.color },
    label: { color: level.color }
  }] : [])
  chart.setOption({
    animation: false, backgroundColor: 'transparent',
    grid: { left: 6, right: 65, top: 14, bottom: 25 },
    // 保留完整加载窗口计算 EMA，首屏只看最近 60 根；可在图内缩放查看更早行情。
    dataZoom: [{ type: 'inside', xAxisIndex: 0, startValue: Math.max(0, bars.length - 60), endValue: times.length - 1, filterMode: 'filter' }],
    tooltip: {
      trigger: 'axis',
      // 隐藏蜡烛图默认的四项 OHLC 明细，只保留时间、K线名称和指标数值。
      formatter: (params: any) => {
        const entries = Array.isArray(params) ? params : [params]
        return [entries[0]?.axisValueLabel || '', ...entries.map((entry: any) => {
          if (entry.seriesType === 'candlestick') return `${entry.marker || ''}K线`
          const value = typeof entry.value === 'number' ? Number(entry.value.toPrecision(7)).toString() : '--'
          return `${entry.marker || ''}${entry.seriesName}　${value}`
        })].join('<br>')
      }
    },
    xAxis: { type: 'category', data: times.map(time => new Date(time * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })), axisLabel: { color, fontSize: 9 }, axisLine: { lineStyle: { color } } },
    yAxis: { scale: true, position: 'right', axisLabel: { color, fontSize: 9, formatter: (value: number) => Number(value.toPrecision(5)).toString() }, splitLine: { lineStyle: { color, opacity: .12 } } },
    series: [
      { name: 'K线', type: 'candlestick', data: bars.map(bar => [bar.o, bar.c, bar.l, bar.h]), itemStyle: { color: '#67c23a', color0: '#f56c6c', borderColor: '#67c23a', borderColor0: '#f56c6c' }, markLine: { symbol: 'none', label: { show: true, formatter: '{b}', position: 'insideStartTop', distance: 4, fontSize: 10 }, data: levels } },
      ...periods.map((period, index) => ({ name: `EMA${period}`, type: 'line', data: calculateEMA(closes, period).map((value, i) => i < period - 1 ? null : value), showSymbol: false, lineStyle: { width: 1, color: index ? '#9b8afb' : '#e6a23c' } })),
      { name: '条件推演', type: 'line', data: canProject ? forecast : [], showSymbol: false, lineStyle: { type: 'dashed', width: 2, color: '#409eff' } }
    ]
  }, true)
  // 自动刷新和切换交易对/周期后恢复共享窗口，不跳回默认缩放。
  applyViewport()
}
watch(() => props.viewport, applyViewport)
watch(() => props.timeframe, value => { selectedTimeframe.value = value })
watch(() => [props.symbol, selectedTimeframe.value], () => { void load() })
onMounted(() => {
  observer = new ResizeObserver(() => chart?.resize())
  if (canvas.value) observer.observe(canvas.value)
  void load()
  timer = setInterval(() => { if (!loading.value) void load() }, 30_000)
})
onBeforeUnmount(() => { disposed = true; version++; if (timer) clearInterval(timer); observer?.disconnect(); chart?.dispose() })
</script>
<style scoped>
.trend-card { display: flex; flex-direction: column; min-height: 0; overflow: hidden; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 6px; padding: 6px 8px; background: var(--bg-card, var(--el-bg-color)); }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; font-size: 12px; flex-shrink: 0; } header span { flex: 1; }
.period-buttons { display: flex; border: 1px solid var(--el-border-color); border-radius: 3px; overflow: hidden; }
.period-buttons button { border: 0; border-right: 1px solid var(--el-border-color); background: transparent; color: var(--el-text-color-primary); font-size: 10px; padding: 3px 5px; cursor: pointer; }
.period-buttons button:last-child { border-right: 0; }
.period-buttons button:hover { background: var(--el-fill-color); }
.period-buttons button.active { background: var(--el-color-primary); color: #fff; }
.period-buttons button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
/* 画布使用卡片剩余高度，三张图随可视区缩放，不再各自设置 vh 最小高度。 */
.chart { flex: 1; min-height: 0; width: 100%; }
.direction { margin-top: 3px; font-size: 12px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } small { color: var(--el-text-color-secondary); font-size: 10px; }
.error { color: var(--el-color-warning); font-size: 12px; flex-shrink: 0; }
</style>
