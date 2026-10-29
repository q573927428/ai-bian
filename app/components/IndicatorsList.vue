<template>
  <component
    :is="embedded ? 'section' : ElDrawer"
    v-model="visible"
    class="indicators-drawer"
    title="指标看板"
    direction="rtl"
    size="max(75vw, min(100vw, 1320px))"
    destroy-on-close
  >
    <div class="toolbar">
      <el-radio-group v-model="timeframe" size="small" @change="fetchData">
        <el-radio-button v-for="item in timeframes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="signalFilter" size="small" aria-label="五周期方向筛选">
        <el-radio-button value="全部">全部</el-radio-button>
        <el-radio-button value="多头">多头背景</el-radio-button>
        <el-radio-button value="空头">空头背景</el-radio-button>
        <el-radio-button value="反转">反转观察</el-radio-button>
        <el-radio-button value="观望">分歧观望</el-radio-button>
      </el-radio-group>
      <el-input v-model="symbolSearch" class="symbol-search" size="small" placeholder="搜索交易对" aria-label="搜索交易对" clearable>
        <template #prefix><el-icon><ElIconSearch /></el-icon></template>
      </el-input>
      <el-button class="refresh-button" size="small" :loading="loading" @click="fetchData">
        <el-icon><ElIconRefresh /></el-icon>刷新
      </el-button>
    </div>

    <el-alert v-if="errorMessage" type="warning" :closable="false" show-icon>{{ errorMessage }}</el-alert>
    <el-table v-loading="loading" class="indicators-table" height="100%" :data="filteredRows" row-key="symbol" :current-row-key="selectedSymbol" :row-class-name="selectedRowClass" :highlight-current-row="embedded" :empty-text="rows.length ? '当前筛选下暂无交易对' : '暂无已配置交易对或指标数据'" stripe size="small" style="width: 100%" @sort-change="handleSortChange" @row-click="handleRowClick">
      <el-table-column label="" type="index" align="center" header-align="center" width="35" fixed="left" />
      <el-table-column prop="symbol" label="交易对" fixed min-width="110">
        <template #default="{ row }">
          <button type="button" class="symbol-cell symbol-link" :title="`查看 ${row.symbol} ${timeframe} 图表`" @click.stop="selectChart(row.symbol)">
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
          </button>
          <div class="resonance" :class="signalClass(resonanceInfo(row.symbol).tone)" :title="resonanceTitle(row.symbol)" :aria-label="resonanceTitle(row.symbol)">
            <!-- 方向与增强/减弱分开展示，避免把趋势回调误读为没有方向。 -->
            <span
              v-for="period in timeframes"
              :key="period"
              class="resonance-dot"
              :class="periodTrendClass(periodSignals[row.symbol]?.[period])"
              :title="`${period}：${periodSignals[row.symbol]?.[period] ?? '暂无数据'}`"
            ></span>
            <span class="resonance-label">{{ resonanceInfo(row.symbol).label }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="价格 / K线" min-width="90">
        <template #default="{ row }">
          <div>{{ formatPrice(row.price) }}</div>
          <span :class="directionClass(row.closeChangePercent)">{{ signed(row.closeChangePercent) }}%</span>
          <span class="muted"> · {{ row.candleDirectionLabel }}</span>
        </template>
      </el-table-column>
      <el-table-column label="趋势" min-width="115">
        <template #default="{ row }">
          <div class="adx-line">
            <span>ADX {{ format(row.adx) }}</span>
            <el-tooltip placement="top">
              <template #content>
                <div v-for="(line, index) in adxSlopeTooltip(row.adxSlope, row.adxSlopePeriod).split('\n')" :key="index">{{ line }}</div>
              </template>
              <span :class="row.adxSlope == null || row.adxSlope === 0 ? 'muted' : directionClass(row.adxSlope)"> {{ formatAdxSlope(row.adxSlope) }}</span>
            </el-tooltip>
          </div>
          <div class="up">PDI {{ format(row.pdi) }}</div>
          <div class="down">MDI {{ format(row.mdi) }}</div>
          <span :class="[row.diDirection.startsWith('多头') ? 'up' : row.diDirection.startsWith('空头') ? 'down' : 'muted', { 'macd-weakening': row.diDirection.endsWith('减弱') }]">{{ row.diDirection }}</span>
        </template>
      </el-table-column>
      <el-table-column label="实时支撑 / 阻力" min-width="175">
        <template #default="{ row }">
          <SupportResistanceInfo :snapshot="row.supportResistance" />
        </template>
      </el-table-column>
      <el-table-column label="EMA" min-width="105">
        <template #default="{ row }">
          <div>EMA{{ row.fastEmaPeriod }} {{ formatPrice(row.fastEma) }}</div>
          <div>EMA{{ row.slowEmaPeriod }} {{ formatPrice(row.slowEma) }}</div>
          <span :class="row.emaBullish == null ? 'muted' : row.emaBullish ? 'up' : 'down'">{{ row.emaBullish == null ? '--' : row.emaBullish ? '多头' : '空头' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="RSI" align="center" header-align="center" min-width="55" sortable="custom" prop="rsi">
        <template #default="{ row }"><span :class="rsiClass(row.rsi)">{{ format(row.rsi) }}</span></template>
      </el-table-column>
      <el-table-column label="MACD 实时" min-width="210" sortable="custom" prop="macdHistogram">
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
      <el-table-column label="OI变化" align="center" header-align="center" min-width="70" prop="oiChangePercent" sortable="custom">
        <template #default="{ row }">
          <el-tooltip placement="top">
            <template #content>
              <div v-for="(line, index) in row.oiTooltip.split('\n')" :key="index">{{ line }}</div>
            </template>
            <div class="oi-cell">
              <div :class="directionClass(row.oiChangePercent)">{{ signed(row.oiChangePercent) }}{{ row.oiChangePercent == null ? '' : '%' }}</div>
              <div class="muted">{{ row.oiChangeLabel }}</div>
            </div>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="预量比" align="center" header-align="center" min-width="68" prop="volumeRatio" sortable="custom">
        <template #default="{ row }">{{ format(row.volumeRatio) }}x</template>
      </el-table-column>
      <el-table-column label="资金流" width="145" prop="netInflowPercent" sortable="custom">
        <template #default="{ row }">
          <el-tooltip placement="top">
            <template #content>
              <div v-for="(line, index) in [row.moneyFlowTooltip, row.cumulativeFlowTooltip].join('\n').split('\n')" :key="index">{{ line }}</div>
            </template>
            <div class="flow-cell">
              <div class="flow-row">
                <span class="muted">本根</span>
                <span>{{ formatFlowAmount(row.netInflow) }}</span>
                <span :class="flowDirectionClass(row.netInflowPercent)">{{ signed(row.netInflowPercent) }}{{ row.netInflowPercent == null ? '' : '%' }}</span>
              </div>
              <div class="flow-row flow-secondary">
                <span class="muted">5根</span>
                <span>{{ formatFlowAmount(row.cumulativeNetInflow) }}</span>
                <span :class="flowDirectionClass(row.cumulativeNetInflowPercent)">{{ signed(row.cumulativeNetInflowPercent) }}{{ row.cumulativeNetInflowPercent == null ? '' : '%' }}</span>
              </div>
            </div>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="ATR%" align="center" header-align="center" min-width="68" prop="atrPercent" sortable="custom">
        <template #default="{ row }">{{ format(row.atrPercent) }}%</template>
      </el-table-column>
      <el-table-column label="社区情绪" min-width="80">
        <template #default="{ row }">
          <el-tooltip placement="top">
            <template #content>
              <div v-for="(line, index) in row.sentimentTooltip.split('\n')" :key="index">{{ line }}</div>
            </template>
            <div class="sentiment-cell">
              <div :class="sentimentClass(row.sentiment)">{{ row.sentimentLabel }}<span v-if="row.sentiment != null"> {{ signed(row.sentiment) }}%</span></div>
              <div class="muted">多 {{ formatOICompact(row.bullishCount) }} / 空 {{ formatOICompact(row.bearishCount) }}</div>
            </div>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="进度" align="center" header-align="center" min-width="65" prop="candleProgressPercent" sortable="custom">
        <template #default="{ row }">{{ format(row.candleProgressPercent) }}%</template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && rows.length === 0" description="暂无已配置交易对或指标数据" />
  </component>
</template>

<script setup lang="ts">
// ==================== 指标看板 ====================
import { computed, ref, watch, onUnmounted } from 'vue'
import { ElDrawer } from 'element-plus'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'
import type { SupportResistanceSnapshot } from '../../types/support-resistance'
import SupportResistanceInfo from './SupportResistanceInfo.vue'
import { TREND_PERIODS, combinePeriodTrend, classifyTrendStructure } from '../utils/environment-confidence'

/** 指标列表中的单个交易对展示数据。 */
interface IndicatorRow {
  supportResistance?: SupportResistanceSnapshot
  symbol: string; price?: number; closeChangePercent?: number; candleDirectionLabel: string
  candleProgressPercent?: number
  adx?: number; rsi?: number; atrPercent?: number; oiChangePercent?: number
  /** 与 ADX 共用后端计算结果，回看窗口以该次计算实际使用的配置为准。 */
  adxSlope?: number; adxSlopePeriod?: number
  /** OI 增减仓折算额及含实际回看窗口的快照悬停数据。 */
  oiChangeLabel: string; oiTooltip: string
  /** ADX 方向指标及基于后端 DI 差距变化得出的趋势信号。 */
  pdi?: number; mdi?: number; diDirection: '多头增强' | '多头减弱' | '空头减弱' | '空头增强' | '中性' | '--'
  /** EMA 周期与数值，以及短周期相对长周期的方向。 */
  fastEmaPeriod: number; slowEmaPeriod: number; fastEma?: number; slowEma?: number; emaBullish?: boolean
  macd?: number; macdSignal?: number; macdHistogram?: number
  previousMacd?: number; previousMacdSignal?: number; previousMacdHistogram?: number
  macdCrossover: 'golden' | 'dead' | 'none'; macdHistogramTrend: 'rising' | 'falling' | 'flat'
  /** 计价资产资金流，保留缺失状态，避免 Number(null) 变为零。 */
  netInflow?: number; netInflowPercent?: number; cumulativeNetInflow?: number; cumulativeNetInflowPercent?: number
  moneyFlowTooltip: string; cumulativeFlowTooltip: string
  volumeRatio?: number; sentiment?: number; sentimentLabel: string; stale: boolean
  /** 情绪样本量与解释信息，随后台慢统计一并补齐。 */
  bullishCount?: number; bearishCount?: number; sentimentTooltip: string
}

/** 指标抽屉的外部控制参数。 */
interface Props {
  modelValue: boolean
  embedded?: boolean
  selectedSymbol?: string
}

/** 指标抽屉向父组件同步开关状态的事件。 */
interface Emits {
  (event: 'update:modelValue', value: boolean): void
  (event: 'select-symbol', symbol: string, timeframe: string): void
  (event: 'symbols-ready', symbols: string[]): void
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

/** 将看板当前交易对和周期同步到首页，关闭抽屉以展示图表。 */
function selectChart(symbol: string) {
  emit('select-symbol', symbol, timeframe.value)
  if (!props.embedded) visible.value = false
}

/** 整行点击联动图表；文字选择和交互控件保留自身行为，交易对按钮继续支持键盘操作。 */
function handleRowClick(row: IndicatorRow, _column: unknown, event: MouseEvent) {
  if (window.getSelection()?.toString().trim()) return
  const target = event.target
  if (target instanceof Element && target.closest('button, a, input, select, textarea, [role="button"], [role="tooltip"], .el-tooltip__trigger')) return
  selectChart(row.symbol)
}

/** 以右侧实际展示的交易对为选中真源，刷新、排序后仍保持同一行高亮。 */
function selectedRowClass({ row }: { row: IndicatorRow }) {
  return props.embedded && row.symbol === props.selectedSymbol ? 'indicator-selected-row current-row' : ''
}

const timeframes = TREND_PERIODS
const rows = ref<IndicatorRow[]>([])
const loading = ref(false)
const errorMessage = ref('')
type SignalTone = '多头' | '空头' | '反转' | '观望'
const signalFilter = ref<SignalTone | '全部'>('全部')
const symbolSearch = ref('')
// 筛选与交易对下方的一致性文字使用同一规则，随后台五周期数据更新。
const filteredRows = computed(() => {
  // 搜索仅过滤已加载数据，与方向筛选叠加，不触发额外指标请求或改变当前排序。
  const keyword = symbolSearch.value.toUpperCase().replace(/[\s/_-]/g, '')
  return rows.value.filter(row => row.symbol.toUpperCase().replace(/[\s/_-]/g, '').includes(keyword)
    && (signalFilter.value === '全部' || resonanceInfo(row.symbol).tone === signalFilter.value))
})
const periodSignals = ref<Record<string, Partial<Record<string, IndicatorRow['diDirection']>>>>({})
let fetchVersion = 0
let structureTimer: ReturnType<typeof setInterval> | undefined
let refreshingStructure = false

/** 打开看板时定期补齐实时结构；限制并发，旧周期请求不可覆盖新周期。 */
async function refreshStructure() {
  if (!visible.value || loading.value || refreshingStructure) return
  // 启动期首屏为空时继续尝试加载，初始化完成后自动恢复看板。
  if (rows.value.length === 0) {
    await fetchData()
    return
  }
  refreshingStructure = true
  const version = fetchVersion
  const selectedTimeframe = timeframe.value
  const targets = rows.value.map(row => row.symbol)
  let cursor = 0
  try {
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (visible.value && version === fetchVersion && cursor < targets.length) {
        const symbol = targets[cursor++]!
        try {
          const response: any = await $fetch('/api/bot/indicators', {
            query: { symbol, timeframe: selectedTimeframe, includeSlowStats: 'false', structureOnly: 'true' }
          })
          if (!visible.value || version !== fetchVersion) return
          const row = rows.value.find(item => item.symbol === symbol)
          if (row) row.supportResistance = response.data?.indicators?.supportResistance?.values
        } catch {
          // 刷新失败清除旧结构，避免将上轮价格对应的距离伪装成实时结果。
          if (version === fetchVersion) {
            const row = rows.value.find(item => item.symbol === symbol)
            if (row) row.supportResistance = undefined
          }
        }
      }
    }))
  } finally {
    refreshingStructure = false
  }
}
type SortOrder = 'ascending' | 'descending' | null
type SortProp = 'candleProgressPercent' | 'rsi' | 'macdHistogram' | 'atrPercent' | 'oiChangePercent' | 'volumeRatio' | 'netInflowPercent' | 'cumulativeNetInflow' | null
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
  let initializing = false
  // 首屏只请求当前周期，避免另外四个周期先占满浏览器连接和服务端计算资源。
  const results = await Promise.all(symbols.value.map(async (symbol: string) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', { query: { symbol, timeframe: requestedTimeframe, emaPeriods: requestedEmaPeriods.join(','), includeSlowStats: 'false' } })
      if (response.initializing) { initializing = true; return null }
      if (!response.success || !response.data) return null
      const row = toRow(response.data)
      if (version === fetchVersion) {
        periodSignals.value[row.symbol] = { ...periodSignals.value[row.symbol], [requestedTimeframe]: combinedPeriodTrend(row) }
      }
      return row
    } catch { return null }
  }))
  // 切换周期或连续刷新时，旧请求不得覆盖最新表格及共振状态。
  if (version !== fetchVersion) return
  rows.value = results.filter(Boolean) as IndicatorRow[]
  applySort()
  emit('symbols-ready', rows.value.map(row => row.symbol))
  if (rows.value.length === 0) errorMessage.value = initializing
    ? '行情初始化中，稍后自动刷新' : '指标暂不可用，请确认指标中心已完成初始化'
  loading.value = false

  // 首屏不再等待 OI 历史和币安广场分页请求；慢字段在表格显示后后台补齐。
  if (rows.value.length > 0) void fetchBackgroundStats(version, requestedTimeframe, requestedEmaPeriods)
}

