<!-- ==================== 合约 K 线、CVD 与 Delta 联动图 ==================== -->
<template>
  <section ref="panel" class="trend-card" :class="{ expanded }" v-loading="loading">
    <header>
      <strong>{{ symbol }}</strong>
      <div class="period-buttons" role="group" aria-label="图表周期">
        <button v-for="period in timeframes" :key="period" type="button" :class="{ active: selectedTimeframe === period }" :aria-pressed="selectedTimeframe === period" @click="selectedTimeframe = period">{{ period }}</button>
      </div>
      <label class="ema-toggle" title="价格摆动点左右各3根收盘确认；比较对应CVD，非反转信号"><input v-model="showDivergence" type="checkbox">背离</label>
      <button type="button" @click="load">刷新</button>
      <button type="button" :aria-pressed="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : '放大' }}</button>
    </header>
    <div v-if="error" class="error" role="status">{{ error }}</div>
    <div ref="canvas" class="chart" :aria-label="`${symbol} ${selectedTimeframe} K线、成交量、合约CVD、Delta及趋势效率ER联动图`" />
    <div class="flow-note">{{ flowNote }}</div>
  </section>
</template>
<script setup lang="ts">
import * as echarts from 'echarts'
import type { SimpleKLineData, KLineApiResponse } from '../../types/kline-simple'
import type { SupportResistanceSnapshot } from '../../types/support-resistance'
import { calculateEMA } from '../utils/ema-calculator'
import { calculateAdxChartSeries } from '../utils/adx-chart-series'
import { calculateRsiChartSeries } from '../utils/rsi-chart-series'
import { calculateMacdChartSeries } from '../utils/macd-chart-series'
import { calculateErChartMetricsSeries } from '../utils/er-chart-series'
import type { Timeframe } from '../../types/strategy'
import { calculateContractFlow } from '../utils/contract-order-flow'
import { detectCvdDivergences } from '../utils/cvd-divergence'
import { useBotStore } from '../stores/bot'

