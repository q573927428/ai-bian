<template>
  <el-drawer
    v-model="visible"
    class="indicators-drawer"
    title="指标看板"
    direction="rtl"
    size="75%"
    destroy-on-close
  >
    <div class="toolbar">
      <el-radio-group v-model="timeframe" size="small" @change="fetchData">
        <el-radio-button v-for="item in timeframes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="signalFilter" size="small" aria-label="五周期方向筛选">
        <el-radio-button value="全部">全部</el-radio-button>
        <el-radio-button value="做多">多头</el-radio-button>
        <el-radio-button value="做空">空头</el-radio-button>
        <el-radio-button value="观望">观望</el-radio-button>
      </el-radio-group>
      <el-button class="refresh-button" size="small" :loading="loading" @click="fetchData">
        <el-icon><ElIconRefresh /></el-icon>刷新
      </el-button>
    </div>

    <el-alert v-if="errorMessage" type="warning" :closable="false" show-icon>{{ errorMessage }}</el-alert>
    <el-table v-loading="loading" class="indicators-table" :data="filteredRows" :empty-text="rows.length ? '当前筛选下暂无交易对' : '暂无已配置交易对或指标数据'" stripe size="small" style="width: 100%" @sort-change="handleSortChange">
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
          <div class="resonance" :class="signalClass(resonanceSignal(row.symbol))" :title="resonanceTitle(row.symbol)" :aria-label="resonanceTitle(row.symbol)">
            <!-- 方向与增强/减弱分开展示，避免把趋势回调误读为没有方向。 -->
            <span
              v-for="period in timeframes"
              :key="period"
              class="resonance-dot"
              :class="periodTrendClass(periodSignals[row.symbol]?.[period])"
              :title="`${period}：${periodSignals[row.symbol]?.[period] ?? '暂无数据'}`"
            ></span>
            <span v-if="resonanceSignal(row.symbol) !== '观望'" class="resonance-label">{{ resonanceSignal(row.symbol) === '做多' ? '多头' : '空头' }}</span>
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
          <div class="up">PDI {{ format(row.pdi) }}</div>
          <div class="down">MDI {{ format(row.mdi) }}</div>
          <span :class="[row.diDirection.startsWith('多头') ? 'up' : row.diDirection.startsWith('空头') ? 'down' : 'muted', { 'macd-weakening': row.diDirection.endsWith('减弱') }]">{{ row.diDirection }}</span>
        </template>
      </el-table-column>
      <el-table-column label="EMA" min-width="120">
        <template #default="{ row }">
          <div>EMA{{ row.fastEmaPeriod }} {{ formatPrice(row.fastEma) }}</div>
          <div>EMA{{ row.slowEmaPeriod }} {{ formatPrice(row.slowEma) }}</div>
          <span :class="row.emaBullish == null ? 'muted' : row.emaBullish ? 'up' : 'down'">{{ row.emaBullish == null ? '--' : row.emaBullish ? '多头' : '空头' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="RSI" min-width="70" sortable="custom" prop="rsi">
        <template #default="{ row }"><span :class="rsiClass(row.rsi)">{{ format(row.rsi) }}</span></template>
      </el-table-column>
      <el-table-column label="MACD 实时" min-width="320" sortable="custom" prop="macdHistogram">
        <template #default="{ row }">
          <div class="macd-cell">
            <div class="macd-state-line">
              <span class="macd-crossover" :class="crossoverClass(row.macdCrossover)">{{ crossoverLabel(row.macdCrossover) }}</span>
              <span class="macd-trend" :class="directionClass(row.macdHistogram)">
                柱 {{ histogramTrendIcon(row.macdHistogramTrend) }}
              </span>
              <span class="macd-result" :class="macdResultClass(row.macdHistogram, row.previousMacdHistogram)">{{ macdResult(row.macdHistogram, row.previousMacdHistogram) }}</span>
            </div>
            <div class="macd-values macd-heading">
              <span></span><span>M</span><span>S</span><span>H</span>
            </div>
            <div class="macd-values macd-data-row current-values">
              <span class="macd-row-label">当前</span>
              <span>{{ formatMacd(row.macd) }}</span>
              <span>{{ formatMacd(row.macdSignal) }}</span>
              <span :class="directionClass(row.macdHistogram)">{{ formatSignedMacd(row.macdHistogram) }}</span>
              <span class="macd-row-chart" aria-hidden="true">
                <span class="macd-chart-bar" :class="directionClass(row.macdHistogram)" :style="histogramBarStyle(row.macdHistogram, row.previousMacdHistogram)"></span>
              </span>
            </div>
            <div class="macd-values macd-data-row previous-values">
              <span class="macd-row-label">上组</span>
              <span>{{ formatMacd(row.previousMacd) }}</span>
              <span>{{ formatMacd(row.previousMacdSignal) }}</span>
              <span>{{ formatSignedMacd(row.previousMacdHistogram) }}</span>
              <span class="macd-row-chart" aria-hidden="true">
                <span class="macd-chart-bar" :class="directionClass(row.previousMacdHistogram)" :style="histogramBarStyle(row.previousMacdHistogram, row.macdHistogram)"></span>
              </span>
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
      <el-table-column label="社区情绪" min-width="70">
        <template #default="{ row }"><span :class="sentimentClass(row.sentiment)">{{ row.sentimentLabel }}</span></template>
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
  /** ADX 方向指标及基于后端 DI 差距变化得出的趋势信号。 */
  pdi?: number; mdi?: number; diDirection: '多头增强' | '多头减弱' | '空头减弱' | '空头增强' | '中性' | '--'
  /** EMA 周期与数值，以及短周期相对长周期的方向。 */
  fastEmaPeriod: number; slowEmaPeriod: number; fastEma?: number; slowEma?: number; emaBullish?: boolean
  macd?: number; macdSignal?: number; macdHistogram?: number
  previousMacd?: number; previousMacdSignal?: number; previousMacdHistogram?: number
  macdCrossover: 'golden' | 'dead' | 'none'; macdHistogramTrend: 'rising' | 'falling' | 'flat'
  volumeRatio?: number; sentiment?: number; sentimentLabel: string; stale: boolean
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
type TradeSignal = '做多' | '做空' | '观望'
const signalFilter = ref<TradeSignal | '全部'>('全部')
// 筛选与交易对下方的一致性文字使用同一规则，随后台五周期数据更新。
const filteredRows = computed(() => signalFilter.value === '全部'
  ? rows.value
  : rows.value.filter(row => resonanceSignal(row.symbol) === signalFilter.value))
const periodSignals = ref<Record<string, Partial<Record<string, IndicatorRow['diDirection']>>>>({})
let fetchVersion = 0
type SortOrder = 'ascending' | 'descending' | null
type SortProp = 'candleProgressPercent' | 'rsi' | 'macdHistogram' | 'atrPercent' | 'oiChangePercent' | 'volumeRatio' | null
const sortProp = ref<SortProp>(null)
const sortOrder = ref<SortOrder>(null)
const symbols = computed<string[]>(() => {
  const configuredSymbols = botStore.config?.symbols
  if (!Array.isArray(configuredSymbols)) return []
  return configuredSymbols.map((symbol: string) => symbol.replace('/', '').toUpperCase())
})

// 指标看板使用机器人配置中的周期；配置缺失时与服务端默认周期保持一致。
const emaPeriods = computed<[number, number]>(() => {
  const periods = botStore.botConfig?.emaPeriods
  const fast = periods?.[0]
  const slow = periods?.[1]
  return fast != null && slow != null
    && Number.isInteger(fast) && fast >= 2 && fast <= 500
    && Number.isInteger(slow) && slow >= 2 && slow <= 500 && fast !== slow
    ? [fast, slow]
    : [20, 60]
})

/** 拉取配置交易对的诊断指标；单个交易对失败不会阻塞其余行。 */
async function fetchData() {
  const version = ++fetchVersion
  if (!botStore.botConfig) await botStore.fetchBotConfig()
  if (version !== fetchVersion) return
  periodSignals.value = {}
  if (symbols.value.length === 0) { rows.value = []; loading.value = false; return }
  loading.value = true; errorMessage.value = ''
  const requestedTimeframe = timeframe.value
  const requestedEmaPeriods = [...emaPeriods.value]
  const results = await Promise.all(symbols.value.map(async (symbol: string) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', { query: { symbol, timeframe: requestedTimeframe, emaPeriods: requestedEmaPeriods.join(','), includeSlowStats: 'false' } })
      return toRow(response.data)
    } catch { return null }
  }))
  // 切换周期或连续刷新时，旧请求不得覆盖最新表格及共振状态。
  if (version !== fetchVersion) return
  rows.value = results.filter(Boolean) as IndicatorRow[]
  for (const row of rows.value) {
    periodSignals.value[row.symbol] = { [requestedTimeframe]: combinedPeriodTrend(row) }
  }
  applySort()
  if (rows.value.length === 0) errorMessage.value = '指标暂不可用，请确认指标中心已完成初始化'
  loading.value = false

  // 首屏不再等待 OI 历史和币安广场分页请求；慢字段在表格显示后后台补齐。
  void enrichSlowStats(version, requestedTimeframe)
  void fetchResonance(version, requestedTimeframe, requestedEmaPeriods)
}