/** 按主表、五周期信号、慢统计的顺序加载，避免三类请求同时争抢资源。 */
async function fetchBackgroundStats(version: number, selectedTimeframe: string, periods: number[]) {
  await fetchResonance(version, selectedTimeframe, periods)
  if (version !== fetchVersion) return
  await enrichSlowStats(version, selectedTimeframe)
}

/** 后台补齐另外四个周期，复用当前周期数据，避免共振请求阻塞首屏。 */
async function fetchResonance(version: number, selectedTimeframe: string, periods: number[]) {
  const tasks = symbols.value.flatMap(symbol => timeframes.filter(period => period !== selectedTimeframe).map(period => ({ symbol, period })))
  // 最多四个后台请求并行；刷新后不再继续发送旧批次中尚未开始的请求。
  let nextTask = 0
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (version === fetchVersion && nextTask < tasks.length) {
      const { symbol, period } = tasks[nextTask++]!
      try {
        const response: any = await $fetch('/api/bot/indicators', {
          query: { symbol, timeframe: period, emaPeriods: periods.join(','), includeSlowStats: 'false', signalOnly: 'true' }
        })
        if (version !== fetchVersion) return
        periodSignals.value[symbol] = { ...periodSignals.value[symbol], [period]: combinedPeriodTrend(toRow(response.data)) }
      } catch {
        // 请求失败保留缺失状态，不能将不完整数据判为五周期共振。
      }
    }
  }))
}

