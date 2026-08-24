<template>
  <el-drawer
    v-model="visible"
    class="indicators-drawer"
    title="指标看板"
    direction="rtl"
    size="62%"
    destroy-on-close
  >
    <div class="toolbar">
      <el-radio-group v-model="timeframe" size="small" @change="fetchData">
        <el-radio-button v-for="item in timeframes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <el-button size="small" :loading="loading" @click="fetchData">
        <el-icon><ElIconRefresh /></el-icon>刷新
      </el-button>
    </div>

    <el-alert v-if="errorMessage" type="warning" :closable="false" show-icon>{{ errorMessage }}</el-alert>
    <el-table v-loading="loading" class="indicators-table" :data="rows" stripe size="small" style="width: 100%" @sort-change="handleSortChange">
      <el-table-column prop="symbol" label="交易对" fixed min-width="125">
        <template #default="{ row }">
          <div class="symbol-cell">
            <img
              v-if="!iconFailed[row.symbol] && coinIconUrl(row.symbol)"
              :src="coinIconUrl(row.symbol)"
              :alt="row.symbol"
              class="coin-icon"
              @error="onIconError(row.symbol)"
            >
            <span v-else class="coin-icon-placeholder" :style="{ backgroundColor: placeholderColor(row.symbol) }">
              {{ baseAsset(row.symbol).slice(0, 1) }}
            </span>
            <span>{{ row.symbol }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="价格 / K线" min-width="120">
        <template #default="{ row }">
          <div>{{ formatPrice(row.price) }}</div>
          <span :class="directionClass(row.closeChangePercent)">{{ signed(row.closeChangePercent) }}%</span>
          <span class="muted"> · {{ row.candleDirectionLabel }}</span>
        </template>
      </el-table-column>
      <el-table-column label="趋势" min-width="100">
        <template #default="{ row }">
          <div>ADX {{ format(row.adx) }}</div>
          <span :class="row.emaBullish ? 'up' : 'down'">EMA {{ row.emaBullish ? '多头' : '空头' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="RSI" min-width="75" sortable="custom" prop="rsi">
        <template #default="{ row }"><span :class="rsiClass(row.rsi)">{{ format(row.rsi) }}</span></template>
      </el-table-column>
      <el-table-column label="MACD 实时" min-width="225" sortable="custom" prop="macdHistogram">
        <template #default="{ row }">
          <div class="macd-cell">
            <div class="macd-state-line">
              <span class="macd-crossover" :class="crossoverClass(row.macdCrossover)">{{ crossoverLabel(row.macdCrossover) }}</span>
              <span class="macd-trend" :class="directionClass(row.macdHistogram)">
                柱 {{ histogramTrendIcon(row.macdHistogramTrend) }}
              </span>
              <el-tooltip placement="top" effect="dark">
                <template #content>
                  上组 M {{ formatMacd(row.previousMacd) }}<br>
                  S {{ formatMacd(row.previousMacdSignal) }} · H {{ formatSignedMacd(row.previousMacdHistogram) }}
                </template>
                <el-icon class="macd-history-icon"><ElIconInfoFilled /></el-icon>
              </el-tooltip>
            </div>
            <div class="macd-values current-values">
              <span>M {{ formatMacd(row.macd) }}</span>
              <span>S {{ formatMacd(row.macdSignal) }}</span>
              <span :class="directionClass(row.macdHistogram)">H {{ formatSignedMacd(row.macdHistogram) }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="ATR%" min-width="75" prop="atrPercent" sortable="custom">
        <template #default="{ row }">{{ format(row.atrPercent) }}%</template>
      </el-table-column>
      <el-table-column label="OI变化" min-width="80" prop="oiChangePercent" sortable="custom">
        <template #default="{ row }"><span :class="directionClass(row.oiChangePercent)">{{ signed(row.oiChangePercent) }}%</span></template>
      </el-table-column>
      <el-table-column label="预量比" min-width="80" prop="volumeRatio" sortable="custom">
        <template #default="{ row }">{{ format(row.volumeRatio) }}x</template>
      </el-table-column>
      <el-table-column label="进度%" min-width="80" prop="candleProgressPercent" sortable="custom">
        <template #default="{ row }">{{ format(row.candleProgressPercent) }}%</template>
      </el-table-column>
      <el-table-column label="情绪" min-width="50">
        <template #default="{ row }"><span :class="directionClass(row.sentiment)">{{ row.sentimentLabel }}</span></template>
      </el-table-column>
      <el-table-column label="数据" min-width="50">
        <template #default="{ row }"><span :class="row.stale ? 'down' : 'up'">{{ row.stale ? '偏旧' : '正常' }}</span></template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && rows.length === 0" description="暂无已配置交易对或指标数据" />
  </el-drawer>
</template>

<script setup lang="ts">
// ==================== 指标看板 ====================
import { computed, ref, watch } from 'vue'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'

/** 指标列表中的单个交易对展示数据。 */
interface IndicatorRow {
  symbol: string; price?: number; closeChangePercent?: number; candleDirectionLabel: string
  candleProgressPercent?: number
  adx?: number; rsi?: number; atrPercent?: number; oiChangePercent?: number
  macd?: number; macdSignal?: number; macdHistogram?: number
  previousMacd?: number; previousMacdSignal?: number; previousMacdHistogram?: number
  macdCrossover: 'golden' | 'dead' | 'none'; macdHistogramTrend: 'rising' | 'falling' | 'flat'
  volumeRatio?: number; sentiment?: number; sentimentLabel: string; emaBullish: boolean; stale: boolean
}

/** 指标抽屉的外部控制参数。 */
interface Props {
  modelValue: boolean
}

/** 指标抽屉向父组件同步开关状态的事件。 */
interface Emits {
  (event: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})
const botStore = useBotStore()
const { getCoinIconUrl } = useCoinIcon()
const iconFailed = ref<Record<string, boolean>>({})
const timeframe = ref('1h')
const timeframes = ['5m', '15m', '1h', '4h', '1d']
const rows = ref<IndicatorRow[]>([])
const loading = ref(false)
const errorMessage = ref('')
type SortOrder = 'ascending' | 'descending' | null
type SortProp = 'candleProgressPercent' | 'rsi' | 'macdHistogram' | 'atrPercent' | 'oiChangePercent' | 'volumeRatio' | null
const sortProp = ref<SortProp>(null)
const sortOrder = ref<SortOrder>(null)
const symbols = computed<string[]>(() => {
  const configuredSymbols = botStore.config?.symbols
  if (!Array.isArray(configuredSymbols)) return []
  return configuredSymbols.map((symbol: string) => symbol.replace('/', '').toUpperCase())
})

/** 拉取配置交易对的诊断指标；单个交易对失败不会阻塞其余行。 */
async function fetchData() {
  if (symbols.value.length === 0) { rows.value = []; return }
  loading.value = true; errorMessage.value = ''
  const results = await Promise.all(symbols.value.map(async (symbol: string) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', { query: { symbol, timeframe: timeframe.value, includeSlowStats: 'false' } })
      return toRow(response.data)
    } catch { return null }
  }))
  rows.value = results.filter(Boolean) as IndicatorRow[]
  applySort()
  if (rows.value.length === 0) errorMessage.value = '指标暂不可用，请确认指标中心已完成初始化'
  loading.value = false

  // 首屏不再等待 OI 历史和币安广场分页请求；慢字段在表格显示后后台补齐。
  void enrichSlowStats()
}

/** 后台补齐 OI 与广场情绪，避免慢外部请求阻塞首屏表格。 */
async function enrichSlowStats() {
  const pendingRows = [...rows.value]
  await Promise.all(pendingRows.map(async (row) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', {
        query: { symbol: row.symbol, timeframe: timeframe.value, includeSlowStats: 'true' }
      })
      const next = toRow(response.data)
      const index = rows.value.findIndex(item => item.symbol === row.symbol)
      const current = index >= 0 ? rows.value[index] : undefined
      if (current) {
        rows.value[index] = {
          ...current,
          oiChangePercent: next.oiChangePercent,
          sentiment: next.sentiment,
          sentimentLabel: next.sentimentLabel
        }
      }
    } catch {
      // 慢统计失败不影响技术指标首屏展示。
    }
  }))
}

