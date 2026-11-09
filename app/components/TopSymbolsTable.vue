<!-- ==================== 热门及持续放量交易对榜单 ==================== -->
<template>
  <component
    :is="embedded ? 'section' : selectable ? ElDialog : ElDrawer"
    v-bind="embedded ? {} : {
      modelValue: visible,
      title: dialogTitle,
      appendToBody: true,
      ...(selectable
        ? { width: '66%', fullscreen: isMobile, top: '22vh', draggable: true }
        : { direction: 'rtl', size: isMobile ? '100%' : '75%' })
    }"
    @update:model-value="visible = $event"
  >
    <div class="top-symbols-container" :class="{ 'top-symbols-container-drawer': !selectable, 'top-symbols-container-page': embedded }" :style="embedded ? { '--market-row-padding': `${rowPadding}px` } : undefined">
      <!-- 模式切换与工具栏 -->
      <div class="top-symbols-toolbar">
        <el-radio-group v-model="mode" class="mode-switch" size="small" aria-label="榜单模式" @change="handleModeChange">
          <el-radio-button value="hot">🔥 24h 热门</el-radio-button>
          <el-radio-button value="stable">📈 持续放量</el-radio-button>
          <el-radio-button value="configured">📋 配置列表</el-radio-button>
        </el-radio-group>
        <div class="market-filters">
          <el-radio-group v-model="assetType" size="small" aria-label="资产类型">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="crypto">加密货币</el-radio-button>
            <el-radio-button value="tradfi">股票 T</el-radio-button>
          </el-radio-group>
          <el-input v-model="search" size="small" placeholder="交易对" clearable aria-label="搜索交易对" class="symbol-search">
            <template #prefix>
              <el-icon><ElIconSearch /></el-icon>
            </template>
          </el-input>
          <span v-if="mode === 'stable' && updatedAt" class="data-updated-at">
            数据更新于 {{ new Date(updatedAt).toLocaleString('zh-CN') }}
          </span>
        </div>
        <div class="toolbar-actions">
          <template v-if="embedded && viewMode === 'heatmap'">
            <span class="heatmap-caption">24h 涨跌幅 · {{ overviewRows.length }} 个交易对</span>
            <el-select v-model="heatmapSizeMode" size="small" aria-label="热力图区块面积" class="heatmap-size-select">
              <el-option label="按涨跌幅面积" value="change" />
              <el-option label="按24h成交额" value="volume" />
              <el-option label="等面积" value="equal" />
            </el-select>
          </template>
          <el-radio-group v-if="embedded" v-model="viewMode" size="small" aria-label="行情展示方式">
            <el-radio-button value="table">表格</el-radio-button>
            <el-radio-button value="heatmap">热力图</el-radio-button>
          </el-radio-group>
          <el-button type="primary" size="small" :loading="loading" @click="fetchData">
            <el-icon><ElIconRefresh /></el-icon>
            刷新
          </el-button>
          <el-button
            v-if="mode === 'stable'"
            size="small"
            :aria-expanded="showFilterParams"
            aria-controls="stable-filter-params"
            @click="showFilterParams = !showFilterParams"
          >
            <el-icon><ElIconSetting /></el-icon>
            设置
          </el-button>
        </div>
      </div>

      <div v-if="selectable && mode === 'hot'" class="toolbar-hint">
        勾选交易对后点击底部"添加选中到列表"可批量添加
      </div>

      <div v-if="mode === 'stable' && loading && !showingCachedResult" class="stable-progress" role="status" aria-live="polite">
        <div class="progress-caption">
          <span>{{ progressText }}</span>
          <span class="progress-note">首次加载需获取日线，币安限流时可能需要较长时间</span>
        </div>
        <el-progress :percentage="progressPercent" :indeterminate="!progress || progress.stage === 'preparing' || progress.stage === 'failed'" :stroke-width="6" />
      </div>

      <!-- 持续放量模式参数设置 -->
      <div v-if="mode === 'stable' && showFilterParams" id="stable-filter-params" class="stable-params">
        <div class="params-grid">
          <div class="param-item">
            <label>统计窗口 (天)</label>
            <el-input-number v-model="filterParams.days" :min="5" :max="90" size="small" controls-position="right" />
            <span class="param-desc">拉取最近 N 天日线分析成交量</span>
          </div>
          <div class="param-item">
            <label>最低数据覆盖比例 (%)</label>
            <el-input-number v-model="dataCoveragePercent" :min="0" :max="100" :precision="0" :step="5" size="small" controls-position="right" />
            <span class="param-desc">至少 {{ Math.ceil(filterParams.days * filterParams.minDataRatio) }} 根日线（向上取整）</span>
          </div>
          <div class="param-item">
            <label>候选池数量</label>
            <el-input-number v-model="filterParams.pool" :min="5" :max="200" size="small" controls-position="right" />
            <span class="param-desc">24h 成交额前 N 名进入分析</span>
          </div>
          <div class="param-item">
            <label>输出数量</label>
            <el-input-number v-model="filterParams.top" :min="5" :max="100" size="small" controls-position="right" />
            <span class="param-desc">榜单最终展示数量</span>
          </div>
          <div class="param-item">
            <label>日均成交额下限 (万USDT)</label>
            <el-input-number v-model="minDailyWan" :min="0" :step="1000" size="small" controls-position="right" />
            <span class="param-desc">日均及活跃日单日成交额须 ≥ 此值</span>
          </div>
          <div class="param-item">
            <label>活跃天数比例 (%)</label>
            <el-input-number v-model="activeDaysPercent" :min="0" :max="100" :precision="0" :step="5" size="small" controls-position="right" />
            <span class="param-desc">至少 {{ Math.ceil(filterParams.days * filterParams.activeDaysRatio) }} 天达到成交额下限（向上取整）</span>
          </div>
          <div class="param-item">
            <label>最低/最高比</label>
            <el-input-number v-model="filterParams.minRatio" :min="0" :max="1" :step="0.01" size="small" controls-position="right" />
            <span class="param-desc">最低量那天 ≥ 最高量那天的此比例</span>
          </div>
          <div class="param-item">
            <label>最大变异系数 CV</label>
            <el-input-number v-model="filterParams.cvMax" :min="0" :max="10" :step="0.1" size="small" controls-position="right" />
            <span class="param-desc">CV = 标准差÷均值，越小越稳定</span>
          </div>
          <div class="param-item">
            <label>分段稳定性阈值</label>
            <el-input-number v-model="filterParams.segmentRatio" :min="0" :max="1" :step="0.05" size="small" controls-position="right" />
            <span class="param-desc">每段平均成交额 ≥ 全期均值的此比例</span>
          </div>
        </div>
        <div class="params-actions">
          <el-button size="small" @click="resetParams">恢复默认</el-button>
          <el-button type="primary" size="small" :loading="loading" @click="applyFilterParams">应用筛选</el-button>
        </div>
      </div>

      <el-alert
        v-if="message"
        type="warning"
        :closable="false"
        show-icon
        class="stable-alert"
      >
        {{ message }}
      </el-alert>

      <div class="market-main">
      <div v-if="embedded && viewMode === 'heatmap'" v-loading="loading && !showingCachedResult" class="market-heatmap">
        <PriceHeatmap v-if="heatmapItems.length" class="market-heatmap-chart" :items="heatmapItems" :search-query="normalizeSymbol(search)" period="24h" :selected-symbol="detailSymbol?.symbol || ''" :focus-selected-on-mount="false" :height="400" :size-mode="heatmapSizeMode" volume-source="ticker24h" selection-hint="点击查看交易对详情" @select="selectHeatmapSymbol" />
        <el-empty v-else description="暂无行情数据" />
      </div>
      <el-table
        v-else
        ref="tableRef"
        v-loading="loading && !showingCachedResult"
        :data="pagedData"
        stripe
        row-key="symbol"
        style="width: 100%"
        :height="embedded ? '100%' : undefined"
        size="small"
        @sort-change="handleSortChange"
        @row-click="handleRowClick"
        :highlight-current-row="embedded"
        :current-row-key="embedded ? detailSymbol?.symbol : undefined"
        @selection-change="handleSelectionChange"
        :default-sort="defaultSort"
        :key="tableKey"
      >
        <el-table-column v-if="selectable" type="selection" width="40" reserve-selection />
        <el-table-column type="index" :index="rowIndex" label="#" width="60" />

        <el-table-column
          prop="symbol"
          label="交易对"
          min-width="150"
        >
          <template #default="{ row }">
            <div class="symbol-cell">
              <template v-if="!iconFailed[row.symbol] && cryptoIconUrl(row.symbol)">
                <img
                  :src="cryptoIconUrl(row.symbol)"
                  :alt="getSymbolDisplay(row.symbol)"
                  class="crypto-icon"
                  @error="onIconError(row.symbol)"
                />
              </template>
              <span v-else
                class="crypto-icon-placeholder"
                :style="{ backgroundColor: getRandomColor(getSymbolDisplay(row.symbol)) }"
              >{{ getSymbolDisplay(row.symbol).substring(0, 1).toUpperCase() }}</span>
              <el-link type="primary" underline="never" :style="{ cursor: selectable || embedded ? 'pointer' : 'default' }" @click.stop="handleRowClick(row)">
                {{ row.symbol.replace('USDT', '/USDT') }}
              </el-link>
              <el-tag v-if="row.contractType === 'TRADIFI_PERPETUAL'" size="small" type="warning" effect="plain">T</el-tag>
              <span
                v-if="isConfiguredSymbol(row.symbol)"
                class="configured-dot"
                title="已在机器人交易对配置中"
                aria-label="已配置"
              />
            </div>
          </template>
        </el-table-column>

        <el-table-column
          prop="volume"
          label="24h成交额"
          sortable="custom"
          min-width="120"
        >
          <template #default="{ row }">
            {{ formatVolume(row.volume) }}
          </template>
        </el-table-column>

        <!-- 持续放量模式附加列 -->
        <template v-if="mode === 'stable'">
          <el-table-column
            prop="avgDailyVolume"
            label="日均成交额"
            sortable="custom"
            min-width="120"
          >
            <template #default="{ row }">
              {{ formatVolume(row.avgDailyVolume) }}
            </template>
          </el-table-column>

          <el-table-column
            prop="volumeCv"
            label="稳定性CV"
            sortable="custom"
            min-width="100"
          >
            <template #default="{ row }">
              <span :class="cvClass(row.volumeCv)">
                {{ row.volumeCv !== undefined ? row.volumeCv.toFixed(2) : '--' }}
              </span>
            </template>
          </el-table-column>

          <el-table-column
            prop="minMaxRatio"
            label="最低/最高"
            sortable="custom"
            min-width="100"
          >
            <template #default="{ row }">
              {{ row.minMaxRatio !== undefined ? (row.minMaxRatio * 100).toFixed(0) + '%' : '--' }}
            </template>
          </el-table-column>

          <el-table-column
            prop="activeDays"
            label="活跃天数"
            sortable="custom"
            min-width="90"
          >
            <template #default="{ row }">
              <el-tooltip :content="`达到设置的成交额下限的天数 / 实际日线根数；至少 ${Math.round(loadedActiveDaysRatio * 100)}% 的窗口天数须达标（${Math.ceil(loadedDays * loadedActiveDaysRatio)} 天）`" placement="top">
                <span>{{ row.activeDays || '--' }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
        </template>

        <el-table-column
          prop="price"
          label="价格 (USDT)"
          sortable="custom"
          min-width="110"
        >
          <template #default="{ row }">
            {{ formatPrice(row.price) }}
          </template>
        </el-table-column>

        <el-table-column
          v-for="period in shortChangePeriods"
          :key="period.prop"
          :prop="period.prop"
          :label="period.label"
          sortable="custom"
          min-width="100"
        >
          <template #default="{ row }">
            <span :class="percentClass(row[period.prop])">{{ formatChange(row[period.prop]) }}</span>
          </template>
        </el-table-column>

        <el-table-column
          prop="priceChangePercent"
          label="24h涨跌幅"
          sortable="custom"
          min-width="100"
        >
          <template #default="{ row }">
            <span :class="percentClass(row.priceChangePercent)">
              {{ formatChange(row.priceChangePercent) }}
            </span>
          </template>
        </el-table-column>

        <el-table-column
          prop="priceChangePercentDays"
          :label="`${mode === 'stable' ? loadedDays : 30}d涨跌幅`"
          :show-overflow-tooltip="true"
          sortable="custom"
          min-width="110"
        >
          <template #default="{ row }">
            <span :class="percentClass(row.priceChangePercentDays)">{{ formatChange(row.priceChangePercentDays) }}</span>
          </template>
        </el-table-column>

        <el-table-column
          prop="fundingRate"
          label="资金费率"
          sortable="custom"
          min-width="90"
        >
          <template #default="{ row }">
            <span :class="fundingClass(row.fundingRate)">
              {{ row.fundingRate.toFixed(4) }}%
            </span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="embedded && viewMode === 'table' && sortedData.length > 0"
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :total="sortedData.length"
        :pager-count="isMobile ? 5 : 7"
        :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next, jumper'"
        class="market-pagination"
        background
      />
      </div>

      <!-- 多选操作栏 -->
      <div v-if="selectable" class="selection-actions">
        <span class="selection-count">已选 {{ selectedRows.length }} 个</span>
        <div class="selection-buttons">
          <el-button size="small" @click="selectAll">全选</el-button>
          <el-button size="small" :disabled="selectedRows.length === 0" @click="clearSelection">清空</el-button>
          <el-button type="primary" size="small" :disabled="selectedRows.length === 0" @click="confirmSelect">
            添加选中 ({{ selectedRows.length }})
          </el-button>
        </div>
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { ElDialog, ElDrawer } from 'element-plus'
import { useCoinIcon } from '../composables/useCoinIcon'
import type { MarketOverviewSymbol, MarketOverviewState } from '../../types/market-overview'

const { getCoinIconUrl } = useCoinIcon()
// 用户切换到热力图时才加载 ECharts，保持表格首次加载轻量。
const PriceHeatmap = defineAsyncComponent(() => import('./PriceHeatmap.vue'))

type Mode = 'hot' | 'stable' | 'configured'

/** 热门及持续放量榜单的交易对行情。 */
interface TopSymbol extends MarketOverviewSymbol {
  symbol: string
  volume: number
  price: number
  priceChangePercent: number
  priceChangePercent1h?: number
  priceChangePercent4h?: number
  priceChangePercentDays?: number
  fundingRate: number
  klineCount4h: number
  onboardDate: number
  // 持续放量模式附加字段
  avgDailyVolume?: number
  volumeCv?: number
  minMaxRatio?: number
  activeDays?: string
  contractType?: string
  score?: number
}

/** 持续放量筛选参数 */
interface FilterParams {
  days: number
  minDataRatio: number // 最低日线根数占统计窗口的比例（0–1）
  pool: number
  top: number
  minDaily: number
  activeDaysRatio: number // 最低活跃天数占统计窗口的比例（0–1）
  minRatio: number
  cvMax: number
  segmentRatio: number
}

/** 服务端返回的持续放量计算进度，按实际完成候选数量展示。 */
interface StableProgress {
  stage: 'preparing' | 'analyzing' | 'funding' | 'completed' | 'failed'
  completed: number
  total: number
}

/** 榜单响应；客户端只保存成功的持续放量结果，不缓存降级热门行情。 */
interface TopSymbolsResponse {
  success: boolean
  mode?: string
  message?: string
  updatedAt?: number
  params?: FilterParams
  data: TopSymbol[]
}

/** 与服务端 FILTER_DEFAULTS 保持一致的默认值 */
const DEFAULT_FILTER_PARAMS: FilterParams = {
  days: 30,
  minDataRatio: 0.6,
  pool: 150,
  top: 80,
  minDaily: 20_000_000,
  activeDaysRatio: 0.8,
  minRatio: 0.02,
  cvMax: 1.0,
  segmentRatio: 0.2,
}

/** 榜单展示参数；embedded 用于独立分页页面，selectable 用于配置表单批量添加。 */
interface Props {
  modelValue: boolean
  selectable?: boolean
  embedded?: boolean
}

/** 配置表单通过 select 接收选中的交易对。 */
interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'select', symbols: string[]): void
  (e: 'overview', state: MarketOverviewState): void
}

