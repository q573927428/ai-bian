<!-- ==================== 加密市场六图趋势看板 ==================== -->
<template>
  <el-drawer v-model="visible" title="加密市场趋势" size="96%" destroy-on-close class="crypto-trends-drawer">
    <div class="trends-toolbar">
      <span>价格 · 机构资金 · 流动性 · 杠杆风险</span>
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
          <el-radio-group v-if="panel.supply" v-model="supplyMode" size="small"><el-radio-button value="total">总量</el-radio-button><el-radio-button value="change">30日变化</el-radio-button></el-radio-group>
        </div>
        <div class="panel-chart">
          <CryptoTrendChart v-if="panel.series.some(s => s.points.length)" :series="panel.series" :days="days" :percent="panel.supply && supplyMode === 'change'" />
          <div v-else class="chart-empty">{{ loading ? '读取缓存中…' : '暂无历史数据，等待服务端同步' }}</div>
        </div>
        <footer>{{ panel.note }}</footer>
      </section>
    </div>
  </el-drawer>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { CryptoTrendsResponse, CryptoTrendKey, TrendPoint } from '../../types/crypto-trends'
import { rollingDisclosedFlows, changeOver30Days } from '../utils/crypto-trend-calculations'
import CryptoTrendChart from './CryptoTrendChart.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const data = ref<CryptoTrendsResponse | null>(null)
const loading = ref(false)
const error = ref('')
const days = ref(90)
const supplyMode = ref('total')
let timer: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined
const points = (key: CryptoTrendKey) => data.value?.metrics[key]?.points ?? []
const latest = (rows: TrendPoint[]) => rows.at(-1)?.date
const status = (keys: CryptoTrendKey[]) => keys.some(key => data.value?.metrics[key]?.stale ?? true)
const coverage = (key: CryptoTrendKey) => data.value?.metrics[key]?.coverage.join('、') || '等待同步'
const panels = computed(() => {
  const btc = data.value?.prices.btc ?? [], eth = data.value?.prices.eth ?? []
  const dateRange = (keys: CryptoTrendKey[]) => keys.map(key => latest(points(key)) ?? '--').join(' / ')
  return [
    { title: 'BTC 价格趋势', source: '币安 · 本地日线 · USDT', date: latest(btc), stale: false, note: '日线收盘价；当日日线尚未收盘，仅展示本地已有历史。', series: [{ name: 'BTC', points: btc, color: '#f59e0b' }] },
    { title: 'ETH 价格趋势', source: '币安 · 本地日线 · USDT', date: latest(eth), stale: false, note: '日线收盘价；价格方向是资金与杠杆指标的对照基准。', series: [{ name: 'ETH', points: eth, color: '#9b87f5' }] },
    { title: 'ETF 资金流', source: 'The Block · 美元', date: dateRange(['btcEtf', 'ethEtf']), stale: status(['btcEtf', 'ethEtf']), note: '柱：单日净流入；虚线/右轴：7自然日已披露累计。非交易日不补零，注意来源延迟。', series: [
      { name: 'BTC 单日', points: points('btcEtf'), color: '#f59e0b', bar: true }, { name: 'ETH 单日', points: points('ethEtf'), color: '#9b87f5', bar: true },
      { name: 'BTC 7日累计', points: rollingDisclosedFlows(points('btcEtf')), color: '#fbbf24', right: true, dashed: true }, { name: 'ETH 7日累计', points: rollingDisclosedFlows(points('ethEtf')), color: '#c4b5fd', right: true, dashed: true },
    ] },
    { title: '稳定币供应量', source: 'The Block / DefiLlama · 美元面值', date: latest(points('stablecoinSupply')), stale: status(['stablecoinSupply']), supply: true, note: '美元锚定稳定币供应合计；30日变化需有准确基准日。供应增长不等于买盘净流入。', series: [{ name: supplyMode.value === 'total' ? '总供应' : '30日变化率', points: supplyMode.value === 'total' ? points('stablecoinSupply') : changeOver30Days(points('stablecoinSupply')), color: '#22c5cb' }] },
    { title: '主要交易所持仓 OI', source: 'The Block · 名义美元价值', date: dateRange(['btcOi', 'ethOi']), stale: status(['btcOi', 'ethOi']), note: `最新覆盖 BTC：${coverage('btcOi')}；ETH：${coverage('ethOi')}。`, series: [{ name: 'BTC 持仓', points: points('btcOi'), color: '#f59e0b' }, { name: 'ETH 持仓', points: points('ethOi'), color: '#9b87f5' }] },
    { title: '多空清算', source: 'The Block / CoinGlass · 美元', date: dateRange(['longLiquidations', 'shortLiquidations']), stale: status(['longLiquidations', 'shortLiquidations']), note: '多头向下、空头向上，正负仅表示方向；UTC 16:00 为日界，最新日可能尚未完整。', series: [{ name: '多头清算', points: points('longLiquidations').map(p => ({ ...p, value: -p.value })), color: '#f56c6c', bar: true }, { name: '空头清算', points: points('shortLiquidations'), color: '#35c98c', bar: true }] },
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
.trends-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; color: var(--text-regular); font-size: 13px; }
.toolbar-actions { display: flex; gap: 10px; align-items: center; }
.trends-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.trend-panel { display: flex; flex-direction: column; min-width: 0; height: max(330px, calc((100dvh - 170px) / 2)); border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--bg-card); overflow: hidden; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; padding: 10px 12px 4px; color: var(--text-primary); font-size: 13px; }
small, footer { color: var(--text-secondary); font-size: 11px; }
.panel-controls { min-height: 28px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.panel-chart { flex: 1; min-height: 180px; }
footer { padding: 6px 12px; line-height: 1.5; max-height: 52px; overflow-y: auto; border-top: 1px solid var(--el-border-color-lighter); }
.chart-empty { height: 100%; display: grid; place-items: center; font-size: 12px; color: var(--text-secondary); }
.request-error { color: var(--el-color-danger); margin-bottom: 8px; font-size: 12px; }
:global(.crypto-trends-drawer .el-drawer__header) { margin-bottom: 0; padding: 14px 16px; }
:global(.crypto-trends-drawer .el-drawer__body) { padding: 10px 10px 40px; background: var(--bg-main); }
@media(max-width: 1100px) { .trends-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media(max-width: 680px) { .trends-grid { grid-template-columns: minmax(0, 1fr); } .trend-panel { height: 350px; } .toolbar-actions { flex-wrap: wrap; } }
</style>