/** 趋势与 MACD 同向才保留方向；只有两者都增强才显示强色。 */
function combinedPeriodTrend(row: IndicatorRow): IndicatorRow['diDirection'] {
  return combinePeriodTrend(row.diDirection, row.macdHistogram, row.previousMacdHistogram)
}

// 仅在周期信号变化时重算，模板颜色、文字、悬停及筛选共享结果。
const resonanceResults = computed(() => Object.fromEntries(
  symbols.value.map(symbol => [symbol, calculateResonanceInfo(symbol)])
))

/** 读取缓存的组合结论，避免每次单元格渲染重复执行判定。 */
function resonanceInfo(symbol: string): { label: string; tone: SignalTone } {
  return resonanceResults.value[symbol] ?? { label: '数据不足观望', tone: '观望' }
}

/** 将大周期背景、中间承接和短线触发拆开判断，避免五周期不完全一致就被压成观望。 */
function calculateResonanceInfo(symbol: string): { label: string; tone: SignalTone } {
  return classifyTrendStructure(periodSignals.value[symbol] || {})
}

/** 用颜色表达趋势与 MACD 共同确认的方向，非双增强状态使用淡色。 */
function periodTrendClass(trend?: IndicatorRow['diDirection']) {
  const direction = trend?.startsWith('多头') ? 'up' : trend?.startsWith('空头') ? 'down' : 'muted'
  return [direction, { 'trend-weakening': trend?.endsWith('减弱') === true }]
}