/** 按表格当前排序条件排列指标；缺失值始终置底，避免 -- 干扰数值排序。 */
function applySort() {
  if (!sortProp.value || !sortOrder.value) return
  const direction = sortOrder.value === 'ascending' ? 1 : -1
  const prop = sortProp.value
  rows.value.sort((left, right) => {
    const leftValue = left[prop]
    const rightValue = right[prop]
    const leftValid = typeof leftValue === 'number' && Number.isFinite(leftValue)
    const rightValid = typeof rightValue === 'number' && Number.isFinite(rightValue)
    if (!leftValid || !rightValid) return leftValid === rightValid ? 0 : leftValid ? -1 : 1
    return (leftValue - rightValue) * direction
  })
}

/** 接收 Element Plus 的自定义排序事件，并在当前已加载数据上即时排序。 */
function handleSortChange({ prop, order }: { prop?: string | null; order?: string | null }) {
  sortProp.value = (['candleProgressPercent', 'rsi', 'macdHistogram', 'atrPercent', 'oiChangePercent', 'volumeRatio'] as string[]).includes(prop || '')
    ? prop as SortProp
    : null
  sortOrder.value = order === 'ascending' || order === 'descending' ? order : null
  applySort()
}

/** 将完整诊断结果转换为适合横向比较的列表字段。 */
function toRow(data: any): IndicatorRow {
  const values = (name: string) => data?.indicators?.[name]?.values || {}
  const ema = values('ema').emaMap || {}
  const price = Number(data?.kline?.latest?.close)
  const atr = Number(values('atr').atr)
  const macd = values('macd')
  const heat = values('squareHeat')
  const sentiment = Number(heat.netDirectionalSentimentPercent ?? heat.changePercent)
  return {
    symbol: data.symbol, price, closeChangePercent: Number(data.kline?.closeChangePercent),
    candleProgressPercent: Number(data.kline?.candleProgressPercent),
    candleDirectionLabel: data.kline?.candleDirection === 'bullish' ? '阳线' : data.kline?.candleDirection === 'bearish' ? '阴线' : '平',
    adx: Number(values('adx').adx), rsi: Number(values('rsi').rsi),
    macd: Number(macd.macd), macdSignal: Number(macd.signal), macdHistogram: Number(macd.histogram),
    previousMacd: Number(macd.previousMacd), previousMacdSignal: Number(macd.previousSignal), previousMacdHistogram: Number(macd.previousHistogram),
    macdCrossover: normalizeCrossover(macd.crossover), macdHistogramTrend: normalizeHistogramTrend(macd.histogramTrend),
    atrPercent: price > 0 ? atr / price * 100 : undefined, oiChangePercent: Number(values('oi').changePercent),
    volumeRatio: Number(values('volume').ratio), sentiment, sentimentLabel: Number.isFinite(sentiment) ? (sentiment > 0 ? '偏多' : sentiment < 0 ? '偏空' : '中性') : '--',
    // dataAgeMs 由服务端按最近一次成功写入时间计算，不再使用 K 线开盘时间。
    emaBullish: Number(ema.EMA14) >= Number(ema.EMA50), stale: Number(data?.kline?.dataAgeMs) > 2 * 60 * 60 * 1000
  }
}

