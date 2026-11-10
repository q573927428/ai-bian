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
      <div
        class="candle-progress"
        role="progressbar"
        aria-label="当前 K 线时间进度"
        :aria-valuenow="Number(currentCandleProgress)"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuetext="`${timeframe} K线进度 ${currentCandleProgress}%`"
        :title="`当前 ${timeframe} K 线时间进度：${currentCandleProgress}%`"
      >
        <span class="candle-progress-label">K线进度</span>
        <span class="candle-progress-track" aria-hidden="true"><span :style="{ width: `${currentCandleProgress}%` }"></span></span>
        <span class="candle-progress-value">{{ currentCandleProgress }}%</span>
      </div>
      <div class="market-counts" :title="`按全部已配置交易对的 ${breadthPeriod} 实时涨跌幅统计`">
        <span>总 {{ breadthSymbols.length }}</span>
        <span class="up">涨 {{ marketBreadth.upCount }}</span>
        <span class="down">跌 {{ marketBreadth.downCount }}</span>
        <span>涨比 {{ marketBreadth.upRatioPct === null ? '—' : `${marketBreadth.upRatioPct.toFixed(0)}%` }}</span>
        <span :class="directionClass(marketBreadth.medianChangePct ?? undefined)">
          中位 {{ marketBreadth.medianChangePct === null ? '—' : `${signed(marketBreadth.medianChangePct, 2)}%` }}
        </span>
        <span v-if="marketBreadth.missingCount" class="muted">待更 {{ marketBreadth.missingCount }}</span>
      </div>
      <el-select
        v-model="selectedSymbols"
        class="symbol-select"
        size="small"
        multiple
        filterable
        clearable
        collapse-tags
        collapse-tags-tooltip
        :tag-tooltip="{ popperClass: 'indicator-symbol-tags' }"
        :reserve-keyword="false"
        placeholder="全部交易对"
        aria-label="选择观察交易对（可搜索、多选）"
        title="可搜索并选择多个交易对，清空后显示全部"
      >
        <el-option v-for="symbol in symbolOptions" :key="symbol" :label="symbol.replace(/USDT$/, '')" :value="symbol" />
      </el-select>
      <el-button class="refresh-button" size="small" :loading="loading" @click="requestRefresh">
        <el-icon><ElIconRefresh /></el-icon>刷新
      </el-button>
      <el-button v-if="showNumericFilters" size="small" text @click="resetNumericFilters">重置</el-button>
      <el-button size="small" :type="activeFilters ? 'primary' : 'default'" :plain="!!activeFilters" :aria-expanded="showNumericFilters" @click="showNumericFilters = !showNumericFilters">
        筛选{{ activeFilters ? ` (${activeFilters})` : '' }} {{ showNumericFilters ? '▴' : '▾' }}
      </el-button>
    </div>

    <div v-show="showNumericFilters" class="numeric-filters" role="region" aria-label="指标筛选">
      <div class="numeric-filter-header">
        <span class="muted">指标筛选</span>
        <span class="numeric-filter-actions">
          <span class="muted" aria-live="polite">{{ filteredRows.length }} / {{ rows.length }} 个交易对</span>
        </span>
      </div>
      <div class="numeric-filter-grid">
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">置信度排序</span>
          <el-select :model-value="confidenceSort" size="small" placeholder="当前按列排序" aria-label="交易对置信度排序" @change="handleConfidenceSortChange">
            <el-option label="默认排序" value="default" />
            <el-option label="多头置信度 ↓" value="longConfidence" />
            <el-option label="空头置信度 ↓" value="shortConfidence" />
          </el-select>
        </div>
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">五周期方向</span>
          <el-select v-model="signalFilter" size="small" aria-label="五周期方向筛选">
            <el-option label="全部" value="全部" />
            <el-option label="多头" value="多头" title="多头背景" />
            <el-option label="空头" value="空头" title="空头背景" />
            <el-option label="反转" value="反转" title="反转观察" />
            <el-option label="观望" value="观望" title="分歧观望" />
          </el-select>
        </div>
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">CVD 背离</span>
          <el-select v-model="divergenceFilter" size="small" aria-label="最新 CVD 背离筛选" title="价格与 CVD 背离，左右各 3 根收盘确认；按确认时间筛选，最新确认优先">
            <el-option label="不限" value="all" />
            <el-option label="最新背离" value="recent" />
            <el-option label="最新顶背离" value="bearish" />
            <el-option label="最新底背离" value="bullish" />
          </el-select>
        </div>
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">背离确认范围</span>
          <el-select v-model="divergenceWindow" :disabled="divergenceFilter === 'all'" size="small" aria-label="背离确认时间范围">
            <el-option v-for="count in [1, 3, 5, 10]" :key="count" :label="`近 ${count} 根确认`" :value="count" />
          </el-select>
        </div>
        <div class="numeric-filter-item" role="group" aria-label="支撑阻力试算参数">
          <span class="numeric-filter-label">支撑阻力</span>
          <div class="structure-controls">
            <label>
              <el-select v-model="structurePreview.pivotLeft" size="small" aria-label="支撑阻力左侧确认根数">
                <el-option v-for="count in 10" :key="count" :label="`${count} 根`" :value="count" />
              </el-select>
            </label>
            <label>
              <el-select v-model="structurePreview.pivotRight" size="small" aria-label="支撑阻力右侧确认根数">
                <el-option v-for="count in 10" :key="count" :label="`${count} 根`" :value="count" />
              </el-select>
            </label>
          </div>
        </div>
        <div v-for="field in numericFilterFields" :key="field.key" class="numeric-filter-item">
          <span class="numeric-filter-label">{{ field.label }}<span v-if="field.unit" class="muted"> ({{ field.unit }})</span></span>
          <div class="numeric-filter-range">
            <el-input-number v-model="numericFilters[field.key].min" size="small" :controls="false" :step="field.step" :value-on-clear="null" placeholder="最小" :aria-label="`${field.label}最小${field.unit ? `（${field.unit}）` : ''}`" />
            <span class="muted">—</span>
            <el-input-number v-model="numericFilters[field.key].max" size="small" :controls="false" :step="field.step" :value-on-clear="null" placeholder="最大" :aria-label="`${field.label}最大${field.unit ? `（${field.unit}）` : ''}`" />
          </div>
          <span v-if="isReversedRange(numericFilters[field.key])" class="numeric-filter-error" role="alert">最小值不能大于最大值</span>
        </div>
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">趋势状态</span>
          <el-select v-model="trendStateFilter" size="small" clearable placeholder="不限" aria-label="趋势状态筛选">
            <el-option v-for="item in stateOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </div>
        <div class="numeric-filter-item">
          <span class="numeric-filter-label">MACD状态</span>
          <el-select v-model="macdStateFilter" size="small" clearable placeholder="不限" aria-label="MACD状态筛选">
            <el-option v-for="item in stateOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </div>
      </div>
    </div>

    <el-alert v-if="errorMessage" type="warning" :closable="false" show-icon>{{ errorMessage }}</el-alert>
    <el-table ref="tableRef" v-loading="loading" class="indicators-table" :height="autoHeight ? undefined : '100%'" :data="filteredRows" row-key="symbol" :current-row-key="selectedSymbol" :row-class-name="selectedRowClass" :highlight-current-row="embedded" :empty-text="rows.length ? '当前筛选下暂无交易对' : '暂无已配置交易对或指标数据'" stripe size="small" style="width: 100%" @sort-change="handleSortChange" @row-click="handleRowClick">
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
            <span>{{ baseAsset(row.symbol) }}</span>
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
          </div>
          <div class="symbol-confidence" :title="row.environmentDescription || '暂无可用环境置信度'">
            <span :class="[row.longConfidence == null ? 'muted' : 'up', { 'confidence-leading': row.longConfidence != null && row.shortConfidence != null && row.longConfidence > row.shortConfidence }]"><span class="confidence-label">多</span> {{ row.longConfidence ?? '--' }}</span>
            <span class="muted" aria-hidden="true"></span>
            <span :class="[row.shortConfidence == null ? 'muted' : 'down', { 'confidence-leading': row.longConfidence != null && row.shortConfidence != null && row.shortConfidence > row.longConfidence }]"><span class="confidence-label">空</span> {{ row.shortConfidence ?? '--' }}</span>
          </div>
          <div v-if="recentDivergence(row.latestDivergence)" class="symbol-divergence" :class="row.latestDivergence?.kind === 'bullish' ? 'up' : 'down'" :title="`CVD 背离确认于 ${formatOITime((row.latestDivergence?.confirmedAt ?? 0) * 1000)}；摆动点左右各 3 根收盘确认`">
            {{ row.latestDivergence?.kind === 'bullish' ? '底背离' : '顶背离' }} · {{ divergenceWindow }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="价格 / K线" min-width="88">
        <template #default="{ row }">
          <div class="price-candle-cell">
          <svg v-if="row.candle" class="current-candle" :class="row.candle.tone" viewBox="0 0 24 48" role="img" :aria-label="row.candle.description">
            <title>{{ row.candle.description }}</title>
            <line x1="12" :y1="row.candle.highY" x2="12" :y2="row.candle.lowY" stroke="currentColor" stroke-width="1.5" />
            <rect x="7" :y="row.candle.bodyY" width="10" :height="row.candle.bodyHeight" fill="currentColor" />
          </svg>
          <span v-else class="candle-unavailable muted" title="当前 K 线数据不足">--</span>
          <div>
          <div>{{ formatPrice(row.price) }}</div>
          <span :class="directionClass(row.closeChangePercent)">{{ signed(row.closeChangePercent) }}%</span>
          </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="趋势" min-width="125" class-name="trend-column">
        <template #default="{ row }">
          <div class="trend-result" :class="[row.diDirection.startsWith('多头') ? 'up' : row.diDirection.startsWith('空头') ? 'down' : 'muted', { 'macd-weakening': row.diDirection.endsWith('减弱') }]">{{ row.diDirection }}</div>
          <div class="adx-line">
            <span><span class="muted">ADX</span> {{ formatTrendValue(row.adx) }}</span>
            <el-tooltip placement="top">
              <template #content>
                <div v-for="(line, index) in adxSlopeTooltip(row.adxSlope, row.adxSlopePeriod).split('\n')" :key="index">{{ line }}</div>
              </template>
              <span :class="row.adxSlope == null || row.adxSlope === 0 ? 'muted' : directionClass(row.adxSlope)"><span class="muted">斜率</span> {{ formatAdxSlope(row.adxSlope) }}</span>
            </el-tooltip>
          </div>
          <div class="di-line" :title="`PDI：${formatTrendValue(row.pdi)}\nMDI：${formatTrendValue(row.mdi)}\n差值 = PDI - MDI`">
            <span>PDI {{ diComparison(row.pdi, row.mdi).operator }} MDI</span>
            <span>差 {{ diComparison(row.pdi, row.mdi).difference }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="实时阻力 / 支撑" min-width="120">
        <template #default="{ row }">
          <SupportResistanceInfo :snapshot="row.supportResistance" nearest-only />
        </template>
      </el-table-column>
      <el-table-column label="RSI" align="center" header-align="center" min-width="60" sortable="custom" prop="rsi">
        <template #default="{ row }"><span :class="rsiClass(row.rsi)">{{ row.rsi == null || !Number.isFinite(row.rsi) ? '--' : row.rsi.toFixed(1) }}</span></template>
      </el-table-column>
      <el-table-column label="EMA" min-width="120" class-name="ema-column">
        <template #default="{ row }">
          <div class="ema-line" :title="`EMA${row.fastEmaPeriod}：${formatPrice(row.fastEma)}\nEMA${row.slowEmaPeriod}：${formatPrice(row.slowEma)}`">
            <span class="muted">EMA{{ row.fastEmaPeriod }}</span>
            <span :class="emaComparison(row.fastEma, row.slowEma).tone"> {{ emaComparison(row.fastEma, row.slowEma).operator }} </span>
            <span class="muted">EMA{{ row.slowEmaPeriod }}</span>
          </div>
          <div class="ema-state-line">
            <span :class="emaComparison(row.fastEma, row.slowEma).tone">{{ emaComparison(row.fastEma, row.slowEma).label }}</span>
            <span class="ema-slope" :class="directionClass(row.emaSlope)" :title="`EMA${row.fastEmaPeriod}斜率（回看周期使用机器人配置）`"><span class="muted">斜率</span> {{ signed(row.emaSlope) }}{{ row.emaSlope == null ? '' : '%' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="预量" align="center" header-align="center" min-width="65" prop="volumeRatio" sortable="custom">
        <template #default="{ row }">{{ format(row.volumeRatio) }}x</template>
      </el-table-column>
      <el-table-column label="MACD 实时 · H" min-width="135" sortable="custom" prop="macdHistogram">
        <template #default="{ row }">
          <div class="macd-cell" :title="`当前 M：${formatMacd(row.macd)} / S：${formatMacd(row.macdSignal)}\n上组 M：${formatMacd(row.previousMacd)} / S：${formatMacd(row.previousMacdSignal)}\nH 为柱值，背景柱仅用于同一交易对的当前与上组比较`">
            <div class="macd-state-line">
              <span class="macd-crossover" :class="crossoverClass(row.macdCrossover)">{{ crossoverLabel(row.macdCrossover) }}</span>
              <span class="macd-result" :class="macdResultClass(row.macdHistogram, row.previousMacdHistogram)">{{ macdResult(row.macdHistogram, row.previousMacdHistogram) }}</span>
            </div>
            <!-- 柱形用于快速比较，具体 H 数值通过悬停和无障碍标签提供。 -->
            <div class="macd-bars" :title="`当前 H：${formatSignedMacd(row.macdHistogram)}\n上组 H：${formatSignedMacd(row.previousMacdHistogram)}`" :aria-label="`当前 H：${formatSignedMacd(row.macdHistogram)}，上组 H：${formatSignedMacd(row.previousMacdHistogram)}`">
            <div class="macd-values macd-data-row current-values">
              <span class="macd-row-label">当前</span>
              <span class="macd-row-chart">
                <span class="macd-chart-bar" :class="directionClass(row.macdHistogram)" :style="histogramBarStyle(row.macdHistogram, row.previousMacdHistogram)"></span>
              </span>
            </div>
            <div class="macd-values macd-data-row previous-values">
              <span class="macd-row-label">上组</span>
              <span class="macd-row-chart">
                <span class="macd-chart-bar" :class="directionClass(row.previousMacdHistogram)" :style="histogramBarStyle(row.previousMacdHistogram, row.macdHistogram)"></span>
              </span>
            </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="OI" align="center" header-align="center" min-width="60" prop="oiChangePercent" sortable="custom">
        <template #default="{ row }">
            <div class="oi-cell" :title="row.oiTooltip">
              <div :class="directionClass(row.oiChangePercent)">{{ signed(row.oiChangePercent) }}{{ row.oiChangePercent == null ? '' : '%' }}</div>
              <div class="muted">{{ row.oiChangeLabel }}</div>
            </div>
        </template>
      </el-table-column>
      <el-table-column label="ATR" align="center" header-align="center" min-width="63" prop="atrPercent" sortable="custom">
        <template #default="{ row }">{{ format(row.atrPercent) }}%</template>
      </el-table-column>
      <el-table-column label="资金流" width="100" header-align="center" prop="netInflowPercent" sortable="custom">
        <template #default="{ row }">
            <div class="flow-cell" :title="[`本根：${formatFlowAmount(row.netInflow)} / ${signed(row.netInflowPercent)}${row.netInflowPercent == null ? '' : '%'}`, `近 ${row.moneyFlowWindowBars ?? '--'} 根：${formatFlowAmount(row.cumulativeNetInflow)} / ${signed(row.cumulativeNetInflowPercent)}${row.cumulativeNetInflowPercent == null ? '' : '%'}`, row.moneyFlowTooltip, row.cumulativeFlowTooltip].join('\n')">
              <div class="flow-row">
                <span class="muted">本根</span>
                <!-- 金额保留正负号，由下一行百分比统一表达方向，减少重复着色。 -->
                <span>{{ formatFlowAmount(row.netInflow, 1) }}</span>
                <span :class="flowDirectionClass(row.netInflowPercent)">{{ formatFlowPercent(row.netInflowPercent) }}</span>
              </div>
              <div class="flow-row flow-secondary">
                <span class="muted">近{{ row.moneyFlowWindowBars ?? '--' }}根</span>
                <span>{{ formatFlowAmount(row.cumulativeNetInflow, 1) }}</span>
                <span :class="flowDirectionClass(row.cumulativeNetInflowPercent)">{{ formatFlowPercent(row.cumulativeNetInflowPercent) }}</span>
              </div>
            </div>
        </template>
      </el-table-column>
      <el-table-column label="社区情绪" min-width="80">
        <template #default="{ row }">
            <div class="sentiment-cell" :title="row.sentimentTooltip">
              <div :class="sentimentClass(row.sentiment)">{{ row.sentimentLabel }}<span v-if="row.sentiment != null"> {{ signed(row.sentiment, 1) }}%</span></div>
              <div v-if="row.sentimentStale" class="muted">已过期</div>
              <div class="muted">多 {{ formatOICompact(row.bullishCount) }} / 空 {{ formatOICompact(row.bearishCount) }}</div>
            </div>
        </template>
      </el-table-column>
      <el-table-column label="ER" min-width="60" prop="er" sortable="custom">
        <template #default="{ row }">
            <div :title="row.erTooltip">
              <div>{{ format(row.er) }}</div>
              <span :class="sentimentClass(row.erNetChangePercent)">{{ signed(row.erNetChangePercent) }}{{ row.erNetChangePercent == null ? '' : '%' }}</span>
            </div>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && rows.length === 0" description="暂无已配置交易对或指标数据" />
  </component>
</template>

<script setup lang="ts">
// ==================== 指标看板 ====================
import { computed, ref, watch, onMounted, onUnmounted, useId } from 'vue'
import { ElDrawer, type TableInstance } from 'element-plus'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'
import { useSupportResistancePreview } from '../composables/useSupportResistancePreview'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import type { SupportResistanceSnapshot } from '../../types/support-resistance'
import SupportResistanceInfo from './SupportResistanceInfo.vue'
import { TREND_PERIODS, diTrend, isDoubleStrengthening, type DirectionalTrend, type EnvironmentContext, type PeriodTrend } from '../utils/environment-confidence'
import { isRecentCvdDivergence, type LatestCvdDivergence } from '../utils/cvd-divergence'
import { calculateLiveBreadth } from '../utils/market-breadth'
import type { BreadthPeriod, MarketBreadthSnapshot } from '../../types/market-breadth'

/** 指标列表中的单个交易对展示数据。 */
interface IndicatorRow {
  latestDivergence?: LatestCvdDivergence
  supportResistance?: SupportResistanceSnapshot
  symbol: string; price?: number; closeChangePercent?: number
  candleProgressPercent?: number
  /** 当前未收盘 K 线的归一化图形，保留实体及上下影线比例。 */
  candle?: ReturnType<typeof buildCurrentCandle>
  /** 服务端与策略共用的双方向环境评分；缺失时不补零或推算互补分。 */
  longConfidence?: number; shortConfidence?: number
  /** 文案、圆点与评分共用后端同一环境快照，不在浏览器重新判断。 */
  environmentContext?: EnvironmentContext; environmentDescription?: string
  adx?: number; rsi?: number; atrPercent?: number; oiChangePercent?: number
  /** ER 包含最新未收盘 K 线；方向颜色取同窗口净涨跌，不取 ER 高低。 */
  er?: number; erNetChangePercent?: number; erTooltip: string
  /** 与 ADX 共用后端计算结果，回看窗口以该次计算实际使用的配置为准。 */
  adxSlope?: number; adxSlopePeriod?: number; emaSlope?: number
  /** OI 增减仓折算额及含实际回看窗口的快照悬停数据。 */
  oiChangeLabel: string; oiTooltip: string
  /** ADX 方向指标及基于后端 DI 差距变化得出的趋势信号。 */
  pdi?: number; mdi?: number; diDirection: DirectionalTrend
  /** EMA 周期与数值，以及短周期相对长周期的方向。 */
  fastEmaPeriod: number; slowEmaPeriod: number; fastEma?: number; slowEma?: number; emaBullish?: boolean
  macd?: number; macdSignal?: number; macdHistogram?: number
  previousMacd?: number; previousMacdSignal?: number; previousMacdHistogram?: number
  macdCrossover: 'golden' | 'dead' | 'none'; macdHistogramTrend: 'rising' | 'falling' | 'flat'
  /** 计价资产资金流，保留缺失状态，避免 Number(null) 变为零。 */
  netInflow?: number; netInflowPercent?: number; cumulativeNetInflow?: number; cumulativeNetInflowPercent?: number
  moneyFlowTooltip: string; cumulativeFlowTooltip: string
  /** 使用服务端实际累计窗口，保证标签与资金流计算口径一致。 */
  moneyFlowWindowBars?: number
  volumeRatio?: number; sentiment?: number; sentimentLabel: string; stale: boolean
  /** 后端缓存中的情绪样本量与解释信息。 */
  bullishCount?: number; bearishCount?: number; sentimentTooltip: string; sentimentStale?: boolean
}

/** 指标抽屉的外部控制参数。 */
interface Props {
  modelValue: boolean
  embedded?: boolean
  selectedSymbol?: string
  /** 移动端独立看板按全部行自然展开，使用页面滚动。 */
  autoHeight?: boolean
  /** 独立指标页由父组件统一调度列表和图表。 */
  coordinatedRefresh?: boolean
}

/** 指标抽屉向父组件同步开关状态的事件。 */
interface Emits {
  (event: 'refresh-request'): void
  (event: 'update:modelValue', value: boolean): void
  (event: 'select-symbol', symbol: string, timeframe: string): void
  (event: 'symbols-ready', symbols: string[]): void
  (event: 'timeframe-change', timeframe: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})
const botStore = useBotStore()
// 指标页可独立打开，必须自行订阅实时价格；实例 ID 避免与首页抽屉互相取消订阅。
const priceSubscriberId = `indicators-${useId()}`
const { getCoinIconUrl } = useCoinIcon()
const iconFailed = ref<Record<string, boolean>>({})
const timeframe = ref('1h')
const structurePreview = useSupportResistancePreview()
const structurePresets = [
  { label: '默认 3/3', left: 3, right: 3 },
  { label: '5/3', left: 5, right: 3 },
  { label: '5/5', left: 5, right: 5 }
]
// 周期切换立即通知独立指标页，不必再次点击交易对才刷新右侧图表。
watch(timeframe, value => {
  // 新周期请求完成前清除旧背离，避免沿用另一周期的确认结果。
  rows.value.forEach(row => { row.latestDivergence = undefined })
  emit('timeframe-change', value)
})
const progressNow = ref(Date.now())
// Binance 周期按 UTC 对齐，时间进度属于整个周期，无需逐交易对重复展示。
const currentCandleProgress = computed(() => {
  const duration = ({ '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 } as Record<string, number>)[timeframe.value]!
  return (progressNow.value % duration / duration * 100).toFixed(1)
})

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

/** 页面模式联动两侧手动刷新，抽屉模式继续独立刷新。 */
function requestRefresh() {
  if (props.coordinatedRefresh) emit('refresh-request')
  else void fetchData()
}

/** 统一调度时刷新全部指标；已有请求进行中则等待下一轮，避免重复请求。 */
async function refresh() {
  if (loading.value) return
  await fetchData()
}
defineExpose({ refresh })
type SignalTone = '多头' | '空头' | '反转' | '观望'
const signalFilter = ref<SignalTone | '全部'>('全部')
const selectedSymbols = ref<string[]>([])
const selectedSymbolSet = computed(() => new Set(selectedSymbols.value))
const SYMBOL_SELECTION_KEY = 'indicator-selected-symbols'
let symbolSelectionRestored = false

// 挂载后恢复，避免服务端渲染读取浏览器存储，也避免恢复前覆盖已有选择。
onMounted(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SYMBOL_SELECTION_KEY) || '[]')
    if (Array.isArray(saved)) {
      selectedSymbols.value = [...new Set(saved.filter((symbol): symbol is string => typeof symbol === 'string' && /^[A-Z0-9]+$/.test(symbol)))]
    }
  } catch {
    // 存储被禁用或内容损坏时，仍可在当前页面正常选择。
  }
  symbolSelectionRestored = true
})
watch(selectedSymbols, value => {
  if (!symbolSelectionRestored) return
  try {
    localStorage.setItem(SYMBOL_SELECTION_KEY, JSON.stringify(value))
  } catch {
    // 保存失败不阻断筛选，当前会话的选择仍然有效。
  }
}, { deep: true })
const divergenceFilter = ref<'all' | 'recent' | 'bearish' | 'bullish'>('all')
const divergenceWindow = ref(3)

/** 最近范围使用当前所选周期的确认收盘时间，与右侧图表的确认规则一致。 */
function recentDivergence(signal?: LatestCvdDivergence) {
  const seconds = ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as Record<string, number>)[timeframe.value]!
  return isRecentCvdDivergence(signal, seconds, progressNow.value / 1000, divergenceWindow.value)
}
type NumericFilterKey = 'supportDistanceATR' | 'resistanceDistanceATR' | 'adx' | 'adxSlope' | 'emaSlope' | 'rsi' | 'oiChangePercent' | 'volumeRatio' | 'atrPercent' | 'er'
/** 空边界表示不限；区间包含端点，反向区间不匹配任何交易对。 */
interface NumericFilterRange {
  min: number | null
  max: number | null
}
const numericFilterFields = [
  { key: 'supportDistanceATR', label: '支撑距离', unit: 'ATR', step: 0.1 },
  { key: 'resistanceDistanceATR', label: '阻力距离', unit: 'ATR', step: 0.1 },
  { key: 'adx', label: 'ADX', unit: '', step: 1 },
  { key: 'adxSlope', label: 'ADX斜率', unit: '', step: 0.01 },
  { key: 'emaSlope', label: 'EMA斜率', unit: '%', step: 0.01 },
  { key: 'rsi', label: 'RSI', unit: '', step: 1 },
  { key: 'oiChangePercent', label: 'OI变化率', unit: '%', step: 0.1 },
  { key: 'volumeRatio', label: '预量比', unit: 'x', step: 0.1 },
  { key: 'atrPercent', label: 'ATR', unit: '%', step: 0.1 },
  { key: 'er', label: 'ER', unit: '', step: 0.01 }
] as const
const showNumericFilters = ref(false)
const stateOptions = ['多头增强', '空头增强', '多头持平', '空头持平', '多头减弱', '空头减弱'] as const
const trendStateFilter = ref<typeof stateOptions[number] | ''>('')
const macdStateFilter = ref<typeof stateOptions[number] | ''>('')
const numericFilters = ref(Object.fromEntries(numericFilterFields.map(field => [field.key, { min: null, max: null }])) as Record<NumericFilterKey, NumericFilterRange>)
const activeNumericFilters = computed(() => numericFilterFields.filter(({ key }) => {
  const range = numericFilters.value[key]
  return range.min != null || range.max != null
}).length + Number(!!trendStateFilter.value) + Number(!!macdStateFilter.value))
// 折叠后仍提示所有生效的筛选条件；排序不会减少结果，不计入筛选数量。
const activeFilters = computed(() => activeNumericFilters.value
  + Number(signalFilter.value !== '全部') + Number(divergenceFilter.value !== 'all'))

/** 重置指标条件和观察交易对，恢复全部交易对，保留用户选择的排序。 */
function resetNumericFilters() {
  selectedSymbols.value = []
  for (const { key } of numericFilterFields) numericFilters.value[key] = { min: null, max: null }
  trendStateFilter.value = ''
  macdStateFilter.value = ''
  signalFilter.value = '全部'
  divergenceFilter.value = 'all'
  divergenceWindow.value = 3
}

/** 明确提示填反的区间，避免静默交换上下限导致筛选含义改变。 */
function isReversedRange(range: NumericFilterRange) {
  return range.min != null && range.max != null && range.min > range.max
}

/** 按表格原始数值筛选；启用条件后，缺失或无效指标不能当作零命中。 */
function matchesNumericFilters(row: IndicatorRow) {
  return numericFilterFields.every(({ key }) => {
    const range = numericFilters.value[key]
    if (range.min == null && range.max == null) return true
    if (isReversedRange(range)) return false
    let value: number | null | undefined
    if (key === 'supportDistanceATR' || key === 'resistanceDistanceATR') {
      const snapshot = row.supportResistance
      // 切换周期及后台刷新时，只允许当前周期且存在有效区域的实时距离参与筛选。
      const zone = key === 'supportDistanceATR' ? snapshot?.nearestSupport : snapshot?.nearestResistance
      value = snapshot?.timeframe === timeframe.value && snapshot.status !== 'insufficient_data' && zone ? snapshot[key] : undefined
    } else {
      value = row[key]
    }
    return typeof value === 'number' && Number.isFinite(value)
      && (range.min == null || value >= range.min)
      && (range.max == null || value <= range.max)
  })
}
// 筛选仅影响表格，顶部市场统计始终覆盖全部已配置交易对。
const filteredRows = computed(() => {
  // 先限定观察范围再应用指标条件；空选择表示全部，不改变行情订阅和市场统计。
  const result = sortedRows.value.filter(row => (!selectedSymbolSet.value.size || selectedSymbolSet.value.has(row.symbol))
    && (divergenceFilter.value === 'all' || (recentDivergence(row.latestDivergence)
      && (divergenceFilter.value === 'recent' || row.latestDivergence?.kind === divergenceFilter.value)))
    && (signalFilter.value === '全部' || resonanceInfo(row.symbol).tone === signalFilter.value)
    && matchesNumericFilters(row)
    && (!trendStateFilter.value || row.diDirection === trendStateFilter.value)
    && (!macdStateFilter.value || macdResult(row.macdHistogram, row.previousMacdHistogram) === macdStateFilter.value))
  // 背离筛选默认优先显示最新确认；用户显式选择列排序后保留其排序意图。
  return divergenceFilter.value !== 'all' && !sortOrder.value
    ? result.sort((a, b) => (b.latestDivergence?.confirmedAt ?? 0) - (a.latestDivergence?.confirmedAt ?? 0)) : result
})
const periodSignals = computed(() => Object.fromEntries(
  rows.value.map(row => [row.symbol, row.environmentContext?.periods ?? {}])
))
let fetchVersion = 0
let structureTimer: ReturnType<typeof setInterval> | undefined
let refreshingStructure = false

/** 打开看板时定期补齐实时结构；限制并发，旧周期请求不可覆盖新周期。 */
async function refreshStructure() {
  if (!visible.value || loading.value || refreshingStructure) return
  progressNow.value = Date.now()
  // 启动期首屏为空时继续尝试加载，初始化完成后自动恢复看板。
  if (rows.value.length === 0) {
    await fetchData()
    return
  }
  refreshingStructure = true
  const version = fetchVersion
  const selectedTimeframe = timeframe.value
  const structureParams = { ...structurePreview.value }
  const targets = rows.value.map(row => row.symbol)
  let cursor = 0
  try {
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (visible.value && version === fetchVersion && cursor < targets.length) {
        const symbol = targets[cursor++]!
        try {
          const response: any = await $fetch('/api/bot/indicators', {
            query: { symbol, timeframe: selectedTimeframe, ...structureParams, includeSlowStats: 'false', structureOnly: 'true' }
          })
          if (!visible.value || version !== fetchVersion) return
          const row = rows.value.find(item => item.symbol === symbol)
          if (row) {
            // 价格和蜡烛图使用同一快照，随现有轮询更新未收盘 K 线。
            const latest = response.data?.kline?.latest
            row.candle = buildCurrentCandle(latest)
            row.latestDivergence = response.data?.latestDivergence
            row.price = finiteNumber(latest?.close)
            row.closeChangePercent = finiteNumber(response.data?.kline?.closeChangePercent)
            row.supportResistance = response.data?.indicators?.supportResistance?.values
            row.environmentContext = response.data?.environmentContext
            row.environmentDescription = response.data?.environmentDescription
            row.longConfidence = finiteNumber(response.data?.environmentContext?.long?.confidence)
            row.shortConfidence = finiteNumber(response.data?.environmentContext?.short?.confidence)
          }
        } catch {
          // 刷新失败清除旧结构，避免将上轮价格对应的距离伪装成实时结果。
          if (version === fetchVersion) {
            const row = rows.value.find(item => item.symbol === symbol)
            if (row) {
              row.supportResistance = undefined
              row.latestDivergence = undefined
              row.environmentContext = undefined
              row.environmentDescription = undefined
              row.longConfidence = undefined
              row.shortConfidence = undefined
            }
          }
        }
      }
    }))
  } finally {
    refreshingStructure = false
  }
}
type SortOrder = 'ascending' | 'descending' | null
type ConfidenceSort = 'default' | 'longConfidence' | 'shortConfidence'
type SortProp = 'rsi' | 'er' | 'macdHistogram' | 'atrPercent' | 'oiChangePercent' | 'volumeRatio' | 'netInflowPercent' | 'cumulativeNetInflow' | 'longConfidence' | 'shortConfidence' | null
const tableRef = ref<TableInstance>()
const sortProp = ref<SortProp>(null)
const sortOrder = ref<SortOrder>(null)
// 共用一份排序状态；列排序生效时显示占位提示，避免误示为默认顺序。
const confidenceSort = computed(() => sortProp.value === 'longConfidence' || sortProp.value === 'shortConfidence'
  ? sortProp.value : sortProp.value && sortOrder.value ? '' : 'default')
