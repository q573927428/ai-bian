<!-- ==================== 指标看板环境详情浮层内容 ==================== -->
<template>
  <section class="environment-details" :class="{ 'is-panel': panel }" aria-label="环境置信度与市场广度">
    <header class="detail-header">
      <div class="title-row"><span class="detail-title">{{ symbol }} <span class="secondary">/ 环境分析</span></span><span class="main-tag">主周期 {{ mainPeriod }}</span></div>
      <div class="detail-meta">
        <span>{{ scopeLabel }} · 同类样本 {{ summary?.selectedCount ?? context?.marketScope?.selectedCount ?? 0 }} 个</span>
        <span v-if="summary">{{ updatedAt }} 更新 · 北京时间{{ expired ? '（数据已过期）' : '' }}</span>
      </div>
    </header>

    <div class="score-grid">
      <div v-for="side in sides" :key="side.key" class="score-card" :class="side.key">
        <div class="score-heading"><span>{{ side.label }}</span><span class="score-note" v-if="side.assessment?.marketBreadthAdjustment">24h 市场{{ side.assessment.marketBreadthAdjustment.state }}</span></div>
        <div class="score-body">
          <div class="score-number" :class="side.key === 'long' ? 'positive' : 'negative'">{{ side.assessment?.available ? number(side.assessment.confidence) : '--' }}<small>/ 100</small></div>
          <div class="score-note" v-if="side.assessment?.marketBreadthAdjustment">广度修正 <strong>{{ number(side.assessment.marketBreadthAdjustment.adjustment) }}</strong></div>
        </div>
        <div v-if="!side.assessment?.available" class="score-note">环境数据不足</div>
        <div v-if="side.assessment?.communityAdjustment" class="score-note">社区情绪修正 {{ signed(side.assessment.communityAdjustment.adjustment) }}</div>
      </div>
    </div>

    <div class="factor-grid" aria-label="多空环境评分拆解">
      <div v-for="factor in factors" :key="factor.key" class="factor">
        <span>{{ factor.label }} <span class="secondary">{{ factor.weight }}%</span></span>
        <div class="factor-values"><span class="positive"><span class="secondary">多 </span>{{ number(context?.long[factor.key], true) }}</span><span class="negative"><span class="secondary">空 </span>{{ number(context?.short[factor.key], true) }}</span></div>
      </div>
    </div>

    <section class="detail-section">
      <div class="section-heading"><span>五周期结构</span><span :class="tone(context?.structure.tone)">{{ context?.structure.label ?? '数据不足观望' }}</span></div>
      <div class="trend-grid">
        <div v-for="item in trends" :key="item.period" class="trend-cell" :class="[{ 'is-main': item.period === mainPeriod }, `direction-${tone(item.direction)}`]">
          <div class="trend-heading"><span class="secondary">{{ item.period }}{{ item.period === mainPeriod ? ' · 主' : '' }}</span><span class="trend-direction" :class="tone(item.direction)">{{ item.direction === '方向分歧' ? '分歧' : item.direction }}</span></div>
          <div class="trend-signals" v-if="item.di && item.macd">
            <div class="trend-indicator"><span>DI</span><span><b>{{ strengthMark(item.di) }}</b>{{ item.di }}</span></div><div class="trend-indicator"><span>MACD</span><span><b>{{ strengthMark(item.macd) }}</b>{{ item.macd }}</span></div>
          </div>
          <div v-else-if="item.fallback" class="trend-signals trend-status"><span>历史趋势</span><span>{{ item.fallback }}</span></div>
          <div v-else class="trend-signals"><span>DI</span><span>MACD</span><span class="trend-shared-state">{{ item.direction === '方向分歧' ? '方向不一致' : item.direction === '中性' ? '方向中性' : '等待更新' }}</span></div>
        </div>
      </div>
    </section>

    <section class="detail-section breadth-section" v-if="summary">
      <div class="section-heading"><span>市场广度</span><span class="secondary">分析时固定快照</span></div>
      <div class="table-scroll">
        <table class="breadth-table" aria-label="五周期市场广度及当前交易对涨跌幅">
          <thead><tr><th scope="col">周期</th><th scope="col">涨</th><th scope="col">跌</th><th scope="col">平</th><th scope="col">上涨占比</th><th scope="col">中位涨跌幅</th><th scope="col">涨跌幅</th><th v-if="hasPeriodRankings" scope="col" title="按当前周期同类资产的ATR归一化表现排名">排名</th><template v-if="!uniformCounts"><th scope="col">有效</th><th scope="col">缺失</th></template></tr></thead>
          <tbody><tr v-for="stats in summary.rows" :key="stats.period" :class="{ 'is-main': stats.period === breadthPeriod }">
            <th scope="row">{{ stats.period }}<span class="secondary" v-if="stats.period === breadthPeriod"> · 主</span></th>
            <td class="positive">{{ stats.upCount }}</td><td class="negative">{{ stats.downCount }}</td><td>{{ stats.flatCount }}</td>
            <td><div class="ratio-cell"><span v-if="stats.upRatioPct != null" class="ratio-track" aria-hidden="true"><span :style="{ width: `${stats.upRatioPct}%` }"></span></span><span class="ratio-value">{{ percent(stats.upRatioPct) }}</span></div></td>
            <td :class="changeTone(stats.medianChangePct)">{{ percent(stats.medianChangePct, true) }}</td>
            <td :class="changeTone(stats.changePct)">{{ percent(stats.changePct, true) }}</td>
            <td v-if="hasPeriodRankings"><template v-if="stats.ranking && !expired">{{ stats.ranking.tiedCount > 1 ? '并列 ' : '' }}{{ stats.ranking.position }} / {{ stats.ranking.sampleCount }}</template><span v-else class="secondary">--</span></td>
            <template v-if="!uniformCounts"><td>{{ stats.validCount }}</td><td>{{ stats.missingCount }}</td></template>
          </tr></tbody>
        </table>
      </div>
      <div class="table-footer"><span v-if="uniformCounts">各周期有效 {{ summary.rows[0]?.validCount ?? 0 }} 个 · 缺失 {{ summary.rows[0]?.missingCount ?? 0 }} 个</span><span>24h 为滚动窗口</span></div>
      <div class="ranking">
        <div>相对强弱排名 <span class="secondary">{{ mainPeriod }} · ATR 归一化</span></div>
        <div v-if="summary.ranking && !expired" class="rank-number">{{ summary.ranking.tiedCount > 1 ? '并列' : '' }}第 {{ summary.ranking.position }} 名 <small>/ {{ summary.ranking.sampleCount }} 个</small></div>
        <span v-else class="secondary">暂无可用排名</span>
      </div>
    </section>
    <div v-else class="empty-breadth">{{ breadthDescription || '市场广度：暂无可用快照。' }}</div>
  </section>