/** 悬停说明圆点顺序与各周期状态，缺失数据不伪装成观望。 */
function resonanceTitle(symbol: string) {
  return `${resonanceInfo(symbol).label}；${timeframes.map(period => `${period}：${periodSignals.value[symbol]?.[period] ?? '暂无数据'}`).join(' / ')}`
}

function signalClass(signal: SignalTone) {
  return signal === '多头' ? 'up' : signal === '空头' || signal === '反转' ? 'down' : 'muted'
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
          oiChangeLabel: next.oiChangeLabel,
          oiTooltip: next.oiTooltip,
          sentiment: next.sentiment,
          sentimentLabel: next.sentimentLabel,
          bullishCount: next.bullishCount,
          bearishCount: next.bearishCount,
          sentimentTooltip: next.sentimentTooltip
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
  sortProp.value = (['candleProgressPercent', 'rsi', 'macdHistogram', 'atrPercent', 'oiChangePercent', 'volumeRatio', 'netInflowPercent', 'cumulativeNetInflow'] as string[]).includes(prop || '')
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
  const flow = values('moneyFlow')
  // 资金流窗口只展示月日与时分，避免重复年份和秒数挤占提示宽度。
  const flowTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  })
  const flowWindow = flow.startTimestamp && flow.endTimestamp
    ? `${flowTime(flow.startTimestamp)} — ${flowTime(flow.endTimestamp)}` : '暂无数据'
  const heat = values('squareHeat')
  const oi = values('oi')
  const oiMemory = data?.oiMemory
  const oiWindowMinutes = finiteNumber(data?.parameters?.oiLookbackMinutes)
  // 首屏诊断已按同一回看窗口计算内存 OI 比例，无需等待含社区情绪的慢请求。
  // 历史基准未就绪时继续保留缺失状态，不能把未知变化展示为零。
  const oiChangePercent = finiteNumber(oi.changePercent) ?? finiteNumber(oiMemory?.calculatedChangePercent)
  const oiValue = oiMemory?.current?.value ?? oi.value
  const oiBaseline = finiteNumber(oiMemory?.baseline?.openInterest)
  const oiCurrent = finiteNumber(oiValue)
  // 与变化率使用同一回看基准；缺少任一快照时不将未知变化显示为零。
  const oiChange = oiCurrent != null && oiBaseline != null ? oiCurrent - oiBaseline : undefined
  // 将 OI 数量变化按当前价格折算为 USDT，直观表达增减仓的名义规模。
  const oiChangeAmount = oiChange != null && price > 0 ? oiChange * price : undefined
  const oiChangeLabel = oiChangeAmount == null
    ? '--'
    : `${oiChangeAmount > 0 ? '+' : ''}${formatCompactNumber(oiChangeAmount)}`
  const oiWindowLabel = oiWindowMinutes == null ? '--' : oiWindowMinutes % 60 === 0 ? `${oiWindowMinutes / 60}h` : `${oiWindowMinutes}m`
  const oiCurrentAmountLabel = oiCurrent != null && price > 0 ? formatCompactNumber(oiCurrent * price) : '--'
  const oiBaselineAmount = oiBaseline != null && price > 0 ? formatCompactNumber(oiBaseline * price) : '--'
  const oiTooltip = [
    `回看窗口：${oiWindowLabel}`,
    `当前 OI：${formatOIValue(oiValue)}（额：${oiCurrentAmountLabel}）`,
    `基准 OI：${formatOIValue(oiMemory?.baseline?.openInterest)}（额：${oiBaselineAmount}）`,
    `基准时间：${formatOITime(oiMemory?.baseline?.timestamp)}`,
    `更新时间：${formatOITime(oiMemory?.current?.timestamp)}`
  ].join('\n')
  const bullishCount = finiteNumber(heat.bullishCount)
  const bearishCount = finiteNumber(heat.bearishCount)
  // 热度涨跌不代表多空情绪；没有方向样本时也不能将默认零值解读成中性。
  const sentiment = bullishCount != null && bearishCount != null && bullishCount + bearishCount > 0
    ? finiteNumber(heat.netDirectionalSentimentPercent) : undefined
  const windowMinutes = finiteNumber(data?.parameters?.squareHeatWindowMinutes)
  const sentimentTooltip = [
    `总帖数：${formatOICompact(heat.postCount)}`,
    `方向覆盖：${format(finiteNumber(heat.directionalCoveragePercent))}%`,
    `热度变化：${signed(finiteNumber(heat.changePercent))}%`,
    `统计窗口：${windowMinutes == null ? '--' : windowMinutes % 60 === 0 ? `${windowMinutes / 60}小时` : `${windowMinutes}分钟`}`
  ].join('\n')
  return {
    symbol: data.symbol, price, closeChangePercent: Number(data.kline?.closeChangePercent),
    supportResistance: data?.indicators?.supportResistance?.values,
    candleProgressPercent: Number(data.kline?.candleProgressPercent),
    candleDirectionLabel: data.kline?.candleDirection === 'bullish' ? '阳线' : data.kline?.candleDirection === 'bearish' ? '阴线' : '平',
    adx: Number(adx.adx), rsi: Number(values('rsi').rsi),
    adxSlope: finiteNumber(adx.adxSlope), adxSlopePeriod: finiteNumber(adx.adxSlopePeriod),
    pdi, mdi, diDirection: diTrendSignal(adx.diSpread, adx.diGapChange),
    fastEmaPeriod: fastPeriod, slowEmaPeriod: slowPeriod, fastEma, slowEma,
    macd: Number(macd.macd), macdSignal: Number(macd.signal), macdHistogram: Number(macd.histogram),
    previousMacd: Number(macd.previousMacd), previousMacdSignal: Number(macd.previousSignal), previousMacdHistogram: Number(macd.previousHistogram),
    macdCrossover: normalizeCrossover(macd.crossover), macdHistogramTrend: normalizeHistogramTrend(macd.histogramTrend),
    atrPercent: price > 0 ? atr / price * 100 : undefined, oiChangePercent,
    oiChangeLabel, oiTooltip,
    netInflow: flow.netInflow ?? undefined,
    netInflowPercent: flow.netInflowPercent ?? undefined,
    cumulativeNetInflow: flow.cumulativeNetInflow ?? undefined,
    cumulativeNetInflowPercent: flow.cumulativeNetInflowPercent ?? undefined,
    moneyFlowTooltip: `本根成交：${formatFlowAmount(flow.quoteVolume)}\n主动买入：${formatFlowAmount(flow.takerBuyQuoteVolume)}`,
    cumulativeFlowTooltip: `近5根：${flowWindow}\n${flow.complete ? '累计比例 = 净流入 / 成交额' : '数据不足，等待补齐'}`,
    volumeRatio: Number(values('volume').ratio), sentiment,
    sentimentLabel: sentiment == null ? '--' : sentiment > 0 ? '偏多' : sentiment < 0 ? '偏空' : '中性',
    bullishCount, bearishCount, sentimentTooltip,
    // dataAgeMs 由服务端按最近一次成功写入时间计算，不再使用 K 线开盘时间。
    emaBullish: fastEma == null || slowEma == null || !Number.isFinite(fastEma) || !Number.isFinite(slowEma)
      ? undefined : fastEma >= slowEma,
    stale: Number(data?.kline?.dataAgeMs) > 2 * 60 * 60 * 1000
  }
}

