<!-- ==================== 热门页市场概览、异动榜与交易对详情 ==================== -->
<template>
  <aside class="market-overview" aria-label="市场概览与交易对详情">
    <section class="overview-card">
      <div class="card-heading"><h3>市场概览</h3><span>{{ scopeLabel }}</span></div>
      <p class="muted">{{ rows.length }} 个交易对 · 24h 有效样本 {{ summary.valid }}</p>
      <div class="overview-metrics">
        <div><span>24h 总成交额</span><strong>{{ amount(summary.volume) }}</strong></div>
        <div><span>上涨占比</span><strong>{{ summary.valid ? (summary.up / summary.valid * 100).toFixed(1) + '%' : '--' }}</strong></div>
      </div>
      <div v-if="summary.valid" class="breadth-bar" aria-label="24h 上涨、平盘、下跌分布">
        <span class="up-bg" :style="{ flex: summary.up }" /><span class="flat-bg" :style="{ flex: summary.flat }" /><span class="down-bg" :style="{ flex: summary.down }" />
      </div>
      <div class="breadth-labels"><span class="up">涨 {{ summary.up }}</span><span>平 {{ summary.flat }}</span><span class="down">跌 {{ summary.down }}</span></div>
      <p class="muted footnote">未计入：{{ rows.length - summary.valid }} 个缺失涨跌幅的交易对</p>
    </section>

    <section class="overview-card">
      <div class="card-heading"><h3>1h 异动榜</h3><span>覆盖 {{ hourly.length }} / {{ rows.length }}</span></div>
      <div class="mover-columns">
        <div v-for="group in movers" :key="group.label">
          <h4 :class="group.tone">{{ group.label }}</h4>
          <button v-for="row in group.rows" :key="row.symbol" class="mover-row" :class="{ active: selected?.symbol === row.symbol }" type="button" @click="emit('select', row.symbol)">
            <span>{{ displaySymbol(row.symbol) }}</span><b :class="group.tone">{{ percent(row.priceChangePercent1h) }}</b>
          </button>
          <p v-if="!group.rows.length" class="muted">暂无有效数据</p>
        </div>
      </div>
      <p class="muted footnote">按当前榜单及资产分类统计，点击定位交易对</p>
    </section>

    <section class="overview-card detail-card">
      <div class="card-heading"><h3>交易对详情</h3><span>点击左侧行切换</span></div>
      <template v-if="selected">
        <div class="detail-title"><strong>{{ displaySymbol(selected.symbol) }}<small> / USDT</small></strong><span class="asset-tag">{{ selected.contractType === 'TRADIFI_PERPETUAL' ? '股票 T' : selected.contractType === 'PERPETUAL' ? '加密货币' : '其他合约' }}</span></div>
        <div class="detail-price"><strong>{{ price(selected.price) }}</strong><span :class="tone(selected.priceChangePercent)">{{ percent(selected.priceChangePercent) }} <small>24h</small></span></div>
        <div class="mini-heading"><span>近 24h · 1h K 线</span><span>{{ chartLoading ? '加载中…' : candles.length ? `${candles.length} 根` : '暂无本地数据' }}</span></div>
        <svg v-if="chartBars.length" class="mini-chart" viewBox="0 0 360 100" role="img" :aria-label="`${selected.symbol} 最近24小时本地1小时K线`">
          <line x1="0" y1="50" x2="360" y2="50" class="chart-grid" />
          <g v-for="bar in chartBars" :key="bar.t" :class="bar.up ? 'candle-up' : 'candle-down'">
            <line :x1="bar.x" :x2="bar.x" :y1="bar.high" :y2="bar.low" />
            <rect :x="bar.x - 4" :y="bar.top" width="8" :height="bar.height" />
          </g>
        </svg>
        <div v-else class="chart-empty">{{ chartLoading ? '正在读取 K 线…' : '暂无近 24h K 线' }}</div>
        <p v-if="candles.length" class="muted footnote">末根 {{ new Date(candles[candles.length - 1]!.t * 1000).toLocaleString('zh-CN') }} · 缺失时段留空</p>
        <div class="mini-heading"><span>24h 价格区间</span><b>{{ rangePosition == null ? '--' : `位于 ${rangePosition.toFixed(0)}%` }}</b></div>
        <div class="price-range"><span v-if="rangePosition != null" :style="{ left: `${rangePosition}%` }" /></div>
        <div class="range-labels"><span>低 {{ price(selected.low24h) }}</span><span>高 {{ price(selected.high24h) }}</span></div>
      </template>
      <p v-else class="muted empty-detail">暂无交易对，调整筛选或等待行情加载</p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import type { MarketOverviewSymbol } from '../../types/market-overview'