</template>

<script setup lang="ts">
// ==================== 环境详情数据展示，不在前端重新评分 ====================
import { computed } from 'vue'
import { TREND_PERIODS, type EnvironmentContext, type TrendStrength } from '../utils/environment-confidence'
import { periodTrendDisplay } from '../utils/environment-display'
import { BREADTH_CATEGORY_LABELS } from '../utils/market-breadth'
import type { MarketBreadthSummary } from '../../types/market-breadth'

/** 同一指标响应中的环境与广度快照；now 复用看板时钟，用于过期提示。 */
interface Props {
  symbol: string
  timeframe: string
  now: number
  context?: EnvironmentContext
  summary?: MarketBreadthSummary
  breadthDescription?: string
  /** 右侧面板由外层统一滚动，避免复用浮层高度限制产生嵌套滚动。 */
  panel?: boolean
}
const props = defineProps<Props>()
// 切换周期时旧请求仍可能显示，详情优先使用快照自己的周期，避免错标。
const mainPeriod = computed(() => props.context?.mainTimeframe ?? props.timeframe)
const breadthPeriod = computed(() => mainPeriod.value === '1d' ? '24h' : mainPeriod.value)
const expired = computed(() => !!props.summary && props.now >= props.summary.expiresAt)
// 只有快照提供至少一个周期的有效排名才展示该列，旧响应不增加空列。
const hasPeriodRankings = computed(() => props.summary?.rows.some(row => row.ranking != null) ?? false)
const scopeLabel = computed(() => BREADTH_CATEGORY_LABELS[props.context?.marketScope?.category ?? 'unknown'])
const updatedAt = computed(() => props.summary ? new Date(props.summary.computedAt).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}) : '')
const sides = computed(() => [
  { key: 'long', label: '做多 LONG', assessment: props.context?.long },
  { key: 'short', label: '做空 SHORT', assessment: props.context?.short }
])
const factors = [
  { key: 'market', label: '市场支持', weight: 30 },
  { key: 'structure', label: '五周期支持', weight: 40 },
  { key: 'relativeStrength', label: '相对强弱', weight: 30 }
] as const
const trends = computed(() => TREND_PERIODS.map(period => ({ period, ...periodTrendDisplay(props.context?.periods[period]) })))
// 计数一致时合并到表尾；有任何窗口缺失差异时保留逐行计数，不能掩盖缺数。
const uniformCounts = computed(() => !!props.summary?.rows.length && props.summary.rows.every(row =>
  row.validCount === props.summary!.rows[0]!.validCount && row.missingCount === props.summary!.rows[0]!.missingCount))

