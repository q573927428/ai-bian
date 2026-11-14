<!-- ==================== 加密市场十二图趋势看板 ==================== -->
<template>
  <component :is="embedded ? 'section' : ElDrawer" v-model="visible" title="加密市场趋势" size="90%" destroy-on-close :class="embedded ? 'trends-content' : 'crypto-trends-drawer'">
    <div class="trends-toolbar">
      <span>价格 · 相对强弱 · 机构资金 · 流动性 · 杠杆风险 · 成交活跃度 · 波动率 · 情绪 · 市场广度 · 期权风险偏好 · 北京时间</span>
      <div class="toolbar-actions">
        <el-radio-group v-model="layout" size="small" aria-label="图表布局">
          <el-radio-button value="compact">紧凑</el-radio-button>
          <el-radio-button value="comfortable">舒适</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="days" size="small"><el-radio-button v-for="value in [7, 30, 90, 365]" :key="value" :value="value">{{ value === 365 ? '近1年' : `近${value}天` }}</el-radio-button></el-radio-group>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>
    <div v-if="error" class="request-error">{{ error }}</div>
    <div v-if="visible" class="trends-grid" :class="{ 'trends-grid--comfortable': layout === 'comfortable' }">
      <template v-for="panel in panels" :key="panel.title">
      <RelativeRatioChart v-if="panel.ratio" class="trend-panel" :refresh-version="refreshVersion" :days="days" />
      <section v-else class="trend-panel">
        <header>
          <strong :title="formatHeaderHint(`${panel.source}\n${panel.note}`)">{{ panel.title }}</strong>
          <div v-if="panel.performance" class="performance-stats" :title="formatHeaderHint(panel.performance.note)">
            <span class="window-label">{{ rangeLabel }}</span>
            <span class="btc-performance">BTC <strong>{{ panel.performance.btc }}</strong></span>
            <span class="eth-performance">ETH <strong>{{ panel.performance.eth }}</strong></span>
            <span>差 <strong>{{ panel.performance.difference }}</strong></span>
          </div>
          <div v-if="panel.stats" class="window-stats" :title="formatHeaderHint(panel.statsNote)">
            <span class="window-label">{{ rangeLabel }}</span>
            <span v-for="entry in panel.stats" :key="entry.label"><span>{{ entry.label }}</span> <strong>{{ entry.value }}</strong></span>
          </div>
          <small class="panel-date" :title="panel.date">{{ panel.date ? `${panel.disclosed ? '披露至' : '数据至'} ${panel.date}` : '暂无数据' }}<span v-if="panel.intraday"> · 盘中</span><span v-if="panel.stale"> · 待同步</span></small>
        </header>
        <div class="panel-chart">
          <CryptoTrendChart v-if="panel.series.some(s => s.points.length)" :series="panel.series" :days="days" :format="panel.format" :right-format="panel.rightFormat" :min="panel.min" :max="panel.max" :right-min="panel.rightMin" :right-max="panel.rightMax" :reference-lines="panel.referenceLines" :reference-series="panel.referenceSeries" />
          <div v-else class="chart-empty">{{ loading ? '读取缓存中…' : panel.emptyText ?? '暂无历史数据，等待服务端同步' }}</div>
        </div>
      </section>
      </template>
    </div>
  </component>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import type { CryptoTrendsResponse, CryptoTrendKey, TrendPoint } from '../../types/crypto-trends'
import { rollingDisclosedFlows, changeOver30Days, relativePriceChanges, trendDisplayPoints } from '../utils/crypto-trend-calculations'
import { summarizeTrendWindow, formatTrendAmount, formatTrendNumber } from '../utils/trend-window-summary'
import CryptoTrendChart from './CryptoTrendChart.vue'
import RelativeRatioChart from './RelativeRatioChart.vue'
import { useGlobalPolling } from '../composables/useGlobalPolling'

