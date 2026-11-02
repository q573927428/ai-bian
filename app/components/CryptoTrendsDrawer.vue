<!-- ==================== 加密市场六图趋势看板 ==================== -->
<template>
  <component :is="embedded ? 'section' : ElDrawer" v-model="visible" title="加密市场趋势" size="90%" destroy-on-close :class="embedded ? 'trends-content' : 'crypto-trends-drawer'">
    <div class="trends-toolbar">
      <span>价格 · 相对强弱 · 机构资金 · 流动性 · 杠杆风险</span>
      <div class="toolbar-actions">
        <el-radio-group v-model="days" size="small"><el-radio-button v-for="value in [30, 90, 365]" :key="value" :value="value">{{ value === 365 ? '近1年' : `近${value}天` }}</el-radio-button></el-radio-group>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>
    <div v-if="error" class="request-error">{{ error }}</div>
    <div class="trends-grid">
      <section v-for="panel in panels" :key="panel.title" class="trend-panel">
        <header><strong>{{ panel.title }}</strong><small>{{ panel.date ? `数据至 ${panel.date}` : '暂无数据' }}<span v-if="panel.stale"> · 待同步</span></small></header>
        <div class="panel-controls">
          <small>{{ panel.source }}</small>
          <el-radio-group v-if="panel.prices" v-model="priceMode" size="small"><el-radio-button value="change">涨跌幅</el-radio-button><el-radio-button value="price">价格</el-radio-button></el-radio-group>
          <el-radio-group v-if="panel.supply" v-model="supplyMode" size="small"><el-radio-button value="total">总量</el-radio-button><el-radio-button value="change">30日变化</el-radio-button></el-radio-group>
        </div>
        <div v-if="panel.dominance" class="dominance-stats">
          <span>最新 <strong>{{ dominanceSummary.value }}</strong></span>
          <span>7日 <strong>{{ dominanceSummary.week }}</strong></span>
          <span>30日 <strong>{{ dominanceSummary.month }}</strong></span>
        </div>
        <div class="panel-chart">
          <CryptoTrendChart v-if="panel.series.some(s => s.points.length)" :series="panel.series" :days="days" :format="panel.supply ? (supplyMode === 'change' ? 'percent' : 'money') : panel.format" />
          <div v-else class="chart-empty">{{ loading ? '读取缓存中…' : '暂无历史数据，等待服务端同步' }}</div>
        </div>
        <footer>{{ panel.note }}</footer>
      </section>
    </div>
  </component>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import type { CryptoTrendsResponse, CryptoTrendKey, TrendPoint } from '../../types/crypto-trends'
import { rollingDisclosedFlows, changeOver30Days, relativePriceChanges, latestDayChange } from '../utils/crypto-trend-calculations'
import CryptoTrendChart from './CryptoTrendChart.vue'

