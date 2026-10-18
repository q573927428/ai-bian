<!-- ==================== 底部固定市场行情滚动条 ==================== -->
<template>
  <div class="market-ticker" aria-label="市场概览">
    <div ref="viewport" class="ticker-viewport" tabindex="0" aria-label="市场指标，悬停或聚焦暂停滚动">
    <div ref="track" class="ticker-track" :class="{ scrolling: overflowing }" :style="tickerStyle">
    <div v-for="copy in (overflowing ? 2 : 1)" :key="copy" class="market-overview" :aria-hidden="copy === 2 ? true : undefined">
    <span class="metric-group sentiment-group" :title="sourceTitle('Alternative.me', overview?.fearGreed)">
      <span class="metric-label">恐慌贪婪</span> <strong :style="{ color: sentimentColor }">{{ score ?? '--' }}</strong>
      <el-tag v-if="score !== undefined" size="small" class="sentiment-tag" :style="sentimentTagStyle" effect="light">{{ sentiment }}</el-tag><small v-if="overview?.fearGreed.stale">（待更新）</small>
    </span>
    <span class="metric-group dominance-group" :title="sourceTitle('CoinGecko', overview?.dominance)">
      <span class="metric-label">市占率</span> <span class="metric-value">BTC <strong class="btc-dominance">{{ percent(overview?.dominance.value?.btc) }}</strong></span>
      <span class="metric-value">ETH <strong class="eth-dominance">{{ percent(overview?.dominance.value?.eth) }}</strong></span><small v-if="overview?.dominance.stale">（待更新）</small>
    </span>
    <span class="metric-group etf-group">
      <span class="metric-label">ETF净流入</span>
      <span v-for="item in etfItems" :key="item.label" class="metric-group" :title="sourceTitle('The Block', item.metric)">
        {{ item.label }} <strong :class="{ 'flow-positive': (item.metric?.value?.usd ?? 0) > 0, 'flow-negative': (item.metric?.value?.usd ?? 0) < 0 }">{{ formatFlow(item.metric?.value?.usd) }}</strong>
        <small v-if="item.metric?.stale">（待更新）</small>
      </span>
    </span>
    <small v-if="etfDate" class="etf-date" title="ETF 来源数据日期">{{ etfDate }}</small>
    <small v-if="failed">连接异常</small>
  </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { MarketOverview, MarketMetric } from '../../types/market-overview'

const overview = ref<MarketOverview | null>(null)
const failed = ref(false)
const viewport = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const overflowing = ref(false)
const distance = ref(0)
const tickerStyle = computed(() => ({ '--ticker-distance': `${distance.value}px`, '--ticker-duration': `${Math.max(1, distance.value / 35)}s` }))
let resizeObserver: ResizeObserver | undefined

/** 只在单份内容超宽时启用双份无缝滚动，数据刷新和窗口变化后重新测量。 */
function measureTicker() {
  const content = track.value?.firstElementChild
  if (!content || !viewport.value) return
  const width = content.getBoundingClientRect().width
  overflowing.value = width > viewport.value.clientWidth
  distance.value = width + 32
}
watch([overview, failed], async () => { await nextTick(); measureTicker() })
const score = computed(() => overview.value?.fearGreed.value?.score)
const sentiment = computed(() => score.value === undefined ? '' : score.value <= 24 ? '极度恐慌' : score.value <= 44 ? '恐慌' : score.value <= 55 ? '中性' : score.value <= 74 ? '贪婪' : '极度贪婪')
// 颜色与情绪分类使用相同边界，保证数值和标签始终对应同一档位。
const sentimentColor = computed(() => score.value === undefined ? 'inherit' : score.value <= 24 ? '#f43f5e' : score.value <= 44 ? '#f59e0b' : score.value <= 55 ? '#eab308' : score.value <= 74 ? '#84cc16' : '#10b981')
// 暗色全局规则直接指定 color/background/border-color，必须同时覆盖实际属性，单改变量不生效。
const sentimentTagStyle = computed(() => ({
  color: sentimentColor.value,
  background: `color-mix(in srgb, ${sentimentColor.value} 12%, transparent)`,
  borderColor: `color-mix(in srgb, ${sentimentColor.value} 35%, transparent)`,
  '--el-tag-text-color': sentimentColor.value,
  '--el-tag-bg-color': `color-mix(in srgb, ${sentimentColor.value} 12%, transparent)`,
  '--el-tag-border-color': `color-mix(in srgb, ${sentimentColor.value} 35%, transparent)`,
}))
const percent = (value?: number) => value === undefined ? '--' : `${value.toFixed(2)}%`
const etfItems = computed(() => [
  { label: 'BTC', metric: overview.value?.btcEtf },
  { label: 'ETH', metric: overview.value?.ethEtf },
])
// 同日只展示一次日期；独立来源日期不一致时明确各自日期，避免误导。
const etfDate = computed(() => {
  const items = etfItems.value.filter(item => item.metric?.value)
  const dates = new Set(items.map(item => item.metric!.value!.date))
  return dates.size <= 1 ? [...dates][0] : items.map(item => `${item.label} ${item.metric!.value!.date}`).join(' / ')
})