/** 大数值统一使用 K / M / B；价格与 EMA 使用独立的完整数字格式。 */
function formatCompactNumber(value: number, maximumFractionDigits = 2): string {
  const amount = Math.abs(value)
  const rounded = Math.round(amount * 100) / 100
  const unit = rounded >= 1e9 ? 'B' : rounded >= 1e6 ? 'M' : rounded >= 1e3 ? 'K' : ''
  const divisor = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1
  // 缩放舍入后跨过百万边界时升级单位，避免显示 1000K。
  if (unit === 'K' && Math.abs(Number((value / divisor).toFixed(2))) >= 1000) {
    return `${(value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`
  }
  // 舍入后跨过十亿边界时升级单位，避免显示 1000M。
  if (unit === 'M' && Math.abs(Number((value / divisor).toFixed(2))) >= 1000) {
    return `${(value / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })}B`
  }
  return `${(value / divisor).toLocaleString('en-US', { maximumFractionDigits: unit ? 2 : maximumFractionDigits })}${unit}`
}

/** 数量字段统一使用 K / M / B，缺失值保留 --。 */
function formatOICompact(value: unknown): string {
  const number = finiteNumber(value)
  if (number == null) return '--'
  return formatCompactNumber(number)
}

/** OI 悬停数量沿用统一缩写，小数值最多保留五位小数。 */
function formatOIValue(value: unknown): string {
  const number = finiteNumber(value)
  return number == null ? '--' : formatCompactNumber(number, 5)
}