function format(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toFixed(2) }
function signed(value?: number) { return value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}` }
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 }) }
function directionClass(value?: number) { return value == null ? 'muted' : value >= 0 ? 'up' : 'down' }
function rsiClass(value?: number) { return value != null && value >= 70 ? 'down' : value != null && value <= 30 ? 'up' : 'muted' }

/** 将不同交易对写法统一为图标清单使用的 Binance symbol。 */
function coinIconUrl(symbol: string) {
  return getCoinIconUrl(symbol.replace('/', '')) || ''
}

function onIconError(symbol: string) {
  iconFailed.value[symbol] = true
}

function baseAsset(symbol: string) {
  return symbol.replace('/', '').replace(/(USDT|USDC|FDUSD|BUSD)$/, '').toUpperCase()
}

/** 为缺少官方图标的交易对生成稳定的占位颜色。 */
function placeholderColor(symbol: string) {
  let hash = 0
  for (const character of baseAsset(symbol)) {
    hash = character.charCodeAt(0) + ((hash << 5) - hash)
  }
  return `hsl(${Math.abs(hash) % 360} 48% 42%)`
}

/** MACD 根据绝对值自适应精度，避免低价格标的被显示为 0.00。 */
function formatMacd(value?: number) {
  if (value == null || !Number.isFinite(value)) return '--'
  const absolute = Math.abs(value)
  const digits = absolute >= 1000 ? 2 : absolute >= 1 ? 4 : absolute >= 0.01 ? 5 : 7
  return value.toFixed(digits)
}

/** 为柱体保留正负号，便于快速分辨零轴方向。 */
function formatSignedMacd(value?: number) {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${formatMacd(value)}`
}