/** 后台补齐另外四个周期，复用当前周期数据，避免共振请求阻塞首屏。 */
async function fetchResonance(version: number, selectedTimeframe: string, periods: number[]) {
  await Promise.all(symbols.value.map(async symbol => {
    await Promise.all(timeframes.filter(period => period !== selectedTimeframe).map(async period => {
      try {
        const response: any = await $fetch('/api/bot/indicators', {
          query: { symbol, timeframe: period, emaPeriods: periods.join(','), includeSlowStats: 'false' }
        })
        if (version !== fetchVersion) return
        periodSignals.value[symbol] = { ...periodSignals.value[symbol], [period]: combinedPeriodTrend(toRow(response.data)) }
      } catch {
        // 请求失败保留缺失状态，不能将不完整数据判为五周期共振。
      }
    }))
  }))
}

/** 趋势与 MACD 同向才保留方向；只有两者都增强才显示强色。 */
function combinedPeriodTrend(row: IndicatorRow): IndicatorRow['diDirection'] {
  const trend = row.diDirection
  const macd = macdResult(row.macdHistogram, row.previousMacdHistogram)
  if (trend === '--' || macd === '--') return '--'
  if (trend.startsWith('多头') && macd.startsWith('多头')) {
    return trend === '多头增强' && macd === '多头增强' ? '多头增强' : '多头减弱'
  }
  if (trend.startsWith('空头') && macd.startsWith('空头')) {
    return trend === '空头增强' && macd === '空头增强' ? '空头增强' : '空头减弱'
  }
  return '中性'
}