const props = withDefaults(defineProps<Props>(), { selectable: true, embedded: false })
const emit = defineEmits<Emits>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const loading = ref(false)
const showingCachedResult = ref(false)
// 跨页面保留最近 20 组结果；再次打开先展示旧结果和原更新时间，再向服务端核对。
const stableResults = useState<Record<string, TopSymbolsResponse>>('stable-symbol-results', () => ({}))
// 快速切换榜单时，仅允许最后一次请求更新页面，避免旧响应覆盖当前模式。
let requestId = 0
const progress = ref<StableProgress | null>(null)
let progressTimer: ReturnType<typeof setTimeout> | undefined
let progressController: AbortController | undefined
const progressPercent = computed(() => {
  if (!progress.value) return 0
  if (progress.value.stage === 'completed') return 100
  if (progress.value.stage === 'funding') return 95
  return progress.value.total > 0 ? Math.round(progress.value.completed / progress.value.total * 95) : 0
})
const progressText = computed(() => {
  const state = progress.value
  if (!state || state.stage === 'preparing') return '正在准备市场行情…'
  if (state.stage === 'analyzing') return `正在分析日线：已处理 ${state.completed} / ${state.total} 个交易对`
  if (state.stage === 'funding') return '交易对分析完成，正在获取资金费率并汇总结果…'
  if (state.stage === 'failed') return '持续放量计算失败，正在加载备用行情…'
  return '分析完成，正在展示结果…'
})