const sortedRows = computed(() => {
  const prop = sortProp.value
  if (!prop || !sortOrder.value) return rows.value
  const direction = sortOrder.value === 'ascending' ? 1 : -1
  // 保留接口返回的配置顺序，取消排序可直接恢复；同分按原顺序稳定展示。
  // 评分轮询更新时自动重算排序，缺失值始终置底。
  return [...rows.value].sort((left, right) => {
    const leftValue = left[prop]
    const rightValue = right[prop]
    const leftValid = typeof leftValue === 'number' && Number.isFinite(leftValue)
    const rightValid = typeof rightValue === 'number' && Number.isFinite(rightValue)
    if (!leftValid || !rightValid) return leftValid === rightValid ? 0 : leftValid ? -1 : 1
    return (leftValue - rightValue) * direction
  })
})
const symbols = computed<string[]>(() => {
  const configuredSymbols = botStore.config?.symbols
  if (!Array.isArray(configuredSymbols)) return []
  return configuredSymbols.map((symbol: string) => symbol.replace('/', '').toUpperCase())
})

// 选项来自完整配置，不受指标条件或请求失败影响；保留旧选择以便配置变化后仍能手动移除。
const symbolOptions = computed(() => [...new Set([...symbols.value, ...selectedSymbols.value])])