/** 五周期的趋势与 MACD 均同向时提示方向一致，不作为入场信号。 */
function resonanceSignal(symbol: string): TradeSignal {
  const signals = timeframes.map(period => periodSignals.value[symbol]?.[period])
  if (signals.every(signal => signal?.startsWith('多头'))) return '做多'
  if (signals.every(signal => signal?.startsWith('空头'))) return '做空'
  return '观望'
}

/** 用颜色表达趋势与 MACD 共同确认的方向，非双增强状态使用淡色。 */
function periodTrendClass(trend?: IndicatorRow['diDirection']) {
  const direction = trend?.startsWith('多头') ? 'up' : trend?.startsWith('空头') ? 'down' : 'muted'
  return [direction, { 'trend-weakening': trend?.endsWith('减弱') === true }]
}

/** 悬停说明圆点顺序与各周期状态，缺失数据不伪装成观望。 */
function resonanceTitle(symbol: string) {
  return timeframes.map(period => `${period}：${periodSignals.value[symbol]?.[period] ?? '暂无数据'}`).join(' / ')
}

function signalClass(signal: TradeSignal) {
  return signal === '做多' ? 'up' : signal === '做空' ? 'down' : 'muted'
}

/** 后台补齐 OI 与广场情绪，避免慢外部请求阻塞首屏表格。 */
async function enrichSlowStats(version: number, requestedTimeframe: string) {
  const pendingRows = [...rows.value]
  await Promise.all(pendingRows.map(async (row) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', {
        query: { symbol: row.symbol, timeframe: requestedTimeframe, emaPeriods: emaPeriods.value.join(','), includeSlowStats: 'true' }
      })
      if (version !== fetchVersion) return
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
  const [fastPeriod, slowPeriod] = data?.parameters?.emaPeriods || emaPeriods.value
  const fastEma = ema[`EMA${fastPeriod}`] == null ? undefined : Number(ema[`EMA${fastPeriod}`])
  const slowEma = ema[`EMA${slowPeriod}`] == null ? undefined : Number(ema[`EMA${slowPeriod}`])
  const price = Number(data?.kline?.latest?.close)
  const atr = Number(values('atr').atr)
  const adx = values('adx')
  const pdi = adx.pdi == null ? undefined : Number(adx.pdi)
  const mdi = adx.mdi == null ? undefined : Number(adx.mdi)
  const macd = values('macd')
  const heat = values('squareHeat')
  const sentiment = Number(heat.netDirectionalSentimentPercent ?? heat.changePercent)
  return {
    symbol: data.symbol, price, closeChangePercent: Number(data.kline?.closeChangePercent),
    candleProgressPercent: Number(data.kline?.candleProgressPercent),
    candleDirectionLabel: data.kline?.candleDirection === 'bullish' ? '阳线' : data.kline?.candleDirection === 'bearish' ? '阴线' : '平',
    adx: Number(adx.adx), rsi: Number(values('rsi').rsi),
    pdi, mdi, diDirection: diTrendSignal(adx.diSpread, adx.diGapChange),
    fastEmaPeriod: fastPeriod, slowEmaPeriod: slowPeriod, fastEma, slowEma,
    macd: Number(macd.macd), macdSignal: Number(macd.signal), macdHistogram: Number(macd.histogram),
    previousMacd: Number(macd.previousMacd), previousMacdSignal: Number(macd.previousSignal), previousMacdHistogram: Number(macd.previousHistogram),
    macdCrossover: normalizeCrossover(macd.crossover), macdHistogramTrend: normalizeHistogramTrend(macd.histogramTrend),
    atrPercent: price > 0 ? atr / price * 100 : undefined, oiChangePercent: Number(values('oi').changePercent),
    volumeRatio: Number(values('volume').ratio), sentiment, sentimentLabel: Number.isFinite(sentiment) ? (sentiment > 0 ? '偏多' : sentiment < 0 ? '偏空' : '中性') : '--',
    // dataAgeMs 由服务端按最近一次成功写入时间计算，不再使用 K 线开盘时间。
    emaBullish: fastEma == null || slowEma == null || !Number.isFinite(fastEma) || !Number.isFinite(slowEma)
      ? undefined : fastEma >= slowEma,
    stale: Number(data?.kline?.dataAgeMs) > 2 * 60 * 60 * 1000
  }
}