/** 切换模式、请求结束或离开页面时停止轮询，避免后台遗留请求。 */
function stopProgressPolling() {
  clearTimeout(progressTimer)
  progressController?.abort()
  progressController = undefined
}

/** 串行轮询真实进度；失败不影响主行情请求，也不自动发起新的计算。 */
function startProgressPolling(query: Record<string, string | number | undefined>, currentRequest: number) {
  const controller = new AbortController()
  progressController = controller
  const poll = async () => {
    if (controller.signal.aborted || currentRequest !== requestId) return
    try {
      const response = await $fetch<{ success: boolean; progress: StableProgress | null }>('/api/binance/top-symbols', {
        query: { ...query, progress: '1' }, signal: controller.signal, timeout: 5000, retry: 0,
      })
      if (!controller.signal.aborted && currentRequest === requestId && response.progress) progress.value = response.progress
    } catch {
      // 暂时读取不到进度时保留已知计数，继续等待主请求。
    }
    if (!controller.signal.aborted && currentRequest === requestId) progressTimer = setTimeout(poll, 1000)
  }
  progressTimer = setTimeout(poll, 500)
}
const data = ref<TopSymbol[]>([])
const assetType = ref<'all' | 'crypto' | 'tradfi'>('all')
const search = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const mode = ref<Mode>('hot')
const viewMode = ref<'table' | 'heatmap'>('table')
const heatmapSizeMode = ref<'change' | 'volume' | 'equal'>('change')
const message = ref('')
const updatedAt = ref<number | null>(null)
const sortProp = ref('volume')
const sortOrder = ref<'ascending' | 'descending'>('descending')
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
const tableRef = ref()
const tableViewportHeight = ref(0)
let tableResizeObserver: ResizeObserver | undefined
// 按可视高度均分一页的行高，表格有足够空间时不留下大块底部空白。
// 最小行高保持可读，50/100等大分页继续滚动；末页不因行数少而被过度拉高。
const rowPadding = computed(() => Math.max(2, (Math.min(40, (tableViewportHeight.value - 1) / pageSize.value) - 23) / 2))
watch(tableRef, (table) => {
  tableResizeObserver?.disconnect()
  if (!props.embedded || typeof ResizeObserver === 'undefined') return
  const viewport = table?.$el?.querySelector('.el-table__body-wrapper .el-scrollbar__wrap') as HTMLElement | undefined
  if (!viewport) return
  const measure = () => { tableViewportHeight.value = viewport.clientHeight }
  tableResizeObserver = new ResizeObserver(measure)
  tableResizeObserver.observe(viewport)
  measure()
}, { flush: 'post' })
const selectedRows = ref<TopSymbol[]>([])
const detailSymbolKey = ref('')
const showFilterParams = ref(false)
const configuredSymbols = ref<Set<string> | null>(null)