// 页面模式沿用抽屉的数据请求与卸载清理，避免维护两套业务逻辑。
const props = withDefaults(defineProps<{ modelValue: boolean; embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const data = ref<CryptoTrendsResponse | null>(null)
const loading = ref(false)
const error = ref('')
const days = ref(90)
// 只改变图表容器尺寸，保留已加载数据与当前周期；图表自身通过 ResizeObserver 适配。
const layout = ref<'compact' | 'comfortable'>('compact')
const refreshVersion = ref(0)
let controller: AbortController | undefined
let requestVersion = 0
const points = (key: CryptoTrendKey) => data.value?.metrics[key]?.points ?? []
const latest = (rows: TrendPoint[]) => trendDisplayPoints(rows).at(-1)?.date
const status = (keys: CryptoTrendKey[]) => keys.some(key => data.value?.metrics[key]?.stale ?? true)
const coverage = (key: CryptoTrendKey) => data.value?.metrics[key]?.coverage.join('、') || '等待同步'
const rangeLabel = computed(() => days.value === 365 ? '近1年' : `近${days.value}天`)
/** 头部原生悬停提示按说明分句换行，避免统计口径与两组覆盖日期挤在一行。 */
const formatHeaderHint = (text = '') => text.replace(/([；。])(?=[^\n])/g, '$1\n')
const panels = computed(() => {
  const btc = data.value?.prices.btc ?? [], eth = data.value?.prices.eth ?? [], btcdom = data.value?.prices.btcdom ?? []
  const [btcChange, ethChange] = relativePriceChanges(btc, eth, days.value)
  // 同一基准日和最新共同日期比较，不能把一方旧行情与另一方新行情相减。
  const ethChanges = new Map(ethChange.map(point => [point.date, point.value]))
  const common = [...btcChange].reverse().find(point => ethChanges.has(point.date))
  const btcPerformance = common?.value ?? null
  const ethPerformance = common ? ethChanges.get(common.date)! : null
  const formatPerformance = (value: number | null) => {
    if (value === null) return '--'
    const rounded = Number(value.toFixed(1))
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`
  }
  const performance = {
    btc: formatPerformance(btcPerformance), eth: formatPerformance(ethPerformance),
    difference: formatPerformance(btcPerformance !== null && ethPerformance !== null ? btcPerformance - ethPerformance : null),
    note: `所选区间涨跌幅；最新共同日期：${common ? latest([common]) : '--'}。差 = BTC涨跌幅 − ETH涨跌幅，数值表示百分点差。`,
  }
  const dateRange = (keys: CryptoTrendKey[]) => keys.map(key => latest(points(key)) ?? '--').join(' / ')
  // 切换范围后旧窗口数据不再展示，避免标题已更新而曲线仍是旧算法结果。
  const volatility = data.value?.volatilityDays === days.value ? data.value.volatility : { btc: [], eth: [] }
  const breadth = data.value?.breadth?.days === days.value ? data.value.breadth : null
  // 顶部控制历史显示范围；到期期限统一为30天，避免将回看天数与期权期限混淆。
  const skewKeys: CryptoTrendKey[] = ['btcSkew30', 'ethSkew30']
  const summarize = (rows: TrendPoint[]) => summarizeTrendWindow(rows, days.value)
  const metric = (key: CryptoTrendKey) => summarize(points(key))
  const coverageNote = (rows: TrendPoint[]) => {
    const summary = summarize(rows)
    return summary.count ? `${summary.first!.date}～${summary.last!.date}，${summary.count}个观测日` : '所选区间无数据'
  }
  // 累计只使用原始观测，不能把凌晨追加的盘中展示点或最近披露值重复累加。
  const totals = (left: TrendPoint[], right: TrendPoint[], labels = ['BTC', 'ETH']) => labels.map((label, index) => ({ label, value: formatTrendAmount(summarize(index ? right : left).total) }))
  const changes = (left: TrendPoint[], right: TrendPoint[]) => ['BTC', 'ETH'].map((label, index) => ({ label, value: formatTrendNumber(summarize(index ? right : left).change, '%', true) }))
  const averages = (left: TrendPoint[], right: TrendPoint[], labels = ['BTC', 'ETH'], unit = '%') => labels.map((label, index) => ({ label, value: formatTrendNumber(summarize(index ? right : left).average, unit) }))
  const pairNote = (left: TrendPoint[], right: TrendPoint[], operation: string) => `${rangeLabel.value}${operation}；左项：${coverageNote(left)}；右项：${coverageNote(right)}。缺失日不补零，盘中点使用已有累计值。`
  const volume = data.value?.volumes ?? { btc: [], eth: [] }
  const windowStats: Record<string, { stats: { label: string; value: string }[]; statsNote: string }> = {
    'ETF 资金流': {
      stats: totals(points('btcEtf'), points('ethEtf'), ['BTC累计', 'ETH累计']),
      statsNote: pairNote(points('btcEtf'), points('ethEtf'), '已披露净流入累计；图中虚线仍为7自然日累计'),
    },
    '稳定币供应量': {
      stats: [{ label: '总量', value: formatTrendAmount(metric('stablecoinSupply').last?.value ?? null) }, { label: '变化', value: formatTrendNumber(metric('stablecoinSupply').change, '%', true) }],
      statsNote: `${rangeLabel.value}末值及首尾变化；${coverageNote(points('stablecoinSupply'))}。黄色曲线仍为固定30日变化率。`,
    },
    '主要交易所持仓 OI': {
      stats: changes(points('btcOi'), points('ethOi')),
      statsNote: pairNote(points('btcOi'), points('ethOi'), '首尾名义持仓变化率'),
    },
    '实现波动率': {
      stats: averages(volatility.btc, volatility.eth, ['BTC均', 'ETH均']),
      statsNote: pairNote(volatility.btc, volatility.eth, '年化波动率观测均值'),
    },
    '多空清算': {
      stats: totals(points('longLiquidations'), points('shortLiquidations'), ['多累计', '空累计']),
      statsNote: pairNote(points('longLiquidations'), points('shortLiquidations'), '清算金额累计；空头金额按正值统计'),
    },
    'BTC / ETH 成交额': {
      stats: totals(volume.btc, volume.eth, ['BTC累计', 'ETH累计']),
      statsNote: pairNote(volume.btc, volume.eth, '成交额累计，含当前盘中柱已有成交额'),
    },
    '恐慌贪婪指数': {
      stats: [{ label: '最新', value: formatTrendNumber(metric('fearGreed').last?.value ?? null, '') }, { label: '均值', value: formatTrendNumber(metric('fearGreed').average, '') }],
      statsNote: `${rangeLabel.value}已披露最新值及观测均值；${coverageNote(points('fearGreed'))}。延用展示点不重复计入。`,
    },
    [`市场上涨广度 · ${breadth?.sampleCount ?? 0}币`]: {
      stats: averages(breadth?.ma20 ?? [], breadth?.ma60 ?? [], ['MA20均', 'MA60均']),
      statsNote: pairNote(breadth?.ma20 ?? [], breadth?.ma60 ?? [], '站上均线的币种占比均值'),
    },
    '期权风险偏好': {
      stats: averages(points('btcSkew30'), points('ethSkew30'), ['BTC均', 'ETH均'], ' pp'),
      statsNote: pairNote(points('btcSkew30'), points('ethSkew30'), '偏斜均值，单位为百分点；期权到期仍固定30天'),
    },
  }
  return [
    { title: 'BTC / ETH 走势', source: '币安 · 本地日线 · 区间涨跌幅', date: `${latest(btc) ?? '--'} / ${latest(eth) ?? '--'}`, stale: false, performance, format: 'percent' as const, note: '以所选区间首个共同有效日为0%；缺失日不补值。标题显示最新共同日期的涨跌幅及BTC减ETH的百分点差，盘中值随行情更新。', series: [{ name: 'BTC', points: btcChange, color: '#f59e0b' }, { name: 'ETH', points: ethChange, color: '#9b87f5' }] },
    { title: 'BTC 主导指数', stats: [{ label: '最新', value: formatTrendNumber(summarize(btcdom).last?.value ?? null, '') }, { label: '变化', value: formatTrendNumber(summarize(btcdom).change, '%', true) }], statsNote: `${rangeLabel.value}首尾有效点变化；${coverageNote(btcdom)}`, source: '币安 · BTCDOM/USDT · 本地日线 · 指数点位', date: latest(btcdom), stale: false, format: 'index' as const, note: '上涨表示BTC相对指数篮子山寨币走强，下跌表示走弱；非全市场市占率%。', series: [{ name: 'BTCDOM', points: btcdom, color: '#38bdf8' }] },
    { title: 'ETF 资金流', disclosed: true, source: 'The Block · 美元', date: dateRange(['btcEtf', 'ethEtf']), stale: status(['btcEtf', 'ethEtf']), note: '柱：单日净流入；虚线/右轴：7自然日已披露累计。非交易日不补零，注意来源延迟。', series: [
      { name: 'BTC 单日', points: points('btcEtf'), color: '#f59e0b', bar: true }, { name: 'ETH 单日', points: points('ethEtf'), color: '#9b87f5', bar: true },
      { name: 'BTC 7日累计', points: rollingDisclosedFlows(points('btcEtf')), color: '#06b6d4', right: true, dashed: true }, { name: 'ETH 7日累计', points: rollingDisclosedFlows(points('ethEtf')), color: '#ec4899', right: true, dashed: true },
    ] },
    { title: '稳定币供应量', disclosed: true, source: 'The Block / DefiLlama · 左轴美元面值 · 右轴变化率', date: latest(points('stablecoinSupply')), stale: status(['stablecoinSupply']), format: 'money' as const, rightFormat: 'percent' as const, referenceLines: [0], referenceSeries: 1,
      note: '青色实线/左轴：美元锚定稳定币总供应；黄色虚线/右轴：30日变化率，零线区分扩张与收缩。30日变化需有准确基准日，缺失时留空。供应增长不等于买盘净流入。', series: [
        { name: '总供应（左轴）', points: points('stablecoinSupply'), color: '#22c5cb' },
        { name: '30日变化率（右轴）', points: changeOver30Days(points('stablecoinSupply')), color: '#facc15', right: true, dashed: true },
      ] },
    { title: '主要交易所持仓 OI', disclosed: true, source: 'The Block · 名义美元价值', date: dateRange(['btcOi', 'ethOi']), stale: status(['btcOi', 'ethOi']), note: `最新覆盖 BTC：${coverage('btcOi')}；ETH：${coverage('ethOi')}。`, series: [{ name: 'BTC 持仓', points: points('btcOi'), color: '#f59e0b' }, { name: 'ETH 持仓', points: points('ethOi'), color: '#9b87f5' }] },
    { title: '实现波动率', source: '币安 · 本地合约日线 · 年化 %', date: `${latest(volatility.btc) ?? '--'} / ${latest(volatility.eth) ?? '--'}`, stale: false, format: 'percent' as const,
      note: `${days.value}个连续日收益样本标准差 × √365，需${days.value + 1}根日线；不足时留空。当天按最新价估算。与首页相同的币安日线，北京时间08:00分界；波动率不代表涨跌方向。`, series: [
        { name: 'BTC 波动率', points: volatility.btc, color: '#f59e0b' },
        { name: 'ETH 波动率', points: volatility.eth, color: '#9b87f5' },
      ] },
    { title: '多空清算', disclosed: true, source: 'The Block / CoinGlass · 右轴美元；BTC：币安 · 左轴USDT', date: dateRange(['longLiquidations', 'shortLiquidations']), stale: status(['longLiquidations', 'shortLiquidations']), note: '多头向上（绿色）、空头向下（红色），正负仅表示方向；清算金额对应右轴，BTC价格线对应左轴。清算来源日界为北京时间00:00，按北京时间显示来源时间戳日期。', series: [{ name: '多头清算', points: points('longLiquidations'), color: '#35c98c', bar: true, stack: 'liquidations', right: true }, { name: '空头清算', points: points('shortLiquidations').map(p => ({ ...p, value: -p.value })), color: '#f56c6c', bar: true, stack: 'liquidations', right: true }, { name: 'BTC 价格（左轴）', points: btc, color: '#f59e0b' }] },
    { title: 'BTC / ETH 成交额', source: '币安 · 本地合约日线 · USDT', date: `${latest(data.value?.volumes?.btc ?? []) ?? '--'} / ${latest(data.value?.volumes?.eth ?? []) ?? '--'}`, stale: false,
      note: '与首页相同的币安日线成交额，北京时间08:00分界；当前柱显示盘中累计，随本地行情同步更新；历史缺失留空，不等于净资金流入。', series: [
        { name: 'BTC 成交额', points: data.value?.volumes?.btc ?? [], color: '#f59e0b', bar: true },
        { name: 'ETH 成交额', points: data.value?.volumes?.eth ?? [], color: '#9b87f5', bar: true },
      ] },
    { title: '恐慌贪婪指数', disclosed: true, source: 'Alternative.me · 右轴0–100分；BTC：币安 · 左轴USDT', date: latest(points('fearGreed')), stale: status(['fearGreed']), format: 'money' as const, rightFormat: 'score' as const, rightMin: 0, rightMax: 100, referenceLines: [25, 75],
      note: '右轴情绪分数：0–24极度恐慌（红）、25–44恐慌（橙）、45–55中性（黄）、56–74贪婪（黄绿）、75–100极度贪婪（绿）；上下色带突出极端情绪。当天尚未披露时展示最近一期并注明披露日期。暗灰BTC价格对应左轴，仅供对照。', series: [
        { name: '恐慌贪婪（右轴）', points: points('fearGreed'), color: '#22c5cb', right: true, sentiment: true, latestDisclosure: true },
        { name: 'BTC 价格（左轴）', points: points('fearGreed').length ? btc : [], color: '#626a78' },
      ] },
    { title: `市场上涨广度 · ${breadth?.sampleCount ?? 0}币`, source: '币安 · 本地加密永续合约日线 · 固定样本', date: latest(breadth?.ma60 ?? []), stale: false, intraday: breadth?.ma60.at(-1)?.provisional ?? false, format: 'percent' as const, min: 0, max: 100, referenceLines: [50],
      note: `站上MA20/MA60的币种占比；历史区间及60日预热必须连续完整，区间内固定分母；当前柱按本地最新日线价格估算并标记盘中，所有样本行情齐全后展示。与首页相同的币安日线，北京时间08:00分界；回看范围按北京时间今天计算。仅覆盖本地币种，非全市场。样本：${breadth?.symbols.join('、') || '暂无'}。`, emptyText: '暂无完整日线样本，需已有合约元数据及区间前60日日线', series: [
        { name: '站上 MA20', points: breadth?.ma20 ?? [], color: '#22c5cb' },
        { name: '站上 MA60', points: breadth?.ma60 ?? [], color: '#facc15' },
      ] },
    { title: '币种相对强弱', ratio: true, source: '', note: '', date: '', stale: false, series: [] },
    { title: '期权风险偏好', disclosed: true, source: 'The Block · 30天到期 · 25Δ Skew · 隐含波动率差（百分点）', date: dateRange(skewKeys), stale: status(skewKeys), format: 'points' as const, referenceLines: [0],
      note: '统一展示30天到期25Δ期权偏斜，历史范围跟随顶部选择。零轴作参考；来源JSON未注明Call/Put相减顺序，暂不标注看多/看空。', series: [
        { name: 'BTC 25Δ Skew', points: points(skewKeys[0]!), color: '#f59e0b' },
        { name: 'ETH 25Δ Skew', points: points(skewKeys[1]!), color: '#9b87f5' },
      ] },
  ].map(panel => ({ ...panel, ...windowStats[panel.title] }))
})

/** 只刷新本站缓存；关闭抽屉即停止轮询并取消未完成请求。 */
async function load() {
  const request = ++requestVersion
  // 快速切换全局范围时取消上一请求，只接受最后一次选择的响应。
  controller?.abort()
  // 比值图使用独立周期，但刷新按钮和全局节拍仍统一触发刷新。
  refreshVersion.value++
  loading.value = true
  controller = new AbortController()
  try {
    const result = await $fetch<CryptoTrendsResponse>('/api/market/trends', { query: { days: days.value }, signal: controller.signal, timeout: 15000, retry: 0 })
    if (request !== requestVersion || !visible.value) return
    data.value = result
    error.value = ''
  }
  catch { if (request === requestVersion && visible.value) error.value = '历史数据读取失败，请重试；已有图表仍保留。' }
  finally { if (request === requestVersion) loading.value = false }
}
useGlobalPolling(load, () => visible.value)
watch(days, () => { if (visible.value) void load() })
watch(visible, value => {
  if (value) void load()
  else controller?.abort()
}, { immediate: true })
onUnmounted(() => { controller?.abort() })
</script>
<style scoped>
.trends-content { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; padding: 8px; overflow: hidden; background: var(--bg-main); }
.trends-toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; padding-bottom: 6px; background: var(--bg-main); color: var(--text-regular); font-size: 12px; }
.toolbar-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
/* 四列三行均分可用空间；低矮窗口允许滚动，保留图表的可读高度。 */
.trends-grid { display: grid; flex: 1; min-height: 552px; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(180px, 1fr)); gap: 6px; }
/* 舒适模式让每行保持可读高度，由外层滚动；紧凑模式沿用三行均分。 */
.trends-grid--comfortable { flex: none; min-height: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: clamp(380px, 42vh, 460px); }
.trend-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--bg-card); overflow: hidden; }
header { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; padding: 5px 8px 2px; color: var(--text-primary); font-size: 12px; }
header strong { flex-shrink: 0; cursor: help; }
header .el-radio-group { flex-shrink: 0; }
.panel-date { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
small { color: var(--text-secondary); font-size: 10px; }
.window-stats, .performance-stats { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--text-secondary); font-size: 10px; }
.window-stats strong, .performance-stats strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.window-stats { align-items: baseline; line-height: 14px; }
.window-stats > span, .performance-stats > span { white-space: nowrap; }
.window-stats > span { display: inline-flex; align-items: baseline; gap: 3px; }
.window-stats strong { font-size: inherit; line-height: inherit; }
.window-label { color: var(--text-secondary); font-size: 10px; font-weight: normal; }
/* 中文“差”与英文币名使用相同基线和行高，避免字体度量差异让数值看起来错位。 */
.performance-stats { align-items: baseline; line-height: 14px; }
.performance-stats > span { display: inline-flex; align-items: baseline; gap: 3px; }
.performance-stats strong { font-size: inherit; line-height: inherit; }
.performance-stats .btc-performance, .performance-stats .btc-performance strong { color: #f59e0b; }
.performance-stats .eth-performance, .performance-stats .eth-performance strong { color: #9b87f5; }
.panel-chart { flex: 1; min-height: 0; }
.chart-empty { height: 100%; display: grid; place-items: center; font-size: 12px; color: var(--text-secondary); }
.request-error { color: var(--el-color-danger); margin-bottom: 8px; font-size: 12px; }
:global(.crypto-trends-drawer .el-drawer__header) { margin-bottom: 0; padding: 14px 16px; }
:global(.crypto-trends-drawer .el-drawer__body) { display: flex; flex-direction: column; min-height: 0; padding: 8px; background: var(--bg-main); overflow: hidden; }
.trends-content, :global(.crypto-trends-drawer .el-drawer__body) { overflow-y: auto; }
@media(max-width: 1100px) {
  .trends-content, :global(.crypto-trends-drawer .el-drawer__body) { overflow-y: auto; }
  .trends-grid { flex: none; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: 280px; }
  .trends-grid--comfortable { grid-auto-rows: clamp(380px, 42vh, 460px); }
}
@media(max-width: 680px) { .trends-grid { grid-template-columns: minmax(0, 1fr); } .toolbar-actions { flex-wrap: wrap; } }
</style>
