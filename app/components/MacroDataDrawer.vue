<!-- ==================== 宏观数据抽屉 ==================== -->
<template>
  <el-drawer v-model="visible" class="macro-drawer" title="宏观数据" direction="rtl" size="96%" destroy-on-close>
    <div class="macro-toolbar">
      <span class="overview-title">全球流动性+市场风险偏好总览</span>
      <div class="periods global-periods" aria-label="全部图表周期">
        <button v-for="period in periods" :key="period.value" type="button"
          :class="{ active: globalPeriod === period.value }"
          :aria-pressed="globalPeriod === period.value"
          @click="setGlobalPeriod(period.value)">{{ period.label }}</button>
      </div>
    </div>

    <div class="chart-grid">
      <section v-for="item in markets" :key="item.symbol" class="chart-panel">
        <header class="panel-header">
          <div class="panel-caption">
            <strong>{{ item.name }}</strong>
            <span>{{ item.description }}</span>
          </div>
          <div class="periods panel-periods" :aria-label="`${item.name}周期`">
            <button v-for="period in periods" :key="period.value" type="button"
              :class="{ active: selectedPeriods[item.symbol] === period.value }"
              :aria-pressed="selectedPeriods[item.symbol] === period.value"
              @click="selectedPeriods[item.symbol] = period.value">{{ period.label }}</button>
          </div>
        </header>
        <div class="chart-viewport">
          <iframe class="chart-frame" :title="`${item.name} K线图`" :src="chartUrl(item.symbol, selectedPeriods[item.symbol] || 'D')"
            loading="lazy" referrerpolicy="origin" />
        </div>
      </section>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

// 截图中的市场标的；价格和蜡烛图由 TradingView 实时提供。
const markets = [
  { name: '比特币', description: '投机资金风险偏好', symbol: 'BINANCE:BTCUSDT.P' },
  { name: '纳指100（QQQ）', description: '美股科技股资金流向', symbol: 'BINANCE:QQQUSDT.P' },
  { name: '黄金', description: '大钱避险资金', symbol: 'BINANCE:XAUUSDT.P' },
  { name: '美元指数', description: '涨-流动性收紧 大宗受压；跌-利好其他资产', symbol: 'PEPPERSTONE:USDX' },
  { name: '10年期美债收益率', description: '全球流动性闸门', symbol: 'PYTH:US10Y' },
  { name: '原油', description: '能源供需与通胀冲击', symbol: 'BINANCE:CLUSDT.P' },
  { name: '日经225', description: '亚洲黑盘风险情绪', symbol: 'PEPPERSTONE:JPN225' },
  { name: '恒生科技', description: '指数代理 · 中系资产风险情绪', symbol: 'FOREXCOM:HSTECH' },
  { name: '韩国 KOSPI（EWY）', description: '芯片 / 存储周期温度', symbol: 'BINANCE:EWYUSDT.P' },
] as const

const periods = [
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
] as const

type Period = typeof periods[number]['value']
const globalPeriod = ref<Period>('D')
const selectedPeriods = reactive<Record<string, Period>>(
  Object.fromEntries(markets.map(item => [item.symbol, 'D' as Period])),
)

/** 顶部周期切换同步更新九张图，单卡切换仍可独立覆盖。 */
function setGlobalPeriod(period: Period) {
  globalPeriod.value = period
  markets.forEach(item => { selectedPeriods[item.symbol] = period })
}

/** 使用 TradingView 公开嵌入图表提供市场数据，周期变化时 iframe 会重新加载。 */
function chartUrl(symbol: string, period: Period): string {
  const params = new URLSearchParams({
    symbol, interval: period, theme: 'dark', style: '1', locale: 'zh_CN',
    timezone: 'Etc/UTC', hidesidetoolbar: '1', hide_legend: '1',
    symboledit: '0', saveimage: '0', toolbarbg: '#111111',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}
</script>

<style scoped>
.macro-toolbar { min-height: 34px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 0 5px 5px; box-sizing: border-box; background: #080808; }
.overview-title { color: #f3f4f6; font-size: 14px; font-weight: 600; line-height: 22px; }
.chart-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.chart-panel { min-width: 0; height: calc((100vh - 118px) / 3); min-height: 235px; border: 1px solid #343434; border-radius: 5px; overflow: hidden; background: #111; }
.panel-header { height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 0 8px; border-bottom: 1px solid #333; box-sizing: border-box; }
.panel-caption { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.panel-caption strong { color: #fff; font-size: 13px; margin-right: 8px; }
.panel-caption span { color: #a7a9ad; }
.periods { display: flex; align-items: center; flex: none; border: 1px solid #303038; border-radius: 5px; padding: 2px; }
.periods button { appearance: none; border: 0; border-radius: 4px; background: transparent; color: #aeb5c3; height: 21px; min-width: 28px; padding: 0 5px; font-size: 11px; cursor: pointer; }
.periods button:hover { color: #fff; }
.periods button.active { background: #2962ff; color: #fff; }
/* TradingView 的跨域 iframe 不接受隐藏顶部导航的 URL 参数，从视口裁去该行。 */
.chart-viewport { height: calc(100% - 32px); overflow: hidden; }
.chart-frame { display: block; width: 100%; height: calc(100% + 40px); transform: translateY(-40px); border: 0; background: #111; }
:global(.macro-drawer .el-drawer__header) { margin-bottom: 0; padding: 12px 16px; background: #111; color: #f3f4f6; }
:global(.macro-drawer .el-drawer__body) { padding: 6px; overflow: auto; background: #080808; }
@media (max-width: 1100px) { .chart-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .chart-panel { height: 300px; } }
@media (max-width: 680px) { .chart-grid { grid-template-columns: minmax(0, 1fr); } .chart-panel { height: 300px; } .panel-caption span { display: none; } }
</style>