/** 展示交易所快照时间；缺失时间不显示为 Unix 起点。 */
function formatOITime(value: unknown): string {
  const timestamp = finiteNumber(value)
  if (timestamp == null || timestamp <= 0) return '--'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false })
}

/** 与后端 AI 信号保持一致：当前优势侧配合绝对差距变化，缺失数据不视为中性。 */
function diTrendSignal(spread: unknown, gapChange: unknown): IndicatorRow['diDirection'] {
  if (typeof spread !== 'number' || typeof gapChange !== 'number'
    || !Number.isFinite(spread) || !Number.isFinite(gapChange)) return '--'
  if (spread === 0 || gapChange === 0) return '中性'
  if (spread > 0) return gapChange > 0 ? '多头增强' : '多头减弱'
  return gapChange > 0 ? '空头增强' : '空头减弱'
}

/** 资金金额使用统一缩写并保留正负号；缺失显示 --。 */
function formatFlowAmount(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${formatCompactNumber(value)}`
}

/** 保留零值，避免空值被转换成有效的零样本或零情绪。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function format(value?: number) { return value == null || !Number.isFinite(value) ? '--' : Math.abs(value) >= 1e3 ? formatCompactNumber(value) : value.toFixed(2) }
function signed(value?: number) { return value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}${format(value)}` }
/** 看板斜率统一保留两位小数，仅调整显示精度。 */
function formatAdxSlope(value?: number) {
  return value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

/** 解释强度与方向的分工，避免将 ADX 上升直接理解为价格上涨。 */
function adxSlopeTooltip(slope?: number, period?: number) {
  const formula = period == null ? '当前 ADX − 回看窗口前 ADX' : `当前 ADX − ${period} 根前 ADX（${timeframe.value}）`
  const strength = slope == null ? '暂无斜率数据' : slope > 0 ? '趋势强度上升' : slope < 0 ? '趋势强度下降' : '趋势强度持平'
  return `${formula}\n${strength}，数值为差值\n方向看 PDI/MDI，动能看 MACD`
}
/** 价格与 EMA 始终显示完整数字，小额价格保留必要的小数精度。 */
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2 }) }
/** 资金流只为有效非零数值着色，零值和缺失值沿用正文颜色。 */
function flowDirectionClass(value?: number) {
  return value == null || !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'up' : 'down'
}

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