const breadthSymbols = computed(() => [...new Set(symbols.value.map(symbol => symbol.trim()).filter(Boolean))])
// 日线对应价格看板的滚动 24h，其余周期直接复用同一份本地 5m 基准。
const breadthPeriod = computed<BreadthPeriod>(() => timeframe.value === '1d' ? '24h' : timeframe.value as BreadthPeriod)
const breadthSnapshot = ref<MarketBreadthSnapshot | null>(null)
const breadthClock = ref(Date.now())
let breadthRequestId = 0
const marketBreadth = computed(() => {
  const snapshot = breadthSnapshot.value
  const valid = snapshot && breadthClock.value < snapshot.expiresAt
    && JSON.stringify([...breadthSymbols.value].sort()) === JSON.stringify(snapshot.symbols)
  const stats = valid ? snapshot.periods[breadthPeriod.value] : null
  return calculateLiveBreadth(breadthSymbols.value, botStore.prices, breadthPeriod.value,
    stats?.bases ?? {}, stats?.referenceTime ?? null, Math.max(breadthClock.value, Date.now()))
})

/** 与价格看板共用市场快照接口；关闭或配置变化后丢弃旧请求，缺失行情不补零。 */
async function loadMarketBreadth() {
  const requestId = ++breadthRequestId
  breadthClock.value = Date.now()
  try {
    const snapshot = await $fetch<MarketBreadthSnapshot>('/api/market/breadth')
    if (requestId === breadthRequestId) {
      breadthSnapshot.value = snapshot
      breadthClock.value = Date.now()
    }
  } catch (error) {
    console.warn('[Indicators] 获取市场广度失败:', error)
  }
}

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
  // 进度随看板刷新更新，不单独启动高频计时器。
  progressNow.value = Date.now()
  const version = ++fetchVersion
  if (!botStore.botConfig) await botStore.fetchBotConfig()
  if (version !== fetchVersion) return
  if (symbols.value.length === 0) { rows.value = []; loading.value = false; return }
  loading.value = true; errorMessage.value = ''
  const requestedTimeframe = timeframe.value
  const requestedEmaPeriods = [...emaPeriods.value]
  const structureParams = { ...structurePreview.value }
  let initializing = false
  // 五周期环境已由服务端统一返回，浏览器只请求当前主表指标。
  const results = await Promise.all(symbols.value.map(async (symbol: string) => {
    try {
      const response: any = await $fetch('/api/bot/indicators', { query: { symbol, timeframe: requestedTimeframe, ...structureParams, emaPeriods: requestedEmaPeriods.join(','), includeSlowStats: 'false' } })
      if (response.initializing) { initializing = true; return null }
      if (!response.success || !response.data) return null
      return toRow(response.data)
    } catch { return null }
  }))
  // 切换周期或连续刷新时，旧请求不得覆盖最新表格及共振状态。
  if (version !== fetchVersion) return
  rows.value = results.filter(Boolean) as IndicatorRow[]
  emit('symbols-ready', sortedRows.value.map(row => row.symbol))
  if (rows.value.length === 0) errorMessage.value = initializing
    ? '行情初始化中，稍后自动刷新' : '指标暂不可用，请确认指标中心已完成初始化'
  loading.value = false

  // OI 与社区情绪只使用本次响应中的后端缓存；缺失时显示 --，避免打开看板触发外部采集。
}

