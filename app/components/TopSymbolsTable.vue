<template>
  <el-dialog
    v-model="visible"
    title="🔥 热门交易对 Top 30"
    width="40%"
    :fullscreen="isMobile"
    :close-on-click-modal="false"
    top="32vh"
  >
    <div class="top-symbols-container">
      <div class="top-symbols-toolbar">
        <span class="toolbar-hint">点击交易对名称可快速添加到配置列表中</span>
        <el-button type="primary" size="small" :loading="loading" @click="fetchData">
          <el-icon><ElIconRefresh /></el-icon>
          刷新数据
        </el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="sortedData"
        stripe
        highlight-current-row
        style="width: 100%"
        size="small"
        @sort-change="handleSortChange"
        @row-click="(row) => handleSelect(row.symbol)"
        :default-sort="{ prop: 'volume', order: 'descending' }"
      >
        <el-table-column type="index" label="#" width="50" />

        <el-table-column
          prop="symbol"
          label="交易对"
          min-width="160"
        >
          <template #default="{ row }">
            <div class="symbol-cell">
              <template v-if="!iconFailed[row.symbol]">
                <img
                  :src="getCryptoIcon(row.symbol)"
                  :alt="getSymbolDisplay(row.symbol)"
                  class="crypto-icon"
                  @error="onIconError(row.symbol)"
                />
              </template>
              <span v-else
                class="crypto-icon-placeholder"
                :style="{ backgroundColor: getRandomColor(getSymbolDisplay(row.symbol)) }"
              >{{ getSymbolDisplay(row.symbol).substring(0, 1).toUpperCase() }}</span>
              <el-link type="primary" :underline="false" style="cursor: pointer;" @click="handleSelect(row.symbol)">
                {{ row.symbol.replace('USDT', '/USDT') }}
              </el-link>
            </div>
          </template>
        </el-table-column>

        <el-table-column
          prop="volume"
          label="成交额 (USDT)"
          sortable="custom"
          min-width="140"
        >
          <template #default="{ row }">
            {{ formatVolume(row.volume) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="price"
          label="价格 (USDT)"
          sortable="custom"
          min-width="130"
        >
          <template #default="{ row }">
            {{ formatPrice(row.price) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="priceChangePercent"
          label="24h涨跌幅"
          sortable="custom"
          min-width="110"
        >
          <template #default="{ row }">
            <span :class="percentClass(row.priceChangePercent)">
              {{ row.priceChangePercent >= 0 ? '+' : '' }}{{ row.priceChangePercent.toFixed(2) }}%
            </span>
          </template>
        </el-table-column>

        <el-table-column
          prop="fundingRate"
          label="资金费率"
          sortable="custom"
          min-width="100"
        >
          <template #default="{ row }">
            <span :class="fundingClass(row.fundingRate)">
              {{ row.fundingRate.toFixed(4) }}%
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface TopSymbol {
  symbol: string
  volume: number
  price: number
  priceChangePercent: number
  fundingRate: number
  klineCount4h: number
  onboardDate: number
}

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'select', symbol: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const loading = ref(false)
const data = ref<TopSymbol[]>([])
const sortProp = ref('volume')
const sortOrder = ref<'ascending' | 'descending'>('descending')
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

const isMobile = computed(() => windowWidth.value < 768)

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
    const aVal = a[sortProp.value as keyof TopSymbol] as number
    const bVal = b[sortProp.value as keyof TopSymbol] as number
    return sortOrder.value === 'descending' ? bVal - aVal : aVal - bVal
  })
  return arr
})

const handleSortChange = ({ prop, order }: { prop: string, order: string }) => {
  if (prop && order) {
    sortProp.value = prop
    sortOrder.value = order as 'ascending' | 'descending'
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
  try {
    const res = await $fetch<{ success: boolean; data: TopSymbol[] }>('/api/binance/top-symbols')
    if (res.success) {
      data.value = res.data
    }
  } catch (err: any) {
    console.error('获取热门交易对失败:', err)
  } finally {
    loading.value = false
  }
}

// 选择交易对
const handleSelect = (symbol: string) => {
  emit('select', symbol)
  visible.value = false
}

// 获取加密货币图标（使用本地图标）
function getCryptoIcon(symbol: string): string {
  const base = symbol.replace('USDT', '').toLowerCase()
  return `/assets/crypto-icons/${base}.png`
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

// 格式化
const formatVolume = (val: number): string => {
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

// 监听对话框打开时刷新数据
watch(visible, (newVal) => {
  if (newVal) {
    fetchData()
  }
})
</script>

<style scoped>
.top-symbols-container {
  max-height: 38vh;
  overflow-y: auto;
}

.top-symbols-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toolbar-hint {
  font-size: 12px;
  color: #909399;
}

.color-up {
  color: var(--el-color-success);
}

.color-down {
  color: var(--el-color-danger);
}

.symbol-cell {
  display: flex;
  align-items: center;
  gap: 6px;
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
    max-height: 80vh;
  }
}
</style>