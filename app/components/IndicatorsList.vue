<template>
  <el-drawer
    v-model="visible"
    class="indicators-drawer"
    title="指标看板"
    direction="rtl"
    size="60%"
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
    <el-table v-loading="loading" class="indicators-table" :data="rows" stripe size="small" style="width: 100%">
      <el-table-column prop="symbol" label="交易对" fixed min-width="105" />
      <el-table-column label="价格 / K线" min-width="145">
        <template #default="{ row }">
          <div>{{ formatPrice(row.price) }}</div>
          <span :class="directionClass(row.closeChangePercent)">{{ signed(row.closeChangePercent) }}%</span>
          <span class="muted"> · {{ row.candleDirectionLabel }}</span>
        </template>
      </el-table-column>
      <el-table-column label="趋势" min-width="125">
        <template #default="{ row }">
          <div>ADX {{ format(row.adx) }}</div>
          <span :class="row.emaBullish ? 'up' : 'down'">EMA {{ row.emaBullish ? '多头' : '空头' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="RSI" min-width="80" sortable="custom" prop="rsi">
        <template #default="{ row }"><span :class="rsiClass(row.rsi)">{{ format(row.rsi) }}</span></template>
      </el-table-column>
      <el-table-column label="MACD柱" min-width="95" sortable="custom" prop="macdHistogram">
        <template #default="{ row }"><span :class="directionClass(row.macdHistogram)">{{ signed(row.macdHistogram) }}</span></template>
      </el-table-column>
      <el-table-column label="波动 ATR%" min-width="105" prop="atrPercent">
        <template #default="{ row }">{{ format(row.atrPercent) }}%</template>
      </el-table-column>
      <el-table-column label="OI变化" min-width="100" prop="oiChangePercent">
        <template #default="{ row }"><span :class="directionClass(row.oiChangePercent)">{{ signed(row.oiChangePercent) }}%</span></template>
      </el-table-column>
      <el-table-column label="成交量" min-width="90" prop="volumeRatio">
        <template #default="{ row }">{{ format(row.volumeRatio) }}x</template>
      </el-table-column>
      <el-table-column label="情绪" min-width="110">
        <template #default="{ row }"><span :class="directionClass(row.sentiment)">{{ row.sentimentLabel }}</span></template>
      </el-table-column>
      <el-table-column label="数据" min-width="80">
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

/** 指标列表中的单个交易对展示数据。 */
interface IndicatorRow {
  symbol: string; price?: number; closeChangePercent?: number; candleDirectionLabel: string
  adx?: number; rsi?: number; macdHistogram?: number; atrPercent?: number; oiChangePercent?: number
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
const timeframe = ref('1h')
const timeframes = ['5m', '15m', '1h', '4h', '1d']
const rows = ref<IndicatorRow[]>([])
const loading = ref(false)
const errorMessage = ref('')
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
      const response: any = await $fetch('/api/bot/indicators', { query: { symbol, timeframe: timeframe.value } })
      return toRow(response.data)
    } catch { return null }
  }))
  rows.value = results.filter(Boolean) as IndicatorRow[]
  if (rows.value.length === 0) errorMessage.value = '指标暂不可用，请确认指标中心已完成初始化'
  loading.value = false
}

/** 将完整诊断结果转换为适合横向比较的列表字段。 */
function toRow(data: any): IndicatorRow {
  const values = (name: string) => data?.indicators?.[name]?.values || {}
  const ema = values('ema').emaMap || {}
  const price = Number(data?.kline?.latest?.close)
  const atr = Number(values('atr').atr)
  const heat = values('squareHeat')
  const sentiment = Number(heat.netDirectionalSentimentPercent ?? heat.changePercent)
  return {
    symbol: data.symbol, price, closeChangePercent: Number(data.kline?.closeChangePercent),
    candleDirectionLabel: data.kline?.candleDirection === 'bullish' ? '阳线' : data.kline?.candleDirection === 'bearish' ? '阴线' : '平',
    adx: Number(values('adx').adx), rsi: Number(values('rsi').rsi), macdHistogram: Number(values('macd').histogram),
    atrPercent: price > 0 ? atr / price * 100 : undefined, oiChangePercent: Number(values('oi').changePercent),
    volumeRatio: Number(values('volume').ratio), sentiment, sentimentLabel: Number.isFinite(sentiment) ? (sentiment > 0 ? '偏多' : sentiment < 0 ? '偏空' : '中性') : '--',
    emaBullish: Number(ema.EMA14) >= Number(ema.EMA50), stale: Number(data?.kline?.dataAgeMs) > 2 * 60 * 60 * 1000
  }
}

function format(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toFixed(2) }
function signed(value?: number) { return value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}` }
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 }) }
function directionClass(value?: number) { return value == null ? 'muted' : value >= 0 ? 'up' : 'down' }
function rsiClass(value?: number) { return value != null && value >= 70 ? 'down' : value != null && value <= 30 ? 'up' : 'muted' }
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

@media (max-width: 768px) { .toolbar { align-items: flex-start; flex-direction: column; } }
</style>