/** 统一配置与币安行情的交易对格式，避免斜杠和大小写影响匹配。 */
function normalizeSymbol(symbol: string): string {
  return symbol.trim().replace(/\//g, '').toUpperCase()
}

/** 判断交易对是否已保存到机器人配置。 */
function isConfiguredSymbol(symbol: string): boolean {
  return configuredSymbols.value?.has(normalizeSymbol(symbol)) ?? false
}

/** 每次刷新读取已保存配置；失败时不把未知状态误标为未配置。 */
async function fetchConfiguredSymbols() {
  configuredSymbols.value = null
  try {
    const res = await $fetch<{ success: boolean; data?: { symbols?: string[] } }>('/api/market/config', { timeout: 10000, retry: 0 })
    if (res.success && Array.isArray(res.data?.symbols)) {
      configuredSymbols.value = new Set(res.data.symbols.map(normalizeSymbol))
    }
  } catch (err) {
    console.error('获取交易对配置失败:', err)
  }
}

// 筛选参数副本（默认值）
const filterParams = ref<FilterParams>({ ...DEFAULT_FILTER_PARAMS })
// 标题跟随已加载数据，避免编辑尚未应用的 days 时误标涨跌幅周期。
const loadedDays = ref(DEFAULT_FILTER_PARAMS.days)
// 提示跟随已应用参数，避免修改设置时误解当前榜单的筛选条件。
const loadedActiveDaysRatio = ref(DEFAULT_FILTER_PARAMS.activeDaysRatio)
const shortChangePeriods = [
  { prop: 'priceChangePercent1h', label: '1h涨跌幅' },
  { prop: 'priceChangePercent4h', label: '4h涨跌幅' },
]

/** 缺失历史行情显示占位符，零涨跌幅仍正常展示。 */
function formatChange(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    : '--'
}

// minDaily 以"万 USDT"为单位便于输入
const minDailyWan = computed({
  get: () => Math.round(filterParams.value.minDaily / 10000),
  set: (val: number) => { filterParams.value.minDaily = Number(val) * 10000 }
})

// 数据覆盖比例独立于活跃天数比例，允许调整上市时长要求。
const dataCoveragePercent = computed({
  get: () => Math.round(filterParams.value.minDataRatio * 100),
  set: (val: number) => { filterParams.value.minDataRatio = (val ?? DEFAULT_FILTER_PARAMS.minDataRatio * 100) / 100 }
})

// 前端以百分数输入，接口统一使用 0–1 的比例。
const activeDaysPercent = computed({
  get: () => Math.round(filterParams.value.activeDaysRatio * 100),
  set: (val: number) => { filterParams.value.activeDaysRatio = (val ?? 80) / 100 }
})

const isMobile = computed(() => windowWidth.value < 768)

const dialogTitle = computed(() =>
  mode.value === 'configured' ? `📋 配置列表（${data.value.length}）`
    : mode.value === 'stable' ? '📈 持续放量交易对 Top' + filterParams.value.top : '🔥 热门交易对 · 全部'
)

const defaultSort = computed<{ prop: string; order: 'ascending' | 'descending' }>(() =>
  mode.value === 'stable'
    ? { prop: 'avgDailyVolume', order: 'descending' }
    : { prop: 'volume', order: 'descending' }
)

// 表格 key：模式切换时强制重渲染以重置默认排序
const tableKey = computed(() => `${mode.value}-${sortProp.value}-${sortOrder.value}`)

const handleModeChange = () => {
  data.value = []
  message.value = ''
  updatedAt.value = null
  showFilterParams.value = false
  sortProp.value = 'volume'
  sortOrder.value = 'descending'
  fetchData()
}

const resetParams = () => {
  filterParams.value = { ...DEFAULT_FILTER_PARAMS }
}

const applyFilterParams = () => {
  showFilterParams.value = false
  fetchData()
}

const handleResize = () => {
  if (typeof window !== 'undefined') {
    windowWidth.value = window.innerWidth
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleResize)
}
onBeforeUnmount(() => {
  tableResizeObserver?.disconnect()
  requestId++
  stopProgressPolling()
  if (typeof window !== 'undefined') window.removeEventListener('resize', handleResize)
})

// 排序处理
const sortedData = computed(() => {
  const keyword = normalizeSymbol(search.value)
  // 使用官方合约类型区分 T 合约；未知类型不归入加密货币，避免误分类。
  const arr = data.value.filter(row =>
    (assetType.value === 'all' || row.contractType === (assetType.value === 'tradfi' ? 'TRADIFI_PERPETUAL' : 'PERPETUAL')) &&
    (!keyword || normalizeSymbol(row.symbol).includes(keyword))
  )
  arr.sort((a, b) => {
    let aVal = a[sortProp.value as keyof TopSymbol] as number
    let bVal = b[sortProp.value as keyof TopSymbol] as number
    // 缺失的周期行情始终置底，不将未知涨跌幅当作 0%。
    if (aVal == null || bVal == null) return aVal == null ? (bVal == null ? 0 : 1) : -1
    // activeDays 为字符串 "30/30"，排序时取分子
    if (sortProp.value === 'activeDays') {
      aVal = Number(String((a as any).activeDays || '0').split('/')[0])
      bVal = Number(String((b as any).activeDays || '0').split('/')[0])
    }
    return sortOrder.value === 'descending' ? bVal - aVal : aVal - bVal
  })
  return arr
})

// 概览跟随榜单和资产分类；搜索、排序和分页不改变市场样本范围。
const overviewRows = computed(() => data.value.filter(row =>
  assetType.value === 'all' || row.contractType === (assetType.value === 'tradfi' ? 'TRADIFI_PERPETUAL' : 'PERPETUAL')
))
const overviewScope = computed(() => `${mode.value === 'hot' ? '热门全量' : mode.value === 'stable' ? '持续放量结果' : '配置列表'} · ${assetType.value === 'all' ? '全部资产' : assetType.value === 'crypto' ? '加密货币' : '股票 T'}`)
// 热力图搜索仅定位区块，不裁切整个市场，也不隐藏当前选中交易对的详情。
const detailSymbol = computed(() => {
  const rows = props.embedded && viewMode.value === 'heatmap' ? overviewRows.value : sortedData.value
  return rows.find(row => row.symbol === detailSymbolKey.value) || rows[0]
})
const heatmapItems = computed(() => overviewRows.value.map(row => ({
  symbol: row.symbol, name: getSymbolDisplay(row.symbol),
  price: Number.isFinite(row.price) ? row.price : 0,
  volume: Number.isFinite(row.volume) && row.volume >= 0 ? row.volume : null,
  change: typeof row.priceChangePercent === 'number' && Number.isFinite(row.priceChangePercent) ? row.priceChangePercent : null,
  group: row.contractType === 'TRADIFI_PERPETUAL' ? '传统金融' : row.contractType === 'PERPETUAL' ? '加密资产' : '其他合约',
  icon: cryptoIconUrl(row.symbol),
})))

/** 热力图区块选择只更新详情，保留图内缩放和搜索状态。 */
function selectHeatmapSymbol(symbol: string) {
  detailSymbolKey.value = symbol
}

// 侧栏由页面作为独立网格项挂载；榜单只提供状态，避免把详情布局嵌入表格组件。
watch([overviewRows, detailSymbol, overviewScope], () => {
  if (props.embedded) emit('overview', { rows: overviewRows.value, selected: detailSymbol.value, scopeLabel: overviewScope.value })
}, { immediate: true })

/** 独立页单击展示详情，配置弹窗继续保持原来的勾选行为。 */
function handleRowClick(row: TopSymbol) {
  if (props.selectable) toggleRowSelection(row)
  else if (props.embedded) detailSymbolKey.value = row.symbol
}

let locateRequestId = 0
/** 异动榜定位须等待翻页渲染，再同步高亮和表格内部滚动，保证目标实际可见。 */
async function locateSymbol(symbol: string) {
  const currentLocate = ++locateRequestId
  // 异动榜复用当前视图：热力图通过selected-symbol定位，表格执行翻页滚动。
  if (props.embedded && viewMode.value === 'heatmap') {
    search.value = ''
    detailSymbolKey.value = symbol
    return
  }
  search.value = ''
  detailSymbolKey.value = symbol
  // 清空搜索会触发分页重置，等重置结束后再设置目标页。
  await nextTick()
  if (currentLocate !== locateRequestId) return
  const index = sortedData.value.findIndex(row => row.symbol === symbol)
  if (index < 0) return
  currentPage.value = Math.floor(index / pageSize.value) + 1
  await nextTick()
  if (currentLocate !== locateRequestId) return
  const rowIndex = pagedData.value.findIndex(row => row.symbol === symbol)
  if (rowIndex < 0) return
  const table = tableRef.value
  // 翻页会替换行对象，显式选中渲染后的对象，避免仅更新current-row-key时丢失高亮。
  table?.setCurrentRow(pagedData.value[rowIndex])
  const viewport = table?.$el?.querySelector('.el-table__body-wrapper .el-scrollbar__wrap') as HTMLElement | undefined
  const row = table?.$el?.querySelectorAll('.el-table__body-wrapper tbody tr.el-table__row')[rowIndex] as HTMLElement | undefined
  if (!viewport || !row) return
  // 仅滚动表格内部，防止scrollIntoView同时带动整页和右侧卡片。
  const top = viewport.scrollTop + row.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    - (viewport.clientHeight - row.getBoundingClientRect().height) / 2
  viewport.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

defineExpose({ locateSymbol })

// 先对全部结果筛选和排序，再截取当前页，保证跨页排序正确。
const pagedData = computed(() => props.embedded
  ? sortedData.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value)
  : sortedData.value)

/** 页内序号延续筛选结果的全局顺序。 */
function rowIndex(index: number): number {
  return (props.embedded ? (currentPage.value - 1) * pageSize.value : 0) + index + 1
}

watch([assetType, search, pageSize, sortProp, sortOrder, data], () => {
  currentPage.value = 1
})

const handleSortChange = (sortData: { prop: string | null; order: 'ascending' | 'descending' | null }) => {
  if (sortData.prop && sortData.order) {
    sortProp.value = sortData.prop
    sortOrder.value = sortData.order
  }
}

// 记录加载失败的图标（true=加载失败，显示占位符）
const iconFailed = ref<Record<string, boolean>>({})

// 图标加载失败时标记，自动切换到占位符
function onIconError(symbol: string) {
  iconFailed.value[symbol] = true
}

// 获取数据
const fetchData = async () => {
  const currentRequest = ++requestId
  stopProgressPolling()
  progress.value = null
  showingCachedResult.value = false
  loading.value = true
  message.value = ''
  // 配置标记不影响榜单内容，不能让辅助请求阻塞已命中缓存的行情展示。
  void fetchConfiguredSymbols()
  try {
    const query = mode.value === 'stable'
      ? {
          mode: 'stable',
          days: filterParams.value.days,
          minDataRatio: filterParams.value.minDataRatio,
          pool: filterParams.value.pool,
          top: filterParams.value.top,
          minDaily: filterParams.value.minDaily,
          activeDaysRatio: filterParams.value.activeDaysRatio,
          minRatio: filterParams.value.minRatio,
          cvMax: filterParams.value.cvMax,
          segmentRatio: filterParams.value.segmentRatio,
        }
      : { mode: mode.value }
    const cacheKey = JSON.stringify(query)
    const cached = mode.value === 'stable' ? stableResults.value[cacheKey] : undefined
    if (cached) {
      data.value = cached.data
      updatedAt.value = cached.updatedAt || null
      if (cached.params) {
        loadedDays.value = cached.params.days
        loadedActiveDaysRatio.value = cached.params.activeDaysRatio
      }
      sortProp.value = 'avgDailyVolume'
      showingCachedResult.value = true
    } else if (mode.value === 'stable') {
      startProgressPolling(query, currentRequest)
    }
    const res = await $fetch<TopSymbolsResponse>('/api/binance/top-symbols', { query })
    if (currentRequest !== requestId) return
    if (res.success) {
      if (res.mode === 'stable') {
        const keys = Object.keys(stableResults.value)
        if (keys.length >= 20 && !stableResults.value[cacheKey]) delete stableResults.value[keys[0]!]
        stableResults.value[cacheKey] = res
      }
      data.value = res.data
      if (res.params) {
        loadedDays.value = res.params.days
        loadedActiveDaysRatio.value = res.params.activeDaysRatio
      }
      updatedAt.value = res.updatedAt || null
      if (res.mode === 'hot-fallback') {
        message.value = res.message || '持续放量筛选失败，已降级为 24h 热门'
      }
      // 切换回默认排序基准列
      sortProp.value = mode.value === 'stable' ? 'avgDailyVolume' : 'volume'
      sortOrder.value = 'descending'
      clearSelection()
    } else {
      message.value = res.message || '获取行情失败，请重试'
    }
  } catch (err: any) {
    if (currentRequest !== requestId) return
    console.error('获取热门交易对失败:', err)
    message.value = `获取数据失败: ${err?.message || '未知错误'}`
  } finally {
    if (currentRequest === requestId) {
      stopProgressPolling()
      loading.value = false
    }
  }
}

// ==================== 多选逻辑 ====================

/** 表格勾选变化时同步选中行 */
const handleSelectionChange = (rows: TopSymbol[]) => {
  selectedRows.value = rows
}

/** 切换单行选中状态（点击行或交易对名称） */
const toggleRowSelection = (row: any) => {
  tableRef.value?.toggleRowSelection(row, undefined)
}

/** 全部选择：勾选当前列表所有交易对 */
const selectAll = () => {
  sortedData.value.forEach(row => {
    tableRef.value?.toggleRowSelection(row, true)
  })
}

/** 清空所有勾选 */
const clearSelection = () => {
  tableRef.value?.clearSelection()
}

/** 确认选择：一次性把勾选的多个交易对发给父组件并关闭 */
const confirmSelect = () => {
  if (selectedRows.value.length === 0) return
  emit('select', selectedRows.value.map(r => r.symbol))
  clearSelection()
  visible.value = false
}

// 获取加密货币图标（由币安官方清单驱动；无图标时返回空串，触发占位符显示）
function cryptoIconUrl(symbol: string): string {
  return getCoinIconUrl(symbol) || ''
}

function getSymbolDisplay(symbol: string): string {
  return symbol.replace('USDT', '')
}

// 为币种生成稳定的随机颜色
function getRandomColor(symbol: string) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i)
    hash |= 0
  }
  const color = Math.abs(hash).toString(16).substring(0, 6).padStart(6, '0')
  return `#${color}`
}