// 直接索引后端结构结论，标签、颜色与筛选不再重复计算。
const resonanceResults = computed(() => Object.fromEntries(
  rows.value.map(row => [row.symbol, row.environmentContext?.structure])
))

/** 评分快照缺失时明确观望，不沿用旧的结构判断。 */
function resonanceInfo(symbol: string): { label: string; tone: SignalTone } {
  return resonanceResults.value[symbol] ?? { label: '数据不足观望', tone: '观望' }
}

/** 用颜色表达趋势与 MACD 共同确认的方向，非双增强状态使用淡色。 */
function periodTrendClass(trend?: PeriodTrend) {
  const direction = trend?.startsWith('多头') ? 'up' : trend?.startsWith('空头') ? 'down' : 'muted'
  return [direction, { 'trend-weakening': direction !== 'muted' && !isDoubleStrengthening(trend) }]
}

/** 悬停说明圆点顺序与各周期状态，缺失数据不伪装成观望。 */
function resonanceTitle(symbol: string) {
  return `${resonanceInfo(symbol).label}；${timeframes.map(period => `${period}：${periodSignals.value[symbol]?.[period] ?? '暂无数据'}`).join(' / ')}`
}

function signalClass(signal: SignalTone) {
  return signal === '多头' ? 'up' : signal === '空头' || signal === '反转' ? 'down' : 'muted'
}

