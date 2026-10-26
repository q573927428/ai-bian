<!-- ==================== 热门及持续放量交易对榜单 ==================== -->
<template>
  <component
    :is="selectable ? ElDialog : ElDrawer"
    v-model="visible"
    :title="dialogTitle"
    v-bind="selectable
      ? { width: '66%', fullscreen: isMobile, top: '22vh', draggable: true }
      : { direction: 'rtl', size: isMobile ? '100%' : '75%' }"
    append-to-body
  >
    <div class="top-symbols-container" :class="{ 'top-symbols-container-drawer': !selectable }">
      <!-- 模式切换与工具栏 -->
      <div class="top-symbols-toolbar">
        <el-radio-group v-model="mode" size="small" @change="handleModeChange">
          <el-radio-button value="hot">🔥 24h 热门</el-radio-button>
          <el-radio-button value="stable">📈 持续放量</el-radio-button>
          <el-radio-button value="configured">📋 配置列表</el-radio-button>
        </el-radio-group>
        <div class="toolbar-actions">
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

      <div v-if="mode === 'stable' && updatedAt" class="data-updated-at">
        数据更新于 {{ new Date(updatedAt).toLocaleString('zh-CN') }}
      </div>

      <div v-if="selectable && mode === 'hot'" class="toolbar-hint">
        勾选交易对后点击底部"添加选中到列表"可批量添加
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
            <span class="param-desc">窗口日均成交额及活跃日的单日成交额须 ≥ 此值</span>
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

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="sortedData"
        stripe
        row-key="symbol"
        style="width: 100%"
        size="small"
        @sort-change="handleSortChange"
        @row-click="selectable && toggleRowSelection($event)"
        @selection-change="handleSelectionChange"
        :default-sort="defaultSort"
        :key="tableKey"
      >
        <el-table-column v-if="selectable" type="selection" width="40" reserve-selection />
        <el-table-column type="index" label="#" width="50" />

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
              <el-link type="primary" :underline="false" :style="{ cursor: selectable ? 'pointer' : 'default' }" @click.stop="selectable && toggleRowSelection(row)">
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
import { ref, computed, watch } from 'vue'
import { ElDialog, ElDrawer } from 'element-plus'
import { useCoinIcon } from '../composables/useCoinIcon'

const { getCoinIconUrl } = useCoinIcon()

type Mode = 'hot' | 'stable' | 'configured'

/** 热门及持续放量榜单的交易对行情。 */
interface TopSymbol {
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
  pool: number
  top: number
  minDaily: number
  activeDaysRatio: number // 最低活跃天数占统计窗口的比例（0–1）
  minRatio: number
  cvMax: number
  segmentRatio: number
}

/** 与服务端 FILTER_DEFAULTS 保持一致的默认值 */
const DEFAULT_FILTER_PARAMS: FilterParams = {
  days: 30,
  pool: 100,
  top: 50,
  minDaily: 50_000_000,
  activeDaysRatio: 0.8,
  minRatio: 0.02,
  cvMax: 1.0,
  segmentRatio: 0.2,
}

/** 榜单弹窗参数；selectable 仅在配置表单添加交易对时启用。 */
interface Props {
  modelValue: boolean
  selectable?: boolean
}

/** 配置表单通过 select 接收选中的交易对。 */
interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'select', symbols: string[]): void
}

const props = withDefaults(defineProps<Props>(), { selectable: true })
const emit = defineEmits<Emits>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const loading = ref(false)
const data = ref<TopSymbol[]>([])
const mode = ref<Mode>('hot')
const message = ref('')
const updatedAt = ref<number | null>(null)
const sortProp = ref('volume')
const sortOrder = ref<'ascending' | 'descending'>('descending')
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
const tableRef = ref()
const selectedRows = ref<TopSymbol[]>([])
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
    const res = await $fetch<{ success: boolean; data?: { symbols?: string[] } }>('/api/bot/config')
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

// 前端以百分数输入，接口统一使用 0–1 的比例。
const activeDaysPercent = computed({
  get: () => Math.round(filterParams.value.activeDaysRatio * 100),
  set: (val: number) => { filterParams.value.activeDaysRatio = (val ?? 80) / 100 }
})

const isMobile = computed(() => windowWidth.value < 768)

const dialogTitle = computed(() =>
  mode.value === 'configured' ? `📋 配置列表（${data.value.length}）`
    : mode.value === 'stable' ? '📈 持续放量交易对 Top' + filterParams.value.top : '🔥 热门交易对 Top 100'
)

const defaultSort = computed<{ prop: string; order: 'ascending' | 'descending' }>(() =>
  mode.value === 'stable'
    ? { prop: 'avgDailyVolume', order: 'descending' }
    : { prop: 'volume', order: 'descending' }
)

// 表格 key：模式切换时强制重渲染以重置默认排序
const tableKey = computed(() => `${mode.value}-${sortProp.value}-${sortOrder.value}`)

const handleModeChange = () => {
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

// 排序处理
const sortedData = computed(() => {
  const arr = [...data.value]
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
  loading.value = true
  message.value = ''
  try {
    const query = mode.value === 'stable'
      ? {
          mode: 'stable',
          days: filterParams.value.days,
          pool: filterParams.value.pool,
          top: filterParams.value.top,
          minDaily: filterParams.value.minDaily,
          activeDaysRatio: filterParams.value.activeDaysRatio,
          minRatio: filterParams.value.minRatio,
          cvMax: filterParams.value.cvMax,
          segmentRatio: filterParams.value.segmentRatio,
        }
      : { mode: mode.value }
    const [res] = await Promise.all([$fetch<{
      success: boolean
      mode?: string
      message?: string
      updatedAt?: number
      params?: FilterParams
      data: TopSymbol[]
    }>('/api/binance/top-symbols', { query }), fetchConfiguredSymbols()])
    if (res.success) {
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
    }
  } catch (err: any) {
    console.error('获取热门交易对失败:', err)
    message.value = `获取数据失败: ${err?.message || '未知错误'}`
  } finally {
    loading.value = false
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
watch(visible, (newVal) => {
  if (newVal) {
    fetchData()
  } else {
    showFilterParams.value = false
  }
})
</script>

<style scoped>
.top-symbols-container {
  max-height: 60vh;
  overflow-y: auto;
}

.top-symbols-container-drawer {
  max-height: none;
}

.top-symbols-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
  margin: -4px 0 8px;
  color: #909399;
  font-size: 12px;
}

.stable-params {
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px;
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
</style>