// 格式化（B/M/K 单位）
const formatVolume = (val: number): string => {
  if (val == null || isNaN(val)) return '--'
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B'
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M'
  if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K'
  return val.toFixed(2)
}

function formatPrice(value: number | undefined | null): string {
  if (value == null || isNaN(value) || !isFinite(value)) return '--'
  if (value === 0) return '0'

  const absVal = Math.abs(value)
  let maxFractionDigits = 2

  if (absVal < 0.001) {
    maxFractionDigits = 6
  } else if (absVal < 0.01) {
    maxFractionDigits = 5
  } else if (absVal < 0.1) {
    maxFractionDigits = 4
  } else if (absVal < 1) {
    maxFractionDigits = 3
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  })
}

const percentClass = (val: number): string => {
  return val >= 0 ? 'color-up' : 'color-down'
}

const fundingClass = (val: number): string => {
  return val >= 0 ? 'color-up' : 'color-down'
}

/** 稳定性 CV 颜色分级：< 0.3 稳定绿，0.3~0.6 一般橙，> 0.6 波动大红 */
const cvClass = (val: number | undefined): string => {
  if (val === undefined) return ''
  if (val < 0.3) return 'color-up'
  if (val <= 0.6) return 'color-warn'
  return 'color-down'
}

// 监听对话框打开时刷新数据
watch(() => props.embedded || visible.value, (newVal) => {
  if (newVal) {
    fetchData()
  } else {
    showFilterParams.value = false
  }
}, { immediate: true })
</script>