/** 选择评分排序时清除列头箭头，默认选项恢复接口返回的交易对顺序。 */
function handleConfidenceSortChange(value: ConfidenceSort) {
  tableRef.value?.clearSort()
  sortProp.value = value === 'default' ? null : value
  sortOrder.value = value === 'default' ? null : 'descending'
}

/** 接收 Element Plus 的自定义排序事件，并在当前已加载数据上即时排序。 */
function handleSortChange({ prop, order }: { prop?: string | null; order?: string | null }) {
  sortProp.value = (['rsi', 'er', 'macdHistogram', 'atrPercent', 'oiChangePercent', 'volumeRatio', 'netInflowPercent', 'cumulativeNetInflow'] as string[]).includes(prop || '')
    ? prop as SortProp
    : null
  sortOrder.value = order === 'ascending' || order === 'descending' ? order : null
}

/** 按单根高低价缩放当前 K 线；无波动时在中线展示十字，不伪造振幅。 */
function buildCurrentCandle(kline: any) {
  const open = finiteNumber(kline?.open)
  const high = finiteNumber(kline?.high)
  const low = finiteNumber(kline?.low)
  const close = finiteNumber(kline?.close)
  if (open == null || high == null || low == null || close == null
    || low > Math.min(open, close) || high < Math.max(open, close)) return undefined
  const range = high - low
  const toY = (value: number) => range > 0 ? 4 + (high - value) / range * 40 : 24
  const bodyTop = toY(Math.max(open, close))
  const bodyBottom = toY(Math.min(open, close))
  // 十字星及极小实体保留 1px 可见高度，影线始终使用真实高低价。
  const bodyHeight = Math.max(1, bodyBottom - bodyTop)
  return {
    highY: toY(high), lowY: toY(low),
    bodyY: (bodyTop + bodyBottom - bodyHeight) / 2, bodyHeight,
    tone: close > open ? 'up' : close < open ? 'down' : 'muted',
    description: `当前 ${timeframe.value} K线（未收盘）；开：${formatPrice(open)}；高：${formatPrice(high)}；低：${formatPrice(low)}；收：${formatPrice(close)}。单根独立缩放。`
  }
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
  const er = values('er')
  const emaList = values('ema').emaList || []
  const erReady = er.status === 'ready'
  const erTooltip = [
    `ER(${er.period ?? 20}, ${data.timeframe})，包含最新未收盘K线`,
    '净位移绝对值 / 累计绝对变化，范围 0～1',
    '下方百分数为同窗口净涨跌；ER不表示未来胜率',
    erReady ? `末根${er.closedAt > er.calculatedAt ? '预计收盘' : '收盘'}：${formatOITime(er.closedAt)}` : `不可用：${er.reason ?? '数据缺失'}`
  ].join('\n')
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
  // 诊断响应已按同一回看窗口计算内存 OI 比例，直接复用后端快照。
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
    ...(heat.stale ? ['当前展示历史样本，已过期，等待更新'] : []),
    ...(finiteNumber(heat.dataUpdatedAt) != null ? [`采集时间：${new Date(heat.dataUpdatedAt).toLocaleString()}`] : []),
    `总帖数：${formatOICompact(heat.postCount)}`,
    `方向覆盖：${format(finiteNumber(heat.directionalCoveragePercent))}%`,
    `热度变化：${signed(finiteNumber(heat.changePercent))}%`,
    `统计窗口：${windowMinutes == null ? '--' : windowMinutes % 60 === 0 ? `${windowMinutes / 60}小时` : `${windowMinutes}分钟`}`
  ].join('\n')
  return {
    symbol: data.symbol, latestDivergence: data.latestDivergence, price, closeChangePercent: Number(data.kline?.closeChangePercent),
    candle: buildCurrentCandle(data.kline?.latest),
    supportResistance: data?.indicators?.supportResistance?.values,
    candleProgressPercent: Number(data.kline?.candleProgressPercent),
    longConfidence: finiteNumber(data.environmentContext?.long?.confidence),
    shortConfidence: finiteNumber(data.environmentContext?.short?.confidence),
    environmentContext: data.environmentContext,
    environmentDescription: data.environmentDescription,
    adx: Number(adx.adx), rsi: Number(values('rsi').rsi),
    er: erReady ? finiteNumber(er.er) : undefined,
    erNetChangePercent: erReady ? finiteNumber(er.netChangePercent) : undefined,
    erTooltip,
    adxSlope: finiteNumber(adx.adxSlope), adxSlopePeriod: finiteNumber(adx.adxSlopePeriod),
    // 使用当前快速 EMA 的后端斜率，和看板 EMA 第一行保持一致。
    // 后端返回小数变化率，统一转为百分数用于显示和区间筛选。
    emaSlope: finiteNumber(emaList.find((item: { period: number }) => item.period === fastPeriod)?.slope) == null
      ? undefined : Number(emaList.find((item: { period: number }) => item.period === fastPeriod).slope) * 100,
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
    moneyFlowWindowBars: finiteNumber(flow.windowBars),
    moneyFlowTooltip: `本根成交：${formatFlowAmount(flow.quoteVolume)}\n主动买入：${formatFlowAmount(flow.takerBuyQuoteVolume)}`,
    cumulativeFlowTooltip: `近${flow.windowBars ?? '--'}根：${flowWindow}\n${flow.complete ? '累计比例 = 净流入 / 成交额' : '数据不足，等待补齐'}`,
    volumeRatio: finiteNumber(values('volume').estimatedRatio), sentiment,
    sentimentLabel: sentiment == null ? '--' : sentiment > 0 ? '偏多' : sentiment < 0 ? '偏空' : '中性',
    bullishCount, bearishCount, sentimentTooltip, sentimentStale: heat.stale === true,
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
  return diTrend(spread, gapChange)
}