/** 主表选择交易对时传入其周期；图表仍允许独立切换周期。 */
interface Props { symbol: string; timeframe: string }
const props = defineProps<Props>()
const emit = defineEmits<{ 'timeframe-change': [timeframe: string] }>()
const timeframes = ['5m', '15m', '1h', '4h', '1d']
const selectedTimeframe = ref(props.timeframe)
const showDivergence = ref(true)
const showAdx = ref(true)
const showPdi = ref(true)
const showMdi = ref(true)
const expanded = ref(false)
const panel = ref<HTMLDivElement>()
const canvas = ref<HTMLDivElement>()
const loading = ref(false)
const error = ref('')
const flowNote = ref('')
// 每次重绘替换数据读取闭包，鼠标事件只注册一次，避免读取过期行情。
let inspectAt: ((x: number, y: number) => void) | undefined
let resetInspect: (() => void) | undefined
const botStore = useBotStore()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
let timer: ReturnType<typeof setInterval> | undefined
let version = 0
let disposed = false
let currentBars: SimpleKLineData[] = []
let snapshot: SupportResistanceSnapshot | undefined
let periods = [20, 60]
// 右侧预留12根空位，让最新行情与价格轴保持距离。
const rightPaddingBars = 12
let viewport: { start?: number; end?: number } | undefined
const interval = () => ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[selectedTimeframe.value] || 3600)
const compact = (value: number) => Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : Math.abs(value) >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : Number(value.toPrecision(6)).toString()
const dateLabel = (time: number) => new Date(time * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** 独立请求成交历史和本地结构指标；结构失败不影响成交副图。 */
async function load() {
  const request = ++version
  loading.value = true
  error.value = ''
  try {
    const configured = botStore.botConfig?.emaPeriods?.slice(0, 2)
    const requestedPeriods = configured?.length === 2 ? configured : [20, 60]
    const [candles, diagnostics] = await Promise.allSettled([
      // 不传 limit，读取当前交易对、当前周期在本地数据库中的全部历史。
      $fetch<KLineApiResponse>('/api/kline-simple', { query: { symbol: props.symbol, timeframe: selectedTimeframe.value } }),
      $fetch<any>('/api/bot/indicators', { query: { symbol: props.symbol, timeframe: selectedTimeframe.value, structureOnly: 'true', includeSlowStats: 'false' } })
    ])
    if (disposed || request !== version) return
    if (candles.status !== 'fulfilled' || !candles.value.success) throw new Error('K线加载失败，请刷新重试')
    const bars = candles.value.data?.data || []
    if (!bars.length) throw new Error('暂无该周期 K 线数据')
    periods = requestedPeriods
    currentBars = bars
    snapshot = diagnostics.status === 'fulfilled' && diagnostics.value.success ? diagnostics.value.data?.indicators?.supportResistance?.values : undefined
    if (!snapshot) error.value = '关键位暂不可用，K线与成交副图仍可查看'
    if (Date.now() / 1000 - bars[bars.length - 1]!.t >= interval() * 2) error.value = '行情已过期，当前显示历史数据'
    draw()
  } catch (reason) {
    if (!disposed && request === version) error.value = reason instanceof Error ? reason.message : '行情加载失败'
  } finally {
    if (!disposed && request === version) loading.value = false
  }
}

/** 只用可见蜡烛的高低点定价轴，远处均线和关键位不参与撑大范围。 */
function visiblePriceRange() {
  const lastAxisIndex = currentBars.length + rightPaddingBars - 1
  const zoom = viewport || { start: Math.max(0, (currentBars.length - 80) / (currentBars.length + rightPaddingBars) * 100), end: 100 }
  const start = Math.max(0, Math.ceil((zoom.start ?? 0) / 100 * lastAxisIndex))
  const end = Math.min(currentBars.length - 1, Math.floor((zoom.end ?? 100) / 100 * lastAxisIndex))
  const visible = currentBars.slice(start, end + 1)
  // 用户仅缩放到右侧留白时，保留最后一根的价格范围。
  if (!visible.length && currentBars.length) visible.push(currentBars[currentBars.length - 1]!)
  const lows = visible.map(bar => bar.l).filter(Number.isFinite)
  const highs = visible.map(bar => bar.h).filter(Number.isFinite)
  if (!lows.length || !highs.length) return {}
  const low = Math.min(...lows), high = Math.max(...highs)
  // 横盘或单根零振幅时也留出非零范围，避免价格轴塌缩。
  const padding = Math.max((high - low) * .08, Math.abs(high) * .0001, 1e-12)
  return { min: low - padding, max: high + padding }
}

/** 累计值保留原始起点，仅按可见 CVD 的波动定纵轴，避免远处历史压扁曲线。 */
function visibleCvdRange() {
  const cvd = calculateContractFlow(currentBars, interval()).cvd
  const lastAxisIndex = currentBars.length + rightPaddingBars - 1
  const zoom = viewport || { start: Math.max(0, (currentBars.length - 80) / (currentBars.length + rightPaddingBars) * 100), end: 100 }
  const start = Math.max(0, Math.ceil((zoom.start ?? 0) / 100 * lastAxisIndex))
  const end = Math.min(currentBars.length - 1, Math.floor((zoom.end ?? 100) / 100 * lastAxisIndex))
  const values = cvd.slice(start, end + 1).filter((value): value is number => value !== null && Number.isFinite(value))
  if (!values.length) return { min: 'dataMin' as const, max: 'dataMax' as const }
  const low = Math.min(...values), high = Math.max(...values)
  const padding = Math.max((high - low) * .12, Math.abs(high) * 1e-6, 1e-6)
  return { min: low - padding, max: high + padding }
}

/** Delta 按可见柱体绝对峰值对称缩放，保留零轴，正负柱使用相同刻度。 */
function visibleDeltaRange() {
  const delta = calculateContractFlow(currentBars, interval()).delta
  const lastAxisIndex = currentBars.length + rightPaddingBars - 1
  const zoom = viewport || { start: Math.max(0, (currentBars.length - 80) / (currentBars.length + rightPaddingBars) * 100), end: 100 }
  const start = Math.max(0, Math.ceil((zoom.start ?? 0) / 100 * lastAxisIndex))
  const end = Math.min(currentBars.length - 1, Math.floor((zoom.end ?? 100) / 100 * lastAxisIndex))
  const values = delta.slice(start, end + 1).filter((value): value is number => value !== null && Number.isFinite(value))
  const bound = Math.max(1e-6, ...values.map(value => Math.abs(value))) * 1.12
  return { min: -bound, max: bound }
}

/** 只按可见的三条 ADX / DI 曲线定轴，参考线不参与撑大范围。 */
function visibleAdxRange(values = calculateAdxChartSeries(currentBars, interval())) {
  const lastAxisIndex = currentBars.length + rightPaddingBars - 1
  const zoom = viewport || { start: Math.max(0, (currentBars.length - 80) / (currentBars.length + rightPaddingBars) * 100), end: 100 }
  const start = Math.max(0, Math.ceil((zoom.start ?? 0) / 100 * lastAxisIndex))
  const end = Math.min(currentBars.length - 1, Math.floor((zoom.end ?? 100) / 100 * lastAxisIndex))
  // 隐藏曲线不参与定轴，避免不可见的极值压缩正在观察的指标。
  const visible = values.slice(start, end + 1).flatMap(value => value ? [
    ...(showAdx.value ? [value.adx] : []),
    ...(showPdi.value ? [value.pdi] : []),
    ...(showMdi.value ? [value.mdi] : [])
  ] : []).filter(Number.isFinite)
  // 预热区间或右侧留白没有有效值时，交给图表自动定轴。
  if (!visible.length) return { min: 'dataMin', max: 'dataMax' }
  const low = Math.min(...visible)
  const high = Math.max(...visible)
  const padding = Math.max((high - low) * .12, 1)
  return { min: Math.max(0, Math.floor(low - padding)), max: Math.min(100, Math.ceil(high + padding)) }
}

/** MACD 按可见双线和柱体对称定轴，避免历史极值压扁当前动能。 */
function visibleMacdRange(values = calculateMacdChartSeries(currentBars, interval())) {
  const lastAxisIndex = currentBars.length + rightPaddingBars - 1
  const zoom = viewport || { start: Math.max(0, (currentBars.length - 80) / (currentBars.length + rightPaddingBars) * 100), end: 100 }
  const start = Math.max(0, Math.ceil((zoom.start ?? 0) / 100 * lastAxisIndex))
  const end = Math.min(currentBars.length - 1, Math.floor((zoom.end ?? 100) / 100 * lastAxisIndex))
  const visible = values.slice(start, end + 1).flatMap(value => value ? [value.dif, value.dea, value.histogram] : []).filter((value): value is number => value != null && Number.isFinite(value))
  const bound = Math.max(1e-8, ...visible.map(value => Math.abs(value))) * 1.12
  return { min: -bound, max: bound }
}

/** 主图与成交副图共享时间轴；副图左右独立刻度，累计值与单根值不混用。 */
function draw() {
  if (!canvas.value || !currentBars.length) return
  if (!chart) {
    chart = echarts.init(canvas.value)
    // ECharts 标题事件仅提供 componentIndex，需从当前配置取 ID 后再切换。
    chart.on('click', (event: any) => {
      if (event.componentType !== 'title') return
      const titles = chart?.getOption().title as Array<{ id?: string }> | undefined
      const id = titles?.[event.componentIndex]?.id
      if (id === 'adx-title') showAdx.value = !showAdx.value
      if (id === 'pdi-title') showPdi.value = !showPdi.value
      if (id === 'mdi-title') showMdi.value = !showMdi.value
    })
    chart.getZr().on('mousemove', event => inspectAt?.(event.offsetX, event.offsetY))
    chart.getZr().on('globalout', () => resetInspect?.())
    chart.on('datazoom', () => {
      const zoom = (chart?.getOption().dataZoom as { start?: number; end?: number }[])?.[0]
      if (zoom) {
        viewport = { start: zoom.start, end: zoom.end }
        chart?.setOption({ yAxis: [
          { id: 'price-axis', ...visiblePriceRange() },
          { id: 'flow-axis-1', ...visibleCvdRange() },
          { id: 'flow-axis-2', ...visibleDeltaRange() },
          { id: 'adx-axis', ...visibleAdxRange() },
          { id: 'macd-axis', ...visibleMacdRange() }
        ] })
      }
    })
  }
  const bars = currentBars
  const flow = calculateContractFlow(bars, interval())
  const adxValues = calculateAdxChartSeries(bars, interval())
  const latestAdx = adxValues[bars.length - 1]
  const rsiValues = calculateRsiChartSeries(bars, interval())
  const latestRsi = rsiValues[bars.length - 1]
  const macdValues = calculateMacdChartSeries(bars, interval())
  // 右侧图表包含最新未收盘柱的 ER 预览，曲线与标题共用该序列。
  const erMetrics = calculateErChartMetricsSeries(bars, selectedTimeframe.value as Timeframe, interval(), Date.now(), undefined, { includeOpen: true })
  const erValues = erMetrics.map(value => value?.er ?? null)
  // 仅图表显示乘100，与 RSI 共用刻度；计算结果及 AI 输入保持 0～1 原始口径。
  const erDisplayValues = erValues.map(value => value === null ? null : value * 100)
  // 括号内展示同一 ER 窗口的实际涨跌幅，默认展示与历史悬停统一格式。
  const erTitle = (index: number) => {
    const change = erMetrics[index]?.netChangePercent
    const percent = change == null ? '--' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`
    return `ER20×100 ${erDisplayValues[index]?.toFixed(2) ?? '--'} (${percent})`
  }
  // 基准只取前12根连续有效成交量，当前根不参与自身均量，避免放量时抬高基准。
  const validVolume = (value: number) => Number.isFinite(value) && value >= 0
  const volumeAverages = bars.map((bar, index) => {
    if (index < 12) return null
    const previous = bars.slice(index - 12, index)
    if (!previous.every((item, offset) => validVolume(item.v) && item.t === bar.t - (12 - offset) * interval())) return null
    return previous.reduce((sum, item) => sum + item.v, 0) / 12
  })
  const volumeRatios = bars.map((bar, index) => validVolume(bar.v) && volumeAverages[index] != null && volumeAverages[index]! > 0 ? bar.v / volumeAverages[index]! : null)
  const last = bars.length - 1
  const segment = flow.segmentStarts[last] ?? -1
  const valid = flow.delta.filter(value => value !== null).length
  flowNote.value = segment >= 0
    ? `合约 CVD 自 ${dateLabel(bars[segment]!.t)} 从零累计；单位 USDT。${valid < bars.length || flow.segmentStarts.some((start, i) => i > 0 && start === i) ? '缺口后分段重算。' : ''}末根可能未收盘。`
    : '末根成交额缺失，CVD / Delta 留空；有效历史区间分段累计，单位 USDT。'
  const divergences = showDivergence.value ? detectCvdDivergences(bars, interval(), Date.now() / 1000) : []
  const color = getComputedStyle(canvas.value).getPropertyValue('--el-text-color-secondary').trim() || '#909399'
  const price = (value: number) => Number(value.toPrecision(7)).toString()
  // 各图标题原位显示同一时刻的数据，不再额外占用一个信息区域。
  const updateTitles = (index: number) => {
    const bar = bars[index]
    if (!bar) return
    const amount = (value: number | null | undefined) => value == null ? '--' : `${compact(value)} USDT`
    const ratio = volumeRatios[index]
    const adx = adxValues[index]
    const macd = macdValues[index]
    const macdNumber = (value: number | null | undefined) => value == null ? '--' : Number(value.toPrecision(4)).toString()
    chart?.setOption({ title: [
      { id: 'price-title', text: `${dateLabel(bar.t)} 开 ${price(bar.o)} 高 ${price(bar.h)} 低 ${price(bar.l)} 收 ${price(bar.c)} 量 ${validVolume(bar.v) ? compact(bar.v) : '--'} 量比 ${ratio == null ? '--' : `${ratio.toFixed(2)}x`}` },
      { id: 'cvd-title', text: `CVD ${amount(flow.cvd[index])}` },
      { id: 'delta-title', text: `Delta ${amount(flow.delta[index])}` },
      { id: 'adx-title', text: `ADX(14) ${adx?.adx.toFixed(1) ?? '--'}` },
      { id: 'pdi-title', text: `+DI ${adx?.pdi.toFixed(1) ?? '--'}` },
      { id: 'mdi-title', text: `−DI ${adx?.mdi.toFixed(1) ?? '--'}` },
      { id: 'rsi-title', text: `RSI(14) ${rsiValues[index]?.toFixed(1) ?? '--'}` },
      { id: 'er-title', text: erTitle(index) },
      { id: 'macd-title', text: `MACD(12,26,9) DIF ${macdNumber(macd?.dif)}  DEA ${macdNumber(macd?.dea)}  柱 ${macdNumber(macd?.histogram)}` }
    ] })
  }
  let inspectedIndex = -1
  resetInspect = () => {
    updateTitles(bars.length - 1)
    // 默认显示最新有效值，包含未收盘柱的 ER 与同窗口涨跌幅。
    const latest = erValues.findLastIndex(value => value !== null)
    chart?.setOption({ title: [{ id: 'er-title', text: erTitle(latest) }] })
    inspectedIndex = -1
  }
  inspectAt = (x, y) => {
    if (!chart) return
    const gridIndex = [0, 1, 2, 3, 4].find(index => chart!.containPixel({ gridIndex: index }, [x, y]))
    if (gridIndex == null) { resetInspect?.(); return }
    const index = Math.round(Number(chart.convertFromPixel({ xAxisIndex: gridIndex }, x)))
    if (!bars[index]) { resetInspect?.(); return }
    if (index !== inspectedIndex) { updateTitles(index); inspectedIndex = index }
  }
  const levels = [
    // 支撑与阻力采用相同格式，距离缺失时保留 --，不伪造零距离。
    { title: '支撑', zone: snapshot?.nearestSupport, color: '#67c23a', edge: 'upper' as const,
      detail: `（${snapshot?.nearestSupport?.touches ?? '--'}） ${snapshot?.supportDistanceATR != null && Number.isFinite(snapshot.supportDistanceATR) ? snapshot.supportDistanceATR.toFixed(2) : '--'} ATR` },
    // 触碰次数和 ATR 距离均取同一结构快照，缺失距离显示 --，避免被误读为零距离。
    { title: '阻力', zone: snapshot?.nearestResistance, color: '#f56c6c', edge: 'lower' as const,
      detail: `（${snapshot?.nearestResistance?.touches ?? '--'}） ${snapshot?.resistanceDistanceATR != null && Number.isFinite(snapshot.resistanceDistanceATR) ? snapshot.resistanceDistanceATR.toFixed(2) : '--'} ATR` }
  ].flatMap(({ title, zone, color, edge, detail }) => zone ? [{ name: `${title} ${zone.lower === zone.upper ? price(zone.lower) : `${price(zone.lower)}～${price(zone.upper)}`}${detail}`, yAxis: zone[edge], lineStyle: { color }, label: { color, position: edge === 'upper' ? 'insideEndBottom' : 'insideEndTop' } }] : [])
  // 每个连续区间单独建线，时间断档后也不会误画跨区连接线。
  const starts = [...new Set(flow.segmentStarts.filter(start => start >= 0))]
  const cvdSeries = starts.map(start => ({
    name: '合约 CVD', type: 'line', xAxisIndex: 1, yAxisIndex: 1,
    data: flow.cvd.map((value, i) => flow.segmentStarts[i] === start ? value : null),
    connectNulls: false, showSymbol: false, z: 4, lineStyle: { color: '#409eff', width: 1.5 }, itemStyle: { color: '#409eff' }
  }))
  // 仅为右侧预留视觉空位，不生成未来时间、价格或成交数据。
  const axis = [...bars.map(bar => dateLabel(bar.t)), ...Array<string>(rightPaddingBars).fill('')]
  // 使用原始数据索引定位，价格和 CVD 两处连线指向完全相同的时间点。
  const divergenceSeries = divergences.flatMap(signal => [0, 1].map(axisIndex => {
    const title = signal.kind === 'bearish' ? '顶背离' : '底背离'
    const color = signal.kind === 'bearish' ? '#f56c6c' : '#67c23a'
    return {
      name: title, type: 'line', xAxisIndex: axisIndex, yAxisIndex: axisIndex,
      // 为标注系列提供端点数据，确保 ECharts 在空系列优化后仍绘制 markLine。
      data: bars.map((_, index) => index === signal.from ? (axisIndex === 0 ? signal.priceFrom : signal.cvdFrom) : index === signal.to ? (axisIndex === 0 ? signal.priceTo : signal.cvdTo) : null),
      showSymbol: false, lineStyle: { opacity: 0 }, silent: true,
      markLine: { silent: true, symbol: ['circle', 'circle'], symbolSize: 5,
        lineStyle: { color, width: 1.5, type: 'solid' },
        label: { show: true, formatter: title, color, fontSize: 10, position: signal.kind === 'bearish' ? 'insideEndTop' : 'insideEndBottom' },
        data: [[
          { coord: [signal.from, axisIndex === 0 ? signal.priceFrom : signal.cvdFrom] },
          { coord: [signal.to, axisIndex === 0 ? signal.priceTo : signal.cvdTo] }
        ]] }
    }
  }))
  chart.setOption({
    animation: false,
    title: [
      { id: 'price-title', text: '', left: 6, top: 0, textStyle: { color, fontSize: 9, lineHeight: 13, fontWeight: 'normal' } },
      { id: 'cvd-title', text: '', left: 6, top: '35%', textStyle: { color: '#409eff', fontSize: 10, fontWeight: 'normal' } },
      { id: 'delta-title', text: '', right: 6, top: '35%', textStyle: { color, fontSize: 10, fontWeight: 'normal' } },
      { id: 'adx-title', triggerEvent: true, text: `ADX(14) ${latestAdx?.adx.toFixed(1) ?? '--'}`, left: 6, top: '52%', textStyle: { color: showAdx.value ? '#f4d35e' : '#73767a', fontSize: 10, fontWeight: 'normal' } },
      { id: 'pdi-title', triggerEvent: true, text: `+DI ${latestAdx?.pdi.toFixed(1) ?? '--'}`, left: '35%', top: '52%', textStyle: { color: showPdi.value ? '#95d475' : '#73767a', fontSize: 10, fontWeight: 'normal' } },
      { id: 'mdi-title', triggerEvent: true, text: `−DI ${latestAdx?.mdi.toFixed(1) ?? '--'}`, left: '65%', top: '52%', textStyle: { color: showMdi.value ? '#ff8a80' : '#73767a', fontSize: 10, fontWeight: 'normal' } },
      { id: 'rsi-title', text: `RSI(14) ${latestRsi?.toFixed(1) ?? '--'}`, left: 6, top: '67%', textStyle: { color: '#9b8afb', fontSize: 10, fontWeight: 'normal' } },
      { id: 'macd-title', text: '', left: 6, top: '80%', textStyle: { color, fontSize: 9, fontWeight: 'normal' } },
      { id: 'er-title', text: '', right: 6, top: '67%', textStyle: { color: '#36cfc9', fontSize: 10, fontWeight: 'normal' } }
    ],
    // 上下绘图区边界必须一致，同一时间点的十字线才能垂直对齐。
    grid: [
      { left: 8, right: 65, top: 25, height: '28%' },
      // 标题之后固定预留20px，将原先随高度增长的空白归还给曲线。
      { left: 8, right: 65, top: chart.getHeight() * .35 + 20, bottom: '50%' },
      { left: 8, right: 65, top: chart.getHeight() * .52 + 20, bottom: '35%' },
      { left: 8, right: 65, top: chart.getHeight() * .67 + 20, bottom: '22%' },
      { left: 8, right: 65, top: chart.getHeight() * .80 + 20, bottom: 28 }
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    // 数值由各图标题原位显示，保留联动十字线并关闭悬浮框。
    tooltip: { trigger: 'axis', showContent: false, axisPointer: { type: 'cross' } },
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1, 2, 3, 4], filterMode: 'none', ...(viewport || { start: Math.max(0, (bars.length - 80) / axis.length * 100), end: 100 }) }],
    // 十字线时间提示只显示在主图下方，底部副图仍保留常规时间刻度。
    xAxis: [0, 1, 2, 3, 4].map(index => ({ type: 'category', gridIndex: index, data: axis, boundaryGap: true, axisPointer: { label: { show: index === 0, margin: 3 } }, axisLabel: { show: index === 4, color, fontSize: 9, hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color, opacity: .4 } } })),
    yAxis: [
      ...[0, 1, 2].map(index => ({ id: index === 0 ? 'price-axis' : `flow-axis-${index}`, ...(index === 0 ? visiblePriceRange() : index === 1 ? visibleCvdRange() : visibleDeltaRange()), type: 'value', gridIndex: index === 0 ? 0 : 1, scale: index !== 2, position: index === 1 ? 'left' : 'right', axisLabel: { inside: index === 1, margin: index === 1 ? 4 : 8, color: index === 1 ? '#409eff' : color, fontSize: 9, formatter: index === 0 ? price : compact }, splitNumber: index === 0 ? 5 : 2, splitLine: { show: index !== 1, lineStyle: { color, opacity: .12 } } })),
      // 成交量使用左侧独立量轴，仅在底部柱体区域显示刻度，避免与右侧价格刻度混淆。
      { id: 'volume-axis', type: 'value', gridIndex: 0, min: 0,
        max: (range: { max: number }) => Math.max(1, range.max * 4),
        position: 'left', splitNumber: 8,
        axisLabel: { inside: true, margin: 4, color, fontSize: 9,
          formatter: (value: number, index: number) => index <= 2 ? compact(value) : '' },
        axisPointer: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      { id: 'adx-axis', type: 'value', gridIndex: 2, ...visibleAdxRange(adxValues), scale: true, splitNumber: 3, position: 'right', axisLabel: { color, fontSize: 9, hideOverlap: true }, splitLine: { lineStyle: { color, opacity: .12 } } },
      { id: 'rsi-axis', type: 'value', gridIndex: 3, min: 0, max: 100, interval: 50, position: 'right', axisLabel: { color, fontSize: 9, hideOverlap: true, formatter: (value: number) => value === 50 ? '' : String(value) }, axisPointer: { label: { show: false } }, splitLine: { show: false } },
      { id: 'macd-axis', type: 'value', gridIndex: 4, ...visibleMacdRange(macdValues), position: 'right', splitNumber: 2, axisLabel: { color, fontSize: 9, hideOverlap: true, formatter: (value: number) => Number(value.toPrecision(3)).toString() }, splitLine: { lineStyle: { color, opacity: .12 } } }
    ],
    // RSI 系列前有动态 EMA 和背离系列，按实际数量定位，避免把阈值配色应用到其他曲线。
    visualMap: {
      type: 'piecewise', show: false,
      seriesIndex: 1 + periods.length + cvdSeries.length + divergenceSeries.length,
      dimension: 1,
      pieces: [
        { lt: 30, color: '#67c23a' },
        { gte: 30, lte: 70, color: '#9b8afb' },
        { gt: 70, color: '#f56c6c' }
      ]
    },
    series: [
      // 关键位标签移至右端，与左侧成交量刻度错开，仅显示文字。
      // 禁用 markLine 默认的两位小数坐标舍入，避免低价币的支撑、阻力被画到同一价位。
      { name: 'K线', type: 'candlestick', data: bars.map(bar => [bar.o, bar.c, bar.l, bar.h]), itemStyle: { color: '#67c23a', color0: '#f56c6c', borderColor: '#67c23a', borderColor0: '#f56c6c' }, markLine: { precision: -1, symbol: 'none', label: { formatter: '{b}', position: 'insideEndTop', fontSize: 10 }, data: levels } },
      ...periods.map((period, i) => ({ name: `EMA${period}`, type: 'line', data: calculateEMA(bars.map(bar => bar.c), period).map((value, index) => index < period - 1 ? null : value), showSymbol: false, lineStyle: { width: 1, color: i ? '#9b8afb' : '#e6a23c' } })),
      ...cvdSeries,
      ...divergenceSeries,
      { name: 'RSI(14)', type: 'line', xAxisIndex: 3, yAxisIndex: 5, data: rsiValues,
        showSymbol: false, connectNulls: false, lineStyle: { width: 1.5 },
        // 超买超卖和中线仅供观察动能，不等同于反转或开仓信号。
        // 保留 RSI 参考线标签；纵轴仅隐藏重复的50，仍展示0和100。
        markLine: { silent: true, symbol: 'none', label: { show: true, position: 'end', fontSize: 9, color, formatter: '{b}' },
          lineStyle: { color, opacity: .45, type: 'dashed' }, data: [{ name: 'RSI 30', yAxis: 30 }, { name: 'RSI 50', yAxis: 50 }, { name: 'RSI 70', yAxis: 70 }] } },
      { name: '趋势效率 ER20×100', type: 'line', xAxisIndex: 3, yAxisIndex: 5, data: erDisplayValues, showSymbol: false, connectNulls: false, lineStyle: { width: 1.5, type: 'dashed', color: '#36cfc9' } },
      ...(['dif', 'dea'] as const).map((key, index) => ({ name: key.toUpperCase(), type: 'line', xAxisIndex: 4, yAxisIndex: 6, data: macdValues.map(value => value?.[key] ?? null), showSymbol: false, connectNulls: false, lineStyle: { width: 1.2, color: index === 0 ? '#e6a23c' : '#9b8afb' } })),
      { name: 'MACD柱', type: 'bar', xAxisIndex: 4, yAxisIndex: 6, barMaxWidth: 10, data: macdValues.map(value => value?.histogram == null ? null : { value: value.histogram, itemStyle: { color: value.histogram >= 0 ? '#67c23a' : '#f56c6c', opacity: .65 } }) },
      ...(['adx', 'pdi', 'mdi'] as const).map((key, index) => ({
        name: ['ADX(14)', '+DI', '−DI'][index], type: 'line', xAxisIndex: 2, yAxisIndex: 4,
        data: adxValues.map(value => [showAdx.value, showPdi.value, showMdi.value][index] ? value?.[key] ?? null : null), showSymbol: false, connectNulls: false,
        lineStyle: { width: index === 0 ? 1.8 : 1.2, opacity: index === 0 ? 1 : .55, color: ['#f4d35e', '#95d475', '#ff8a80'][index] },
        // 20 / 25 只是强度参考，不作为自动买卖信号。
        ...(index === 0 && showAdx.value ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color, opacity: .4, type: 'dashed' }, data: [{ yAxis: 20 }, { yAxis: 25 }] } } : {})
      })),
      { name: '成交量', type: 'bar', xAxisIndex: 0, yAxisIndex: 3, z: 0, data: bars.map(bar => ({ value: validVolume(bar.v) ? bar.v : null, itemStyle: { color: bar.c >= bar.o ? '#67c23a' : '#f56c6c', opacity: .25 } })), barMaxWidth: 10 },
      { name: '前12根均量', type: 'line', xAxisIndex: 0, yAxisIndex: 3, z: 1, data: volumeAverages, showSymbol: false, connectNulls: false, lineStyle: { color: '#e6a23c', width: 1, opacity: .4 } },
      { name: 'Delta', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, z: 1, data: flow.delta.map(value => value == null ? null : { value, itemStyle: { color: value >= 0 ? '#67c23a' : '#f56c6c', opacity: .55 } }), barMaxWidth: 10 }
    ]
  } as echarts.EChartsOption, true)
  resetInspect()
}
/** 切换交易对或周期时清空旧图，避免把前一交易对的数据误认成当前行情。 */
function resetAndLoad() {
  viewport = undefined
  currentBars = []
  flowNote.value = ''
  inspectAt = undefined
  resetInspect = undefined
  chart?.clear()
  void load()
}
function onKey(event: KeyboardEvent) { if (event.key === 'Escape') expanded.value = false }
watch(() => props.timeframe, value => { selectedTimeframe.value = value })
watch(selectedTimeframe, value => emit('timeframe-change', value))
watch(() => [props.symbol, selectedTimeframe.value], resetAndLoad)
watch(showDivergence, draw)
watch([showAdx, showPdi, showMdi], draw)
watch(expanded, async () => { await nextTick(); chart?.resize(); draw() })
onMounted(() => {
  observer = new ResizeObserver(() => { chart?.resize(); draw() })
  if (canvas.value) observer.observe(canvas.value)
  window.addEventListener('keydown', onKey)
  void load()
  timer = setInterval(() => { if (!loading.value) void load() }, 30_000)
})
onBeforeUnmount(() => { disposed = true; version++; if (timer) clearInterval(timer); observer?.disconnect(); chart?.dispose(); window.removeEventListener('keydown', onKey) })
</script>
<style scoped>
.trend-card { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 6px; padding: 8px; background: var(--bg-card, var(--el-bg-color)); }
.trend-card.expanded { position: fixed; top: 50%; left: 50%; width: min(88vw, 1000px); transform: translate(-50%, -50%); z-index: 2000; height: 92dvh; overflow-y: auto; box-shadow: 0 0 0 100vmax rgba(0,0,0,.5); }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; flex-shrink: 0; }
header strong { margin-right: auto; }
header button { background: transparent; border: 1px solid var(--el-border-color); border-radius: 3px; color: var(--el-text-color-primary); cursor: pointer; padding: 3px 5px; font-size: 11px; }
.period-buttons { display: flex; gap: 2px; }
.period-buttons button.active { background: var(--el-color-primary); color: #fff; }
.ema-toggle { display: flex; align-items: center; font-size: 11px; }
.chart { flex: 1; min-height: 0; width: 100%; margin-top: 8px; }
.flow-note { color: var(--el-text-color-secondary); font-size: 10px; line-height: 1.5; padding-top: 4px; }
.error { color: var(--el-color-warning); font-size: 12px; }
</style>