import type { SimpleKLineData, KLineApiResponse } from '../../types/kline-simple'

/** 统计范围由父组件提供，排除分页和搜索造成的样本截断。 */
const props = defineProps<{ rows: MarketOverviewSymbol[]; selected?: MarketOverviewSymbol; scopeLabel: string }>()
const emit = defineEmits<{ select: [symbol: string] }>()
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const now = ref(Date.now())
const summary = computed(() => props.rows.reduce((result, row) => {
  if (finite(row.volume) && row.volume > 0) result.volume += row.volume
  // 未知价格变化不能被算作平盘，否则会扭曲市场宽度。
  if (finite(row.priceChangePercent)) {
    result.valid++
    if (row.priceChangePercent > 0) result.up++
    else if (row.priceChangePercent < 0) result.down++
    else result.flat++
  }
  return result
}, { up: 0, down: 0, flat: 0, valid: 0, volume: 0 }))
const hourly = computed(() => props.rows.filter(row => finite(row.priceChangePercent1h)))
const movers = computed(() => [
  { label: '涨幅前五', tone: 'up', rows: hourly.value.filter(row => row.priceChangePercent1h! > 0).sort((a, b) => b.priceChangePercent1h! - a.priceChangePercent1h!).slice(0, 5) },
  { label: '跌幅前五', tone: 'down', rows: hourly.value.filter(row => row.priceChangePercent1h! < 0).sort((a, b) => a.priceChangePercent1h! - b.priceChangePercent1h!).slice(0, 5) },
])
const rangePosition = computed(() => {
  const row = props.selected
  if (!row || !finite(row.high24h) || !finite(row.low24h) || !finite(row.price) || row.high24h <= row.low24h) return null
  return Math.max(0, Math.min(100, (row.price - row.low24h) / (row.high24h - row.low24h) * 100))
})
const candles = ref<SimpleKLineData[]>([])
const chartLoading = ref(false)
let chartController: AbortController | undefined
/** 只读取选中币本地日内 K 线；快速切换时取消旧请求，防止旧图覆盖新交易对。 */
watch(() => props.selected, async (selected) => {
  chartController?.abort()
  candles.value = []
  chartLoading.value = false
  if (!selected) return
  now.value = Date.now()
  const controller = new AbortController()
  chartController = controller
  chartLoading.value = true
  const from = Math.floor(Date.now() / 3600000) * 3600 - 23 * 3600
  try {
    const result = await $fetch<KLineApiResponse>('/api/kline-simple', {
      query: { symbol: selected.symbol, timeframe: '1h', limit: 24, from, to: from + 23 * 3600 },
      signal: controller.signal, timeout: 5000, retry: 0,
    })
    if (!controller.signal.aborted && result.success) {
      candles.value = (result.data?.data || []).filter(candle =>
        [candle.t, candle.o, candle.h, candle.l, candle.c].every(finite) && candle.l > 0 && candle.h >= Math.max(candle.o, candle.c) && candle.l <= Math.min(candle.o, candle.c)
      )
    }
  } catch {
    // 详情缺少历史不影响行情榜，不向交易所发起补数。
  } finally {
    if (!controller.signal.aborted) chartLoading.value = false
  }
}, { immediate: true })
const chartBars = computed(() => {
  if (!candles.value.length) return []
  const low = Math.min(...candles.value.map(candle => candle.l))
  const high = Math.max(...candles.value.map(candle => candle.h))
  const span = high - low || high * 0.01 || 1
  const end = Math.floor(now.value / 3600000) * 3600
  const y = (value: number) => 92 - (value - low) / span * 84
  return candles.value.map(candle => ({
    t: candle.t, x: 8 + (candle.t - (end - 23 * 3600)) / 3600 * 14.9,
    high: y(candle.h), low: y(candle.l), top: Math.min(y(candle.o), y(candle.c)),
    height: Math.max(1, Math.abs(y(candle.o) - y(candle.c))), up: candle.c >= candle.o,
  }))
})
onBeforeUnmount(() => { chartController?.abort() })
const displaySymbol = (symbol: string) => symbol.replace(/USDT$/, '')
const tone = (value: unknown) => finite(value) ? value > 0 ? 'up' : value < 0 ? 'down' : '' : ''
const percent = (value: unknown) => finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '--'
const price = (value: unknown) => finite(value) ? value.toLocaleString('en-US', { maximumSignificantDigits: 8 }) : '--'
const amount = (value: number) => value >= 1e9 ? (value / 1e9).toFixed(2) + 'B' : value >= 1e6 ? (value / 1e6).toFixed(2) + 'M' : value.toLocaleString('en-US', { maximumFractionDigits: 0 })
</script>