/** 资金金额使用统一缩写并保留正负号；缺失显示 --。 */
function formatFlowAmount(value?: number | null, maximumFractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return '--'
  // 按显示精度选择单位，避免一位小数舍入后出现 1000K 或 1000M。
  const units = ['', 'K', 'M', 'B']
  let unitIndex = 0
  while (unitIndex < units.length - 1 && Math.abs(Number((value / 1000 ** unitIndex).toFixed(maximumFractionDigits))) >= 1000) unitIndex++
  return `${value > 0 ? '+' : ''}${(value / 1000 ** unitIndex).toLocaleString('en-US', { maximumFractionDigits })}${units[unitIndex]}`
}

/** 资金流比例最多显示一位小数，悬停提示保留原来的两位精度。 */
function formatFlowPercent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

/** 保留零值，避免空值被转换成有效的零样本或零情绪。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function format(value?: number) { return value == null || !Number.isFinite(value) ? '--' : Math.abs(value) >= 1e3 ? formatCompactNumber(value) : value.toFixed(2) }
/** 带符号数值可指定小数位，未指定时沿用原有格式。 */
function signed(value?: number, decimalPlaces?: number) { return value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}${decimalPlaces == null ? format(value) : value.toFixed(decimalPlaces)}` }
/** 趋势列数值固定保留一位小数，缺失数据保持占位。 */
function formatTrendValue(value?: number) {
  return value == null || !Number.isFinite(value) ? '--' : value.toFixed(1)
}
/** ADX 斜率沿用趋势列精度，并保留正向变化的符号。 */
function formatAdxSlope(value?: number) {
  return value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${formatTrendValue(value)}`
}