/** 与后端 AI 信号保持一致：当前优势侧配合绝对差距变化，缺失数据不视为中性。 */
function diTrendSignal(spread: unknown, gapChange: unknown): IndicatorRow['diDirection'] {
  if (typeof spread !== 'number' || typeof gapChange !== 'number'
    || !Number.isFinite(spread) || !Number.isFinite(gapChange)) return '--'
  if (spread === 0 || gapChange === 0) return '中性'
  if (spread > 0) return gapChange > 0 ? '多头增强' : '多头减弱'
  return gapChange > 0 ? '空头增强' : '空头减弱'
}

function format(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toFixed(2) }
function signed(value?: number) { return value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}` }
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 }) }
function directionClass(value?: number) { return value == null ? 'muted' : value >= 0 ? 'up' : 'down' }
/** 情绪中性时使用灰色，避免将零值误解为偏多。 */
function sentimentClass(value?: number) { return value == null || !Number.isFinite(value) ? 'muted' : value > 0 ? 'up' : value < 0 ? 'down' : 'muted' }
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

/** 两组 H 共用同一比例尺，零轴位于轨道中央。 */
function histogramBarStyle(value?: number, other?: number) {
  if (value == null || !Number.isFinite(value)) return { width: '0%' }
  const maximum = Math.max(Math.abs(value), other != null && Number.isFinite(other) ? Math.abs(other) : 0)
  const width = maximum === 0 ? 0 : Math.abs(value) / maximum * 50
  return { left: `${value < 0 ? 50 - width : 50}%`, width: `${width}%` }
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
  return value === 'rising' ? '↗' : value === 'falling' ? '↘' : '→'
}

/** H 的正负表示当前多空动能方向，与上组比较表示动能增强或减弱。 */
function macdResult(current?: number, previous?: number) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return '--'
  if (current === 0) return '动能中性'
  if (current === previous) return current > 0 ? '多头持平' : '空头持平'
  if (current > 0) return current > previous ? '多头增强' : '多头减弱'
  return current < previous ? '空头增强' : '空头减弱'
}

function macdResultClass(current?: number, previous?: number) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || current === 0 || current === previous) return 'muted'
  const strengthening = current > 0 ? current > previous : current < previous
  return strengthening ? directionClass(current) : `${directionClass(current)} macd-weakening`
}

watch(() => symbols.value.join(','), () => {
  if (visible.value) fetchData()
})
watch(() => emaPeriods.value.join(','), () => {
  if (visible.value) fetchData()
})
watch(visible, value => {
  if (value) fetchData()
})
</script>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.refresh-button { margin-left: auto; }
.up { color: var(--el-color-success); }.down { color: var(--el-color-danger); }.muted { color: var(--el-text-color-secondary); }
.symbol-cell { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.resonance { display: grid; grid-template-columns: repeat(5, 8px); align-items: center; gap: 3px; margin-top: 6px; padding-left: 25px; min-height: 12px; font-size: 11px; }
.resonance-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 3px; background: currentColor; }
.resonance-dot.trend-weakening { opacity: .4; }
.resonance-label { grid-column: 1 / -1; white-space: nowrap; }
.coin-icon, .coin-icon-placeholder { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%; }
.coin-icon { display: block; object-fit: cover; }
.coin-icon-placeholder { display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
.macd-cell { display: flex; flex-direction: column; gap: 3px; min-width: 296px; line-height: 1.35; }
.macd-state-line, .macd-values { display: grid; align-items: center; column-gap: 6px; }
.macd-state-line { grid-template-columns: 55px 52px minmax(0, 1fr); }
.macd-values { grid-template-columns: 28px repeat(3, minmax(0, 1fr)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.macd-values > span:not(:first-child) { text-align: right; }
.macd-crossover { font-weight: 600; }
.macd-trend { white-space: nowrap; }
.macd-result { white-space: nowrap; font-weight: 600; }
.macd-weakening { opacity: .6; }
.macd-heading, .macd-row-label, .previous-values { color: var(--text-secondary); }
.current-values { color: var(--text-primary); }
.macd-data-row { position: relative; min-height: 20px; }
.macd-data-row > span:not(.macd-row-chart) { position: relative; z-index: 1; }
.macd-row-chart { position: absolute; left: 36px; right: 0; top: 1px; bottom: 1px; pointer-events: none; }
.macd-row-chart::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--text-secondary); opacity: .45; }
.macd-chart-bar { position: absolute; top: 0; height: 100%; background: currentColor; opacity: .18; }
.previous-values .macd-chart-bar { opacity: .12; }

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
  .refresh-button { margin-left: 0; }

  /* 手机端占满屏幕，保持与日志抽屉一致的操作体验。 */
  :global(.indicators-drawer) {
    width: 100% !important;
  }
}
</style>