/** 分项按要求四舍五入为整数，其余数值保留两位小数；只改展示，缺失不补零。 */
function number(value?: number | null, integer = false): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(integer ? Math.round(value) : Number(value.toFixed(2))) : '--'
}
function signed(value: number): string { return `${value > 0 ? '+' : ''}${number(value)}` }
function percent(value: number | null, withSign = false): string {
  return value == null || !Number.isFinite(value) ? '暂无数据' : `${withSign && value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}
function strengthMark(value: TrendStrength): string { return value === '增强' ? '▲' : value === '减弱' ? '▼' : '＝' }
function tone(value?: string): string { return value === '多头' ? 'positive' : value === '空头' ? 'negative' : 'secondary' }
function changeTone(value: number | null): string { return value == null || value === 0 ? 'secondary' : value > 0 ? 'positive' : 'negative' }
</script>

<style scoped>
/* 使用视口可用高度，避免70vh让正常桌面窗口提前滚动；极小窗口保留内容可达性。 */
.environment-details { container: environment-detail / inline-size; max-height: calc(100dvh - 48px); overflow-y: auto; color: var(--text-primary); font-size: 14px; line-height: 1.6; }
.environment-details.is-panel { max-height: none; overflow: visible; }
.secondary { color: var(--text-secondary); }
.positive { color: var(--el-color-success); }.negative { color: var(--el-color-danger); }
.detail-header { padding: 2px 2px 8px; border-bottom: 1px solid var(--border-color); }
.title-row, .detail-meta, .score-heading, .section-heading, .table-footer, .ranking { display: flex; align-items: center; justify-content: space-between; gap: 6px 12px; flex-wrap: wrap; }
.detail-title { font-size: 18px; font-weight: 500; }.detail-title .secondary { font-size: 14px; }
.main-tag { padding: 2px 8px; border-radius: 5px; background: var(--bg-hover); color: var(--text-secondary); font-size: 12px; }
.detail-meta { justify-content: flex-start; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
.score-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.score-card { padding: 8px 10px; background: var(--bg-hover); border-radius: 8px; border-top: 3px solid var(--el-color-success); }
.score-card.short { border-top-color: var(--el-color-danger); }
.score-heading, .score-note { font-size: 12px; color: var(--text-secondary); }
.score-number { margin: 3px 0; font-size: 34px; font-weight: 500; line-height: 1.3; font-variant-numeric: tabular-nums; }
.score-number small { margin-left: 6px; font-size: 13px; font-weight: 400; color: var(--text-secondary); }
.score-heading { align-items: baseline; gap: 3px 8px; }.score-heading .score-note { margin-left: auto; text-align: right; }
.score-body { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.score-body strong { color: var(--text-primary); font-weight: 500; }
.factor-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-color); }
.factor { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; padding: 3px 8px; text-align: center; }
.factor + .factor { border-left: 1px solid var(--border-color); }
.factor-values { display: flex; justify-content: center; gap: 10px; font-variant-numeric: tabular-nums; }
.detail-section { margin-top: 10px; }.section-heading { margin-bottom: 6px; font-weight: 500; }.section-heading .secondary { font-size: 12px; font-weight: 400; }
.trend-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.trend-cell { padding: 0 6px 6px; border-radius: 6px; overflow: hidden; background: var(--bg-hover); font-size: 12px; }
/* 顶部细色条只表达总方向；所有周期保留相同边框高度，主周期仍由蓝色底色标记。 */
.trend-cell { border-top: 2px solid var(--text-secondary); }
.trend-cell.direction-positive { border-top-color: var(--el-color-success); }
.trend-cell.direction-negative { border-top-color: var(--el-color-danger); }
/* 顶部用轻微底色差异建立层级，红绿仅表达方向，不将指标减弱误读为空头。 */
.trend-heading { display: flex; justify-content: space-between; align-items: center; gap: 4px; margin: 0 -6px; padding: 5px 6px; background: color-mix(in srgb, var(--bg-hover) 86%, var(--text-primary)); border-bottom: 1px solid var(--border-color); }
/* 从当前主题底色混合蓝色，避免自定义暗色主题中 light-8 仍呈现接近白色。 */
.trend-cell.is-main { background: color-mix(in srgb, var(--el-color-primary) 15%, var(--bg-hover)); }
.trend-cell.is-main .trend-heading { background: color-mix(in srgb, var(--el-color-primary) 25%, color-mix(in srgb, var(--bg-hover) 86%, var(--text-primary))); }
/* DI与MACD各占一列，分歧状态跨列，保持不同状态的名称和说明基线一致。 */
.trend-direction { text-align: right; }.trend-signals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, 16px); justify-items: center; align-items: center; padding-top: 5px; color: var(--text-secondary); font-size: 11px; line-height: 16px; }
.trend-indicator { display: grid; grid-template-rows: repeat(2, 16px); justify-items: center; grid-row: 1 / -1; }
.trend-shared-state { grid-column: 1 / -1; }.trend-status { grid-template-columns: 1fr; }
.trend-signals span { white-space: nowrap; }.trend-signals b { color: var(--text-primary); font-size: 12px; font-weight: 500; margin-right: 1px; }
.is-main { background: color-mix(in srgb, var(--color-primary) 15%, var(--bg-card)); }
.table-scroll { overflow-x: auto; }.breadth-table { width: 100%; border-collapse: collapse; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.breadth-table th, .breadth-table td { padding: 6px; border-bottom: 1px solid var(--border-color); text-align: right; font-weight: 400; }
.breadth-table th:first-child { text-align: left; }.breadth-table thead { background: var(--bg-hover); color: var(--text-secondary); }
.breadth-table tr.is-main { font-weight: 500; }
/* 固定数值列可容纳100.00%，个位数占比不再挤动进度条；缺失时也保持列位。 */
.ratio-cell { display: grid; grid-template-columns: 42px 7ch; align-items: center; justify-content: end; gap: 8px; }.ratio-value { grid-column: 2; text-align: right; font-variant-numeric: tabular-nums; }.ratio-track { grid-column: 1; grid-row: 1; width: 42px; height: 4px; border-radius: 3px; background: color-mix(in srgb, var(--bg-card) 85%, var(--text-primary)); overflow: hidden; }.ratio-track > span { display: block; height: 100%; background: var(--el-color-success); }
.table-footer { margin-top: 7px; font-size: 12px; color: var(--text-secondary); }
.ranking { margin-top: 8px; padding: 7px 10px; background: var(--bg-hover); border-radius: 8px; }.ranking .secondary { font-size: 12px; }
.rank-number { font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; }.rank-number small { font-size: 12px; font-weight: 400; color: var(--text-secondary); }
.empty-breadth { margin-top: 16px; white-space: pre-wrap; }
/* 面板模式把剩余空间分配给实际内容，广度表格获得更多高度，排名始终落在底部。 */
.is-panel { flex: 1 0 auto; display: flex; flex-direction: column; gap: 10px; }
.is-panel > .detail-header { flex: 0 0 auto; }
.is-panel > .score-grid { flex: 0.6 0 auto; margin-top: 0; }
.is-panel .score-card { display: flex; flex-direction: column; }
.is-panel .score-body { flex: 1; }
.is-panel > .factor-grid { flex: 0.4 0 auto; margin-top: 0; }
.is-panel > .detail-section { flex: 0.6 0 auto; display: flex; flex-direction: column; margin-top: 0; }
.is-panel .section-heading { flex: 0 0 auto; }
.is-panel .trend-grid { flex: 1; }
.is-panel .trend-cell { display: flex; flex-direction: column; }
.is-panel .trend-signals { flex: 1; grid-template-rows: repeat(2, minmax(16px, 1fr)); }
.is-panel .trend-indicator { align-self: stretch; grid-template-rows: repeat(2, minmax(16px, 1fr)); align-items: center; }
.is-panel > .breadth-section { flex-grow: 2; }
.is-panel .table-scroll { flex: 1; display: flex; }
.is-panel .breadth-table { flex: 1; height: 100%; }
.is-panel .breadth-table thead { height: 32px; }
.is-panel .table-footer, .is-panel .ranking { flex: 0 0 auto; }
@container environment-detail (max-width: 480px) {
  .score-card { padding: 10px; }.score-heading { align-items: flex-start; flex-direction: column; gap: 0; }.score-heading .score-note { margin-left: 0; text-align: left; }
  .factor { flex-direction: column; align-items: center; padding: 3px 4px; }.trend-grid { gap: 3px; }.trend-cell { padding: 0 4px 6px; font-size: 11px; }.trend-heading { margin: 0 -4px; padding: 5px 4px; gap: 3px; }
}
@container environment-detail (max-width: 380px) {
  .trend-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .factor { font-size: 12px; }
  .ratio-track { width: 28px; }.ratio-cell { grid-template-columns: 28px 7ch; gap: 5px; }
}
</style>