/** 解释强度与方向的分工，避免将 ADX 上升直接理解为价格上涨。 */
function adxSlopeTooltip(slope?: number, period?: number) {
  const formula = period == null ? '当前 ADX − 回看窗口前 ADX' : `当前 ADX − ${period} 根前 ADX（${timeframe.value}）`
  const strength = slope == null ? '暂无斜率数据' : slope > 0 ? '趋势强度上升' : slope < 0 ? '趋势强度下降' : '趋势强度持平'
  return `${formula}\n${strength}，数值为差值\n方向看 PDI/MDI，动能看 MACD`
}
/** 价格与 EMA 始终显示完整数字，小额价格保留必要的小数精度。 */
/** 用原始方向指标比较大小，差值统一为 PDI - MDI，缺失时不补零。 */
function diComparison(pdi?: number, mdi?: number) {
  if (pdi == null || mdi == null || !Number.isFinite(pdi) || !Number.isFinite(mdi)) {
    return { operator: '--', difference: '--' }
  }
  const difference = Number((pdi - mdi).toFixed(1))
  return {
    operator: pdi === mdi ? '=' : pdi > mdi ? '>' : '<',
    difference: `${difference > 0 ? '+' : ''}${difference.toFixed(1)}`
  }
}

/** 按未取整的 EMA 比较；缺失值不判断方向，相等时不沿用空头标签。 */
function emaComparison(fast?: number, slow?: number) {
  if (fast == null || slow == null || !Number.isFinite(fast) || !Number.isFinite(slow)) {
    return { operator: '--', label: '--', tone: 'muted' }
  }
  if (fast === slow) return { operator: '=', label: '持平', tone: 'muted' }
  return fast > slow
    ? { operator: '>', label: '多头', tone: 'up' }
    : { operator: '<', label: '空头', tone: 'down' }
}

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
  // 正负柱都直接锚定中央零轴，避免分别计算起点和宽度产生边缘偏差。
  return { left: value < 0 ? 'auto' : '50%', right: value < 0 ? '50%' : 'auto', width: `${width}%` }
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