function normalizeCrossover(value: unknown): IndicatorRow['macdCrossover'] {
  return value === 'golden' || value === 'dead' ? value : 'none'
}

function normalizeHistogramTrend(value: unknown): IndicatorRow['macdHistogramTrend'] {
  return value === 'rising' || value === 'falling' ? value : 'flat'
}

function crossoverLabel(value: IndicatorRow['macdCrossover']) {
  return value === 'golden' ? '金叉' : value === 'dead' ? '死叉' : '无交叉'
}

function crossoverClass(value: IndicatorRow['macdCrossover']) {
  return value === 'golden' ? 'up' : value === 'dead' ? 'down' : 'muted'
}

function histogramTrendIcon(value: IndicatorRow['macdHistogramTrend']) {
  return value === 'rising' ? '↑' : value === 'falling' ? '↓' : '→'
}

watch(() => symbols.value.join(','), () => {
  if (visible.value) fetchData()
})
watch(visible, value => {
  if (value) fetchData()
})
</script>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.up { color: var(--el-color-success); }.down { color: var(--el-color-danger); }.muted { color: var(--el-text-color-secondary); }
.symbol-cell { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.coin-icon, .coin-icon-placeholder { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%; }
.coin-icon { display: block; object-fit: cover; }
.coin-icon-placeholder { display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
.macd-cell { display: flex; flex-direction: column; gap: 3px; min-width: 205px; line-height: 1.35; }
.macd-state-line, .macd-values { display: grid; align-items: center; column-gap: 8px; }
.macd-state-line { grid-template-columns: 52px minmax(0, 1fr) 16px; }
.macd-values { grid-template-columns: repeat(3, minmax(0, 1fr)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.macd-crossover { font-weight: 600; }
.macd-trend { white-space: nowrap; }
.macd-history-icon { color: var(--text-secondary); cursor: help; }
.current-values { color: var(--text-primary); }

/* 抽屉会 Teleport 到 body，使用全局选择器让亮暗主题变量在弹层中完整生效。 */
:global(.indicators-drawer) {
  --el-drawer-bg-color: var(--bg-card);
  background: var(--bg-card);
  color: var(--text-regular);
  border-left: 1px solid var(--border-color);
}

:global(.indicators-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding-bottom: 16px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

:global(.indicators-drawer .el-drawer__title) {
  color: var(--text-primary);
  font-weight: 600;
}

:global(.indicators-drawer .el-drawer__close-btn) {
  color: var(--text-secondary);
}

:global(.indicators-drawer .el-drawer__close-btn:hover) {
  color: var(--color-primary);
}

:global(.indicators-drawer .el-drawer__body) {
  background: var(--bg-card);
  color: var(--text-regular);
}

:global(.indicators-drawer .indicators-table) {
  /* 加载遮罩沿用表格卡片背景，避免暗色主题下出现 Element Plus 默认白底。 */
  --el-mask-color: var(--bg-card);
  --el-table-header-bg-color: var(--bg-table-header);
  --el-table-header-text-color: var(--text-primary);
  --el-table-border-color: var(--border-color);
  --el-table-bg-color: var(--bg-card);
  --el-table-tr-bg-color: var(--bg-card);
  --el-table-row-hover-bg-color: var(--bg-hover);
  --el-table-text-color: var(--text-regular);
}

:global(.indicators-drawer .el-empty__description p) {
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  /* 手机端占满屏幕，保持与日志抽屉一致的操作体验。 */
  :global(.indicators-drawer) {
    width: 100% !important;
  }
}
</style>