/** 用美元及 M/B 展示单日有符号流量，缺失值不冒充零流入。 */
function formatFlow(value?: number) {
  if (value === undefined) return '--'
  const amount = Math.abs(value)
  const divisor = amount >= 1e9 ? 1e9 : 1e6
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}$${(amount / divisor).toFixed(2)}${divisor === 1e9 ? 'B' : 'M'}`
}

/** 来源与同步时间放在提示中，避免占用头部空间。 */
function sourceTitle(source: string, metric?: MarketMetric<unknown>) {
  const time = metric?.updatedAt ? new Date(metric.updatedAt).toLocaleString() : '尚未同步'
  const date = source === 'Alternative.me' && overview.value?.fearGreed.value
    ? `；指数日期：${new Date(overview.value.fearGreed.value.timestamp * 1000).toLocaleDateString()}` : ''
  return `来源：${source}；同步时间：${time}${date}${metric?.stale ? '；暂未更新，保留上次数据' : ''}${failed.value ? '；本站接口连接异常' : ''}`
}

let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false
/** 前端仅读本站缓存，请求完成后再安排下次轮询，避免慢请求重叠。 */
async function refresh() {
  try {
    overview.value = await $fetch<MarketOverview>('/api/market/overview', { timeout: 10_000, retry: 0 })
    failed.value = false
  } catch { failed.value = true }
  finally { if (!stopped) timer = setTimeout(refresh, 60_000) }
}
onMounted(() => {
  void refresh()
  resizeObserver = new ResizeObserver(measureTicker)
  if (viewport.value) resizeObserver.observe(viewport.value)
  if (track.value?.firstElementChild) resizeObserver.observe(track.value.firstElementChild)
  measureTicker()
})
onUnmounted(() => { stopped = true; clearTimeout(timer); resizeObserver?.disconnect() })
</script>

<style scoped>
.market-ticker { position: fixed; inset: auto 0 0; z-index: 2147483647; box-sizing: border-box; padding: 4px 10px calc(4px + env(safe-area-inset-bottom, 0px)); background: var(--bg-card); border-top: 1px solid var(--el-border-color-lighter); box-shadow: 0 -2px 10px #00000012; }
.ticker-viewport { overflow: hidden; }
.ticker-track { display: flex; width: max-content; min-width: 100%; gap: 32px; }
.market-overview { display: flex; flex: none; align-items: center; justify-content: center; gap: 12px; width: max-content; min-width: 100%; font-size: 12px; line-height: 18px; color: var(--text-regular); }
.scrolling .market-overview { min-width: 0; }
.ticker-track.scrolling { animation: ticker-scroll var(--ticker-duration) linear infinite; }
.ticker-viewport:hover .scrolling, .ticker-viewport:focus-within .scrolling { animation-play-state: paused; }
@keyframes ticker-scroll { to { transform: translateX(calc(-1 * var(--ticker-distance))); } }
.metric-group { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.etf-group { gap: 8px; }
.sentiment-tag.el-tag { height: 16px; padding: 0 4px; font-size: 10px; }
strong { font-variant-numeric: tabular-nums; color: var(--text-primary); }
/* 固定币种配色只用于市占率，避免与 ETF 净流入的正负颜色混淆。 */
.btc-dominance { color: #b85c00; }
.eth-dominance { color: #6952cc; }
:global(html.dark .btc-dominance) { color: #f7a644; }
:global(html.dark .eth-dominance) { color: #a99aff; }
.flow-positive { color: #67c23a; }
.flow-negative { color: #f56c6c; }
small { color: var(--text-secondary); font-size: 10px; }
.etf-date { color: var(--el-text-color-secondary, #909399); white-space: nowrap; }

/* 手机保持单行；安全区留白避免底部系统手势条遮挡指标。 */
@media (max-width: 600px) {
  .market-overview { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .ticker-track.scrolling { animation: none; }
  .scrolling .market-overview[aria-hidden="true"] { display: none; }
  .ticker-viewport { overflow-x: auto; }
}
</style>