// 切换参数立即使旧请求失效，避免快速切换后旧区域覆盖新结果。
// 按参数值比较，等值对象替换不应额外发起整表请求。
watch([() => structurePreview.value.pivotLeft, () => structurePreview.value.pivotRight], () => {
  for (const row of rows.value) row.supportResistance = undefined
  if (visible.value) void fetchData()
  else fetchVersion++
})
watch(() => symbols.value.join(','), () => {
  breadthRequestId++
  breadthSnapshot.value = null
  if (visible.value && import.meta.client) void loadMarketBreadth()
  if (visible.value) fetchData()
})
watch(() => emaPeriods.value.join(','), () => {
  if (visible.value) fetchData()
})
// 保存各周期情绪窗口后立即重读当前周期缓存，避免继续展示旧窗口的统计。
watch(() => JSON.stringify(botStore.botConfig?.squareHeatWindows), () => {
  if (visible.value) void fetchData()
})
// 市场广度基准来自分钟级缓存，涨跌家数仍随 SSE 实时价格计算。
useGlobalPolling(loadMarketBreadth, () => visible.value)
watch(visible, value => {
  breadthRequestId++
  if (structureTimer) clearInterval(structureTimer)
  structureTimer = undefined
  if (value) {
    if (import.meta.client) {
      void botStore.subscribeToPrices(priceSubscriberId)
      void loadMarketBreadth()
    }
    void fetchData()
    // 抽屉需要较及时的盘中区域距离；独立指标页仍由父级统一刷新，避免重复轮询。
    if (!props.coordinatedRefresh) structureTimer = setInterval(() => { void refreshStructure() }, 15_000)
  } else {
    if (import.meta.client) void botStore.unsubscribeFromPrices(priceSubscriberId)
    // 关闭后使首屏及后台尚未完成的旧请求失效。
    fetchVersion++
  }
}, { immediate: true })
onUnmounted(() => {
  if (import.meta.client) void botStore.unsubscribeFromPrices(priceSubscriberId)
  breadthRequestId++
  fetchVersion++
  if (structureTimer) clearInterval(structureTimer)
})
</script>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.market-counts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 12px; font-variant-numeric: tabular-nums; }
.market-counts > span { white-space: nowrap; }
.structure-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.structure-controls label { display: flex; align-items: center; gap: 6px; }
.structure-controls :deep(.el-select) { width: 56px; }
/* 与订单筛选共用面板底色和边框，避免浅填充色在深色主题下显得过亮。 */
.numeric-filters {
  flex-shrink: 0;
  margin: 0 0 12px;
  padding: 8px 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-expand);
  font-size: 12px;
  max-height: 40vh;
  overflow-y: auto;
  --el-fill-color-blank: var(--bg-page);
}
.numeric-filter-header, .numeric-filter-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.numeric-filter-header { margin-bottom: 8px; flex-wrap: wrap; }
.numeric-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr)); gap: 8px 5px; align-items: start; }
.numeric-filter-item { min-width: 0; }
.numeric-filter-label { display: block; margin-bottom: 4px; font-size: 13px; line-height: 18px; color: var(--text-regular); }
.numeric-filter-item > :deep(.el-select) { width: 80%; }
.numeric-filter-range { display: flex; align-items: center; gap: 6px; }
.numeric-filter-range :deep(.el-input-number) { width: 0; min-width: 0; flex: 1; }
.numeric-filter-error { display: block; margin-top: 4px; color: var(--el-color-danger); }
.ema-state-line { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
.ema-slope { white-space: nowrap; }
/* 数值沿用图表快线暖色、慢线紫色的含义，降低饱和度以免与涨跌提示争抢注意力。 */
.ema-line { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
/* 与 small 尺寸筛选控件齐高，细进度条用主题主色表达时间进展。 */
.candle-progress { display: inline-flex; align-items: center; gap: 7px; height: 24px; padding: 0 8px; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-fill-color-light); white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.candle-progress-label { color: var(--el-text-color-secondary); }
/* 用次级文字灰作为未完成轨道，避免深色主题下与标签底色混在一起。 */
.candle-progress-track { display: block; width: 32px; height: 4px; overflow: hidden; border-radius: 2px; background: var(--el-text-color-secondary); }
.candle-progress-track > span { display: block; height: 100%; border-radius: inherit; background: var(--el-color-primary); transition: width .3s ease; }
.candle-progress-value { min-width: 35px; text-align: right; color: var(--el-color-primary); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .candle-progress-track > span { transition: none; } }
.price-candle-cell { display: flex; align-items: center; gap: 8px; }
.current-candle { width: 24px; height: 48px; flex: 0 0 24px; }
.candle-unavailable { width: 24px; flex: 0 0 24px; text-align: center; }
/* 与趋势背景左边缘对齐，将综合评分收在交易对信息末行。 */
.symbol-confidence { display: flex; align-items: center; gap: 5px; margin-top: 6px; padding-left: 25px; line-height: 1.5; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* 背离提示与上方多空评分共用缩进，保持交易对列的信息层级。 */
.symbol-divergence { padding-left: 25px; white-space: nowrap; }
/* 仅突出双向评分中更高的一侧；相等或数据缺失时不暗示方向优势。 */
.confidence-leading { font-weight: 700; }
.symbol-confidence > span:not(.confidence-leading) { color: var(--text-regular); }
/* 标签保持次级灰且不随优势数字加粗，只给数字保留轻微的亮度及方向差异。 */
.symbol-confidence .confidence-label { color: var(--text-secondary); font-weight: 400; }
.symbol-confidence > span.muted { color: var(--text-secondary); }
.symbol-select { flex: 0 0 170px; width: 170px; min-width: 0; margin-left: auto; }
/* 已选标签提示挂载在 body，单独限宽并换行，避免多选后横向撑满页面。 */
:global(.indicator-symbol-tags) { width: 300px; max-width: calc(100vw - 32px); box-sizing: border-box; }
:global(.indicator-symbol-tags .el-select__selection) { flex-wrap: wrap; max-height: 220px; overflow-y: auto; }
/* 不沿用相邻按钮的额外左间距，统一由工具栏 gap 控制。 */
.toolbar > .el-button { margin-left: 0; }
.adx-line { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.di-line { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.up { color: var(--el-color-success); }.down { color: var(--el-color-danger); }.muted { color: var(--el-text-color-secondary); }
/* 辅助指标数值使用正常文字色；标签仍为次级灰，避免整行数值同时争抢注意力。 */
.di-line > .up, .di-line > .down,
.adx-line > .up, .adx-line > .down,
.ema-slope.up, .ema-slope.down { color: var(--text-regular); }
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
.resonance { display: grid; grid-template-columns: repeat(5, 10px); align-items: center; gap: 3px; margin-top: 6px; padding-left: 25px; min-height: 12px; font-size: 11px; }
.resonance-dot { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 3px; background: currentColor; }
.resonance-dot.trend-weakening { opacity: .4; }
.coin-icon, .coin-icon-placeholder { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%; }
.coin-icon { display: block; object-fit: cover; }
.coin-icon-placeholder { display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
.macd-cell { display: flex; flex-direction: column; gap: 5px; min-width: 0; line-height: 1.5; }
.flow-cell { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; font-weight: 400; }
/* 本根与累计资金流并排，每列依次展示标签、金额和比例，便于横向比较。 */
.flow-row { display: flex; flex-direction: column; align-items: center; gap: 1px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.flow-secondary > span { opacity: .7; }
.sentiment-cell { display: flex; flex-direction: column; gap: 3px; line-height: 1.35; white-space: nowrap; font-variant-numeric: tabular-nums; }
.oi-cell { display: flex; flex-direction: column; gap: 3px; line-height: 1.35; white-space: nowrap; font-variant-numeric: tabular-nums; }
.macd-state-line, .macd-values { display: grid; align-items: center; column-gap: 4px; }
.macd-state-line { grid-template-columns: 48px minmax(0, 1fr); }
/* 两组柱共用中央零轴，数值靠近零轴显示在无柱体的一侧。 */
.macd-bars { display: flex; flex-direction: column; gap: 5px; }
.macd-values { grid-template-columns: 28px minmax(0, 1fr); font-variant-numeric: tabular-nums; white-space: nowrap; }
.macd-values > span:not(:first-child) { text-align: right; }
/* 无交叉使用常规文字色；提高状态选择器优先级，确保金叉、死叉颜色不被覆盖。 */
.macd-crossover { font-weight: 400; }
.macd-crossover.muted { color: var(--el-text-color-primary); }
.macd-crossover.up { color: var(--el-color-success); }
.macd-crossover.down { color: var(--el-color-danger); }
/* 趋势与 MACD 状态共用字重，避免同色文字因粗细不同产生亮度差异。 */
.trend-result, .macd-result { white-space: nowrap; font-weight: 600; }
.macd-weakening { opacity: .6; }
.macd-row-label, .previous-values { color: var(--text-secondary); }
.current-values { color: var(--text-primary); }
.macd-data-row { position: relative; min-height: 20px; }
.macd-data-row > span:not(.macd-row-chart) { position: relative; z-index: 1; }
.macd-row-chart { position: absolute; left: 36px; right: 0; top: 1px; bottom: 1px; padding: 0; border: 0; pointer-events: none; }
.macd-row-chart::before { content: ''; position: absolute; left: 50%; top: 15%; bottom: 15%; width: 1px; background: var(--text-secondary); opacity: .45; }
.macd-chart-bar { position: absolute; top: 15%; height: 70%; margin: 0; padding: 0; border: 0; background: currentColor; opacity: .28; }
.previous-values .macd-chart-bar { opacity: .12; }

/* 分组留白优先于缩小文字，当前值与辅助说明保持清晰层级。 */
.indicators-table :deep(.structure-info) { line-height: inherit; }
.indicators-table :deep(.structure-status) { color: var(--el-text-color-secondary); }
.indicators-table :deep(.structure-info .distance) { font-size: 11px; }
.indicators-table :deep(.ema-column .cell) { line-height: 1.8; }
.indicators-table :deep(td.el-table__cell) { padding-top: 6px; padding-bottom: 6px; }
.indicators-table :deep(th.el-table__cell) { padding-top: 10px; padding-bottom: 10px; }

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
  --indicator-ema-fast: #986b2c;
  --indicator-ema-slow: #7460a6;
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

/* 仅降低深色看板普通读数的亮度；局部变量同时覆盖斜率等辅助数值，方向色保持原样。 */
:global(html.dark .indicators-drawer .indicators-table) {
  --text-regular: #b5bac4;
  --el-table-text-color: var(--text-regular);
  --indicator-ema-fast: #cdb07e;
  --indicator-ema-slow: #ada0ce;
}

:global(.indicators-drawer .el-empty__description p) {
  color: var(--text-secondary);
}

/* 为相邻列留出阅读间距，数字保留原有字号。 */
:global(.indicators-drawer .indicators-table .cell) {
  padding-left: 8px;
  padding-right: 8px;
}

/* 使用淡竖线明确列边界，保留现有横线和斑马纹，避免完整网格过于抢眼。 */
:global(.indicators-drawer .indicators-table .el-table__cell:not(:last-child)) {
  border-right: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
}

:global(.indicators-drawer .el-drawer__body) {
  padding-left: 12px;
  padding-right: 12px;
}

@media (max-width: 768px) {
  /* 控件按可用宽度并排换行，避免工具栏逐项独占一行挤压表格。 */
  .toolbar {
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .toolbar :deep(.el-radio-group) { flex-shrink: 0; }
  .toolbar :deep(.el-radio-button__inner) { padding-left: 8px; padding-right: 8px; }
  .candle-progress { gap: 5px; padding: 0 6px; }
  .candle-progress-track { width: 24px; }
  .symbol-select { margin-left: 0; }
  /* Element Plus 相邻按钮默认有左边距；换行间距统一由工具栏 gap 控制。 */
  .toolbar > .el-button { margin-left: 0; }

  /* 手机端占满屏幕，保持与日志抽屉一致的操作体验。 */
  :global(.indicators-drawer) {
    width: 100% !important;
  }
}
</style>