<style scoped>
.top-symbols-container {
  max-height: 60vh;
  overflow-y: auto;
}

.top-symbols-container-drawer {
  max-height: none;
}

.market-filters {
  display: flex;
  flex: 1 1 390px;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.market-filters :deep(.el-radio-group), .mode-switch { flex-shrink: 0; }
.symbol-search { flex: 0 0 120px; width: 120px; }
.symbol-search :deep(.el-input__wrapper) { border-radius: 4px; padding: 0 8px; }
.symbol-search :deep(.el-input__prefix) { font-size: 12px; }
.market-pagination { margin-top: 16px; justify-content: flex-end; }
.market-main { min-width: 0; }
.market-heatmap { display: flex; flex: 1; flex-direction: column; min-height: 0; gap: 10px; }
.heatmap-caption { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.heatmap-size-select { width: 130px; flex-shrink: 0; }
.market-heatmap-chart { flex: 1; min-height: 0; height: auto !important; }

.top-symbols-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.toolbar-actions .el-button + .el-button {
  margin-left: 0;
}

.toolbar-hint {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.data-updated-at {
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

.stable-params {
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px;
}

.stable-progress { margin: 12px 0; padding: 12px; border-radius: 6px; background: var(--el-fill-color-light); }
.progress-caption { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 8px; font-size: 12px; color: var(--el-text-color-regular); }
.progress-note { color: var(--el-text-color-secondary); }

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  padding: 4px 8px;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-item label {
  font-size: 12px;
  color: #606266;
  font-weight: 500;
}

.param-desc {
  font-size: 11px;
  color: #909399;
}

.params-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px;
}

.stable-alert {
  margin-bottom: 10px;
}

.selection-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.selection-count {
  font-size: 13px;
  color: #606266;
}

.selection-buttons {
  display: flex;
  gap: 8px;
}

.color-up {
  color: var(--el-color-success);
}

.color-down {
  color: var(--el-color-danger);
}

.color-warn {
  color: var(--el-color-warning);
}

.symbol-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.symbol-cell .el-tag {
  margin-left: 2px;
  flex-shrink: 0;
}

.configured-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-success);
  flex-shrink: 0;
}

.crypto-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.crypto-icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
  line-height: 1;
}