/** 大值最多两位小数，小值保留三位有效数字；统一普通小数，便于直接比较。 */
function formatMacd(value?: number) {
  if (value == null || !Number.isFinite(value)) return '--'
  if (value === 0) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 1e3) return formatCompactNumber(value)
  // 去掉末尾补零，压缩展示宽度；仅影响显示，不改变指标计算和排序精度。
  return absolute >= 1
    ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 2 })
    : value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 3 })
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
  if (structureTimer) clearInterval(structureTimer)
  structureTimer = undefined
  if (value) {
    void fetchData()
    structureTimer = setInterval(() => { void refreshStructure() }, 15_000)
  } else {
    // 关闭后使首屏及后台尚未完成的旧请求失效。
    fetchVersion++
  }
}, { immediate: true })
onUnmounted(() => {
  fetchVersion++
  if (structureTimer) clearInterval(structureTimer)
})
</script>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.symbol-search { width: 170px; margin-left: auto; }
.adx-line { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.up { color: var(--el-color-success); }.down { color: var(--el-color-danger); }.muted { color: var(--el-text-color-secondary); }
.symbol-cell { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.symbol-link { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.symbol-link:hover { color: var(--el-color-primary); }
.indicators-table :deep(.el-table__body .el-table__row) { cursor: pointer; }
/* 显式设置单元格背景，避免暗色主题的 inherit、固定列与斑马纹覆盖选中颜色。 */
.indicators-table :deep(.el-table__body tr.indicator-selected-row > td.el-table__cell) {
  background-color: color-mix(in srgb, var(--el-color-primary) 18%, var(--el-table-bg-color)) !important;
}
.indicators-table :deep(.el-table__body tr.indicator-selected-row > td.el-table__cell:first-child) {
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.symbol-link:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 3px; }
.resonance { display: grid; grid-template-columns: repeat(5, 8px); align-items: center; gap: 3px; margin-top: 6px; padding-left: 25px; min-height: 12px; font-size: 11px; }
.resonance-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 3px; background: currentColor; }
.resonance-dot.trend-weakening { opacity: .4; }
.resonance-label { grid-column: 1 / -1; white-space: nowrap; }
.coin-icon, .coin-icon-placeholder { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%; }
.coin-icon { display: block; object-fit: cover; }
.coin-icon-placeholder { display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
.macd-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; line-height: 1.35; }
.flow-cell { display: grid; grid-template-columns: 24px max-content max-content; column-gap: 6px; row-gap: 3px; width: max-content; font-weight: 400; line-height: 1.35; }
/* 两行共享内容宽度，不再让金额列拉伸填满整列，避免标签与金额之间出现大块留白。 */
.flow-row { display: contents; white-space: nowrap; font-variant-numeric: tabular-nums; }
.flow-row > span:not(:first-child) { text-align: right; }
.flow-secondary > span { opacity: .7; }
.sentiment-cell { display: flex; flex-direction: column; gap: 3px; line-height: 1.35; white-space: nowrap; font-variant-numeric: tabular-nums; }
.oi-cell { display: flex; flex-direction: column; gap: 3px; line-height: 1.35; white-space: nowrap; font-variant-numeric: tabular-nums; }
.macd-state-line, .macd-values { display: grid; align-items: center; column-gap: 4px; }
.macd-state-line { grid-template-columns: 48px 42px minmax(0, 1fr); }
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

/* 表格占用工具栏下方剩余高度，交给组件内部滚动，保持表头与横向滚动同步。 */
:global(.indicators-drawer .el-drawer__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.toolbar { flex-shrink: 0; }

:global(.indicators-drawer .indicators-table) {
  flex: 1;
  min-height: 0;
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

/* 统一收紧单元格留白，保留排序箭头与数字间距，不通过缩小字号挤压内容。 */
:global(.indicators-drawer .indicators-table .cell) {
  padding-left: 4px;
  padding-right: 4px;
}

/* 使用淡竖线明确列边界，保留现有横线和斑马纹，避免完整网格过于抢眼。 */
:global(.indicators-drawer .indicators-table .el-table__cell:not(:last-child)) {
  border-right: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}

:global(.indicators-drawer .el-drawer__body) {
  padding-left: 12px;
  padding-right: 12px;
}

@media (max-width: 768px) {
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .symbol-search { width: 100%; margin-left: 0; }

  /* 手机端占满屏幕，保持与日志抽屉一致的操作体验。 */
  :global(.indicators-drawer) {
    width: 100% !important;
  }
}
</style>