// 页面模式沿用抽屉的数据请求与卸载清理，避免维护两套业务逻辑。
const props = withDefaults(defineProps<{ modelValue: boolean; embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const data = ref<CryptoTrendsResponse | null>(null)
const loading = ref(false)
const error = ref('')
const days = ref(90)
const supplyMode = ref('total')
const priceMode = ref('change')
let timer: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined
const points = (key: CryptoTrendKey) => data.value?.metrics[key]?.points ?? []
const latest = (rows: TrendPoint[]) => rows.at(-1)?.date
const status = (keys: CryptoTrendKey[]) => keys.some(key => data.value?.metrics[key]?.stale ?? true)
const coverage = (key: CryptoTrendKey) => data.value?.metrics[key]?.coverage.join('、') || '等待同步'
const dominanceSummary = computed(() => {
  const rows = data.value?.prices.btcdom ?? []
  const formatChange = (value: number | null) => value === null ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  return {
    value: rows.length ? `${rows.at(-1)!.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} 点` : '--',
    week: formatChange(latestDayChange(rows, 7)),
    month: formatChange(latestDayChange(rows, 30)),
  }
})
const panels = computed(() => {
  const btc = data.value?.prices.btc ?? [], eth = data.value?.prices.eth ?? [], btcdom = data.value?.prices.btcdom ?? []
  const [btcChange, ethChange] = relativePriceChanges(btc, eth, days.value)
  const priceChange = priceMode.value === 'change'
  const format: 'money' | 'percent' = priceChange ? 'percent' : 'money'
  const dateRange = (keys: CryptoTrendKey[]) => keys.map(key => latest(points(key)) ?? '--').join(' / ')
  return [
    { title: 'BTC / ETH 走势', source: priceChange ? '币安 · 本地日线 · 区间涨跌幅' : '币安 · 本地日线 · USDT · BTC左轴 / ETH右轴', date: `${latest(btc) ?? '--'} / ${latest(eth) ?? '--'}`, stale: false, prices: true, format, note: priceChange ? '以所选区间首个共同有效日为0%；缺失日不补值。当日日线尚未收盘。' : '日线收盘价；BTC左轴、ETH右轴，双轴仅对照价格，不代表涨幅相同。当日日线尚未收盘。', series: [{ name: 'BTC', points: priceChange ? btcChange : btc, color: '#f59e0b' }, { name: priceChange ? 'ETH' : 'ETH（右轴）', points: priceChange ? ethChange : eth, color: '#9b87f5', right: !priceChange }] },
    { title: 'BTC 主导指数', source: '币安 · BTCDOM/USDT · 本地日线 · 指数点位', date: latest(btcdom), stale: false, dominance: true, format: 'index' as const, note: '上涨表示BTC相对指数篮子山寨币走强，下跌表示走弱；非全市场市占率%。涨跌幅相对最新数据日，缺少基准日显示--；当日未收盘。', series: [{ name: 'BTCDOM', points: btcdom, color: '#38bdf8' }] },
    { title: 'ETF 资金流', source: 'The Block · 美元', date: dateRange(['btcEtf', 'ethEtf']), stale: status(['btcEtf', 'ethEtf']), note: '柱：单日净流入；虚线/右轴：7自然日已披露累计。非交易日不补零，注意来源延迟。', series: [
      { name: 'BTC 单日', points: points('btcEtf'), color: '#f59e0b', bar: true }, { name: 'ETH 单日', points: points('ethEtf'), color: '#9b87f5', bar: true },
      { name: 'BTC 7日累计', points: rollingDisclosedFlows(points('btcEtf')), color: '#fbbf24', right: true, dashed: true }, { name: 'ETH 7日累计', points: rollingDisclosedFlows(points('ethEtf')), color: '#c4b5fd', right: true, dashed: true },
    ] },
    { title: '稳定币供应量', source: 'The Block / DefiLlama · 美元面值', date: latest(points('stablecoinSupply')), stale: status(['stablecoinSupply']), supply: true, note: '美元锚定稳定币供应合计；30日变化需有准确基准日。供应增长不等于买盘净流入。', series: [{ name: supplyMode.value === 'total' ? '总供应' : '30日变化率', points: supplyMode.value === 'total' ? points('stablecoinSupply') : changeOver30Days(points('stablecoinSupply')), color: '#22c5cb' }] },
    { title: '主要交易所持仓 OI', source: 'The Block · 名义美元价值', date: dateRange(['btcOi', 'ethOi']), stale: status(['btcOi', 'ethOi']), note: `最新覆盖 BTC：${coverage('btcOi')}；ETH：${coverage('ethOi')}。`, series: [{ name: 'BTC 持仓', points: points('btcOi'), color: '#f59e0b' }, { name: 'ETH 持仓', points: points('ethOi'), color: '#9b87f5' }] },
    { title: '多空清算', source: 'The Block / CoinGlass · 美元；BTC：币安 · USDT', date: dateRange(['longLiquidations', 'shortLiquidations']), stale: status(['longLiquidations', 'shortLiquidations']), note: '多头向上（绿色）、空头向下（红色），正负仅表示方向；BTC价格线对应右轴。清算以 UTC 16:00 为日界，最新日可能尚未完整；BTC为UTC日线收盘价，统计窗口不同。', series: [{ name: '多头清算', points: points('longLiquidations'), color: '#35c98c', bar: true, stack: 'liquidations' }, { name: '空头清算', points: points('shortLiquidations').map(p => ({ ...p, value: -p.value })), color: '#f56c6c', bar: true, stack: 'liquidations' }, { name: 'BTC 价格（右轴）', points: btc, color: '#f59e0b', right: true }] },
  ]
})

/** 只刷新本站缓存；关闭抽屉即停止轮询并取消未完成请求。 */
async function load() {
  if (loading.value) return
  loading.value = true
  controller = new AbortController()
  try { data.value = await $fetch<CryptoTrendsResponse>('/api/market/trends', { signal: controller.signal, timeout: 15000, retry: 0 }); error.value = '' }
  catch { if (visible.value) error.value = '历史数据读取失败，请重试；已有图表仍保留。' }
  finally { loading.value = false }
}
watch(visible, value => {
  clearInterval(timer)
  if (value) { void load(); timer = setInterval(() => { void load() }, 60000) }
  else controller?.abort()
}, { immediate: true })
onUnmounted(() => { clearInterval(timer); controller?.abort() })
</script>
<style scoped>
.trends-content { padding: 10px; background: var(--bg-main); }
.trends-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; color: var(--text-regular); font-size: 13px; }
.toolbar-actions { display: flex; gap: 10px; align-items: center; }
.trends-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.trend-panel { display: flex; flex-direction: column; min-width: 0; height: max(330px, calc((100dvh - 170px) / 2)); border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--bg-card); overflow: hidden; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; padding: 10px 12px 4px; color: var(--text-primary); font-size: 13px; }
small, footer { color: var(--text-secondary); font-size: 11px; }
.panel-controls { min-height: 28px; padding: 0 12px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.dominance-stats { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 4px 12px; color: var(--text-secondary); font-size: 11px; }
.dominance-stats strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.panel-chart { flex: 1; min-height: 180px; }
footer { padding: 6px 12px; line-height: 1.5; max-height: 52px; overflow-y: auto; border-top: 1px solid var(--el-border-color-lighter); }
.chart-empty { height: 100%; display: grid; place-items: center; font-size: 12px; color: var(--text-secondary); }
.request-error { color: var(--el-color-danger); margin-bottom: 8px; font-size: 12px; }
:global(.crypto-trends-drawer .el-drawer__header) { margin-bottom: 0; padding: 14px 16px; }
:global(.crypto-trends-drawer .el-drawer__body) { padding: 10px 10px 40px; background: var(--bg-main); }
@media(max-width: 1100px) { .trends-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media(max-width: 680px) { .trends-grid { grid-template-columns: minmax(0, 1fr); } .trend-panel { height: 350px; } .toolbar-actions { flex-wrap: wrap; } }
</style>