@media (max-width: 768px) {
  .top-symbols-container {
    max-height: 82vh;
  }
  .top-symbols-container-drawer {
    max-height: none;
  }
  .top-symbols-toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }
  .market-filters { flex-basis: 100%; gap: 8px; }
  .params-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .selection-actions {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }
  .selection-buttons {
    justify-content: flex-end;
  }
}
.top-symbols-container-page { display: flex; flex-direction: column; height: 100%; min-height: 0; max-height: none; overflow: hidden; }
.top-symbols-container-page .market-main { display: flex; flex: 1; flex-direction: column; min-height: 0; margin-top: 8px; }
/* 表格内部滚动，工具栏和分页保留在可见区，长列表不会撑开页面。 */
.top-symbols-container-page .market-main > .el-table { flex: 1; min-height: 0; }
.top-symbols-container-page :deep(.el-table__row) { cursor: pointer; }
/* 暗色全局样式会让单元格继承普通行背景；选中态须优先于斑马纹和悬停态。 */
.top-symbols-container-page :deep(.el-table__body tr.current-row > td.el-table__cell) {
  background-color: color-mix(in srgb, var(--color-primary) 20%, var(--bg-card)) !important;
}
.top-symbols-container-page :deep(.el-table__body tr.current-row > td.el-table__cell:first-child) {
  box-shadow: inset 3px 0 0 var(--color-primary);
}
/* 表头保持紧凑，数据行在可用空间内适度伸展，分页紧跟表格底部。 */
.top-symbols-container-page :deep(.el-table__header .el-table__cell) { padding: 2px 0; }
.top-symbols-container-page :deep(.el-table__body .el-table__cell) { padding: var(--market-row-padding, 2px) 0; }
.top-symbols-container-page :deep(.el-table .cell) { line-height: 22px; }
.top-symbols-container-page .market-pagination { flex-shrink: 0; flex-wrap: wrap; row-gap: 8px; margin-top: 8px; }
.top-symbols-container-page .stable-params { flex-shrink: 1; min-height: 0; max-height: 40%; overflow: auto; }
.top-symbols-container-page .stable-progress, .top-symbols-container-page .stable-alert { flex-shrink: 0; }
/* 独立页直接以榜单模式和刷新操作作为页头，替代重复的标题与返回按钮。 */
.top-symbols-container-page .top-symbols-toolbar {
  /* 工具栏始终留在容器内；负边距会被上层 overflow:hidden 裁掉顶部按钮。 */
  margin: 0;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
</style>