<style scoped>
/* 使用项目主题变量；项目暗色模式没有覆盖 Element Plus 的基础背景变量。 */
.market-overview {
  --el-bg-color: var(--bg-card);
  --el-text-color-primary: var(--text-primary);
  --el-text-color-secondary: var(--text-secondary);
  --el-text-color-placeholder: var(--text-placeholder);
  --el-border-color-lighter: var(--border-color);
  --el-fill-color-light: var(--bg-hover);
  display: flex; flex-direction: column; gap: 10px; min-width: 0; color: var(--text-primary);
}
.overview-card { flex-shrink: 0; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); }
/* 前两张卡片按内容排布，详情卡补齐网格高度；多余空间用于图表而非卡片外留白。 */
.detail-card { display: flex; flex-direction: column; flex: 1 0 auto; }
.detail-card > :not(.mini-chart):not(.chart-empty):not(.empty-detail) { flex-shrink: 0; }
.detail-card .mini-chart, .detail-card .chart-empty { flex: 1 0 84px; min-height: 84px; }
.detail-card .empty-detail { flex: 1; display: grid; place-items: center; }
.card-heading, .detail-title, .detail-price, .mini-heading, .range-labels, .breadth-labels { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card-heading h3 { font-size: 14px; margin: 0; color: var(--el-text-color-primary); }
.card-heading > span, .muted, .mini-heading, .range-labels, .breadth-labels { font-size: 11px; color: var(--el-text-color-secondary); }
.muted { margin: 6px 0; line-height: 1.5; }
.overview-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.overview-metrics span { display: block; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.overview-metrics strong { font-size: 23px; font-variant-numeric: tabular-nums; }
.breadth-bar { display: flex; height: 7px; overflow: hidden; border-radius: 4px; margin-bottom: 9px; }
.up-bg { background: var(--el-color-success); }.down-bg { background: var(--el-color-danger); }.flat-bg { background: var(--el-text-color-placeholder); }
.up { color: var(--el-color-success); }.down { color: var(--el-color-danger); }
.footnote { font-size: 10px; margin-bottom: 0; }
.mover-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
h4 { margin: 10px 0 5px; font-size: 12px; font-weight: 500; }
.mover-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; width: 100%; border: 0; padding: 5px 3px; border-radius: 3px; background: transparent; color: var(--el-text-color-primary); font-size: 11px; cursor: pointer; }
.mover-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.mover-row b { flex-shrink: 0; font-weight: 500; font-variant-numeric: tabular-nums; }
.mover-row:hover, .mover-row.active { background: var(--el-fill-color-light); }.mover-row:focus-visible { outline: 2px solid var(--el-color-primary); }
.detail-title { margin-top: 12px; }.detail-title strong { font-size: 19px; }.detail-title small { font-size: 12px; color: var(--el-text-color-secondary); font-weight: 400; }
.asset-tag { font-size: 10px; color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 15%, transparent); border-radius: 4px; padding: 3px 6px; }
.detail-price { margin: 8px 0 12px; }.detail-price strong { font-size: 25px; font-variant-numeric: tabular-nums; }.detail-price span { font-size: 13px; }.detail-price small { font-size: 10px; }
.mini-chart { display: block; width: 100%; height: 84px; margin-top: 6px; }.chart-grid { stroke: var(--el-border-color-lighter); stroke-dasharray: 3 4; }
.candle-up { stroke: var(--el-color-success); fill: var(--el-color-success); }.candle-down { stroke: var(--el-color-danger); fill: var(--el-color-danger); }
.chart-empty { display: grid; place-items: center; height: 84px; color: var(--el-text-color-placeholder); font-size: 12px; }.mini-heading { margin-top: 10px; }
.price-range { height: 5px; background: linear-gradient(90deg, var(--el-color-danger), var(--el-color-warning), var(--el-color-success)); border-radius: 4px; position: relative; margin: 14px 6px 10px; }
.price-range > span { position: absolute; top: -4px; width: 3px; height: 13px; background: var(--el-text-color-primary); transform: translateX(-50%); border-radius: 2px; }
.empty-detail { padding: 20px 0; text-align: center; }
</style>
