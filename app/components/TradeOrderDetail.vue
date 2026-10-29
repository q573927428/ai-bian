<!-- ==================== 订单完整详情：历史表格与图表下方共用 ==================== -->
<template>
<div class="expand-detail" :class="{ compact }">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">入场置信度</span>
                <el-tag class="key-score-tag" type="primary" effect="light" size="small">{{ row.entryConfidence ?? '--' }}</el-tag>
              </div>
              <div class="detail-item">
                <span class="detail-label">总评分</span>
                <el-tag class="key-score-tag" type="success" effect="light" size="small">{{ formatScore(row.entryScoreBreakdown?.finalScore ?? row.entryScore) }}</el-tag>
              </div>
              <div class="detail-item">
                <span class="detail-label">基础分</span>
                <span class="detail-value">{{ formatScore(row.entryScoreBreakdown?.baseScore) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">硬条件分</span>
                <span class="detail-value">{{ formatScore(row.entryScoreBreakdown?.hardScore) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">软条件分</span>
                <span class="detail-value">{{ formatScore(row.entryScoreBreakdown?.softScore) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">扣分</span>
                <span class="detail-value">{{ formatScore(row.entryScoreBreakdown?.penaltyScore) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">风险</span>
                <span class="detail-value">
                  <el-tag
                    :type="getRiskLevelType(row.entryRiskLevel)"
                    size="small"
                  >
                    {{ row.entryRiskLevel ?? '--' }}
                  </el-tag>
                </span>
              </div>

              <div class="detail-item">
                <span class="detail-label">止损价</span>
                <span class="detail-value">${{ formatPrice(row.stopLossPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最终止损价</span>
                <span class="detail-value">${{ formatPrice(row.finalStopLossPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">移动止损次数</span>
                <span class="detail-value">{{ formatTrailingStopCount(row.trailingStopCount) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止盈TP1</span>
                <span class="detail-value">${{ formatPrice(row.takeProfit1Price) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止盈TP2</span>
                <span class="detail-value">${{ formatPrice(row.takeProfit2Price) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最高价</span>
                <span class="detail-value">${{ formatPrice(row.highestPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最低价</span>
                <span class="detail-value">${{ formatPrice(row.lowestPrice) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮盈</span>
                <span class="detail-value text-success">${{ formatPrice(row.maxFloatingProfit) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮亏</span>
                <span class="detail-value text-danger">${{ formatPrice(row.maxFloatingLoss) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮盈%</span>
                <span class="detail-value text-success">{{ formatPrice(row.maxFloatingProfitPercent) }}%</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">最大浮亏%</span>
                <span class="detail-value text-danger">{{ formatPrice(row.maxFloatingLossPercent) }}%</span>
              </div>
              <!--K线完成进度%-->
              <div class="detail-item">
                <span class="detail-label">K 线进度</span>
                <span class="detail-value">{{ formatPrice(row.candleProgressPercent) }}%</span>
              </div>
            </div>
            <details v-if="row.entryIndicators" :key="`indicators-${row.id}`" class="detail-section collapsible-section">
              <summary class="detail-label">入场指标</summary>
              <div class="indicators-tags">
                <el-tag
                  v-for="(val, key) in getEntryIndicators(row.entryIndicators)"
                  :key="key"
                  size="small"
                  effect="plain"
                >
                  {{ formatIndicatorLabel(String(key)) }}: {{ formatIndicatorValue(String(key), val) }}
                </el-tag>
              </div>
            </details>
            <div v-if="showStructure && row.entrySupportResistance" class="detail-section">
              <span class="detail-label">入场支撑阻力快照</span>
              <SupportResistanceInfo :snapshot="row.entrySupportResistance" detailed />
            </div>
            <details v-if="row.entryCommunitySentiment" :key="`sentiment-${row.id}`" class="detail-section collapsible-section">
              <summary class="detail-label">入场社区情绪</summary>
              <div class="indicators-tags">
                <el-tag
                  v-for="(val, key) in row.entryCommunitySentiment"
                  :key="key"
                  size="small"
                  effect="plain"
                >
                  {{ formatCommunitySentimentLabel(String(key)) }}: {{ formatCommunitySentimentValue(String(key), val) }}
                </el-tag>
              </div>
            </details>
            <div v-if="row.aiReasoning" class="detail-section">
              <span class="detail-label">AI 推理</span>
              <span class="detail-value reason-text">平仓原因：{{ row.reason }}； {{ row.aiReasoning }}</span>
            </div>
          </div>
</template>

<script setup lang="ts">
import type { TradeHistory } from "../../types"
import SupportResistanceInfo from "./SupportResistanceInfo.vue"

/** 订单详情展示参数；紧凑模式用于复盘图表下方，结构快照可独立排除。 */
interface Props {
  row: TradeHistory
  compact?: boolean
  showStructure?: boolean
}
withDefaults(defineProps<Props>(), { compact: false, showStructure: true })

// 获取风险等级类型
function getRiskLevelType(level?: string): 'success' | 'warning' | 'danger' | 'info' {
  const types: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    LOW: 'success',
    MEDIUM: 'warning',
    HIGH: 'danger',
  }
  return level ? types[level] || 'info' : 'info'
}

/**
 * 格式化评分，保留非整数评分精度并兼容旧历史记录缺少拆分分数的情况。
 */
function formatScore(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * 格式化移动止损次数；旧记录没有保存真实次数时不做推测。
 */
function formatTrailingStopCount(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${Math.max(0, Math.trunc(value))}次`
}

// 格式化价格（根据价格大小动态小数位）
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

// 入场指标中以 Percent 结尾的字段本身已经是百分数值，需要补充百分号避免与普通数值混淆。
function formatIndicatorValue(key: string, value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '--')
  const formatted = formatPrice(value)
  return key.endsWith('Percent') ? `${formatted}%` : formatted
}

/** 补齐旧订单缺失的趋势指标展示项；不修改或推算原始入场快照。 */
function getEntryIndicators(indicators: Record<string, number>): Record<string, number | undefined> {
  return { PDI: undefined, MDI: undefined, ADXSlope: undefined, ...indicators }
}

// 百分比数值只保留两位小数（用于 OI变化率、预计量/EMA 列）
function formatPercent2(value: number | undefined | null): string {
  if (value == null || isNaN(value) || !isFinite(value)) return '--'
  return `${value.toFixed(2)}%`
}

const INDICATOR_LABELS: Record<string, string> = {
  PDI: 'PDI',
  MDI: 'MDI',
  ADXSlope: 'ADX斜率',
  ATRVolatilityPercent: 'ATR波动率',
  OIChangePercent: 'OI变化率',
  EstimatedVolume: '预计量',
  VolumeEmaAverage: 'EMA均量',
  EstimatedVolumeEmaRatioPercent: '预计量/EMA'
}

function formatIndicatorLabel(key: string): string { return INDICATOR_LABELS[key] || key }

const COMMUNITY_SENTIMENT_LABELS: Record<string, string> = {
  windowMinutes: '统计窗口',
  dataUpdatedAt: '时间',
  heat: '广场热度',
  postCount: '帖子总数',
  historyAveragePostCount: '历史平均数',
  heatChangePercent: '热度',
  heatTrend: '趋势',
  bullishCount: '看涨数',
  bearishCount: '看跌数',
  neutralCount: '中立数',
  directionalCoveragePercent: '方向覆盖率',
  netDirectionalSentimentPercent: '净情绪'
}

/**
 * 格式化社区情绪字段名称，确保历史订单展示使用稳定的业务口径。
 */
function formatCommunitySentimentLabel(key: string): string {
  return COMMUNITY_SENTIMENT_LABELS[key] || key
}

/**
 * 根据社区情绪字段语义格式化数值、周期、趋势和采集时间。
 */
function formatCommunitySentimentValue(key: string, value: unknown): string {
  if (key === 'dataUpdatedAt' && typeof value === 'number') return formatTime(value)
  if (key === 'windowMinutes' && typeof value === 'number') {
    if (value % (24 * 60) === 0) return `${value / (24 * 60)}D`
    if (value % 60 === 0) return `${value / 60}H`
    return `${value}M`
  }
  if (key === 'heatTrend') {
    const trendLabels: Record<string, string> = {
      increasing: '增长',
      normal: '正常',
      decreasing: '下降'
    }
    return trendLabels[String(value)] || String(value ?? '--')
  }
  if (typeof value !== 'number') return String(value ?? '--')
  const formatted = formatPrice(value)
  return key.endsWith('Percent') ? `${formatted}%` : formatted
}

// 格式化时间
function formatTime(timestamp: number): string {
  if (!timestamp) return '--'
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}


</script>

<style scoped>
.expand-detail {
  background: var(--bg-expand);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 16px;
  margin: 10px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-value {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.detail-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.indicators-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reason-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-regular);
  word-break: break-all;
}


.compact { margin: 12px 0 0; padding: 10px 12px; }
.compact .detail-grid { grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 6px 12px; margin-bottom: 6px; }
.compact .detail-item { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 2px 6px; }
.compact .detail-label { font-size: 11px; }
.compact .detail-value { font-size: 12px; }
.compact .detail-section { margin-top: 8px; padding-top: 8px; gap: 5px; }
.compact .indicators-tags { gap: 4px; }
.compact :deep(.el-tag) { height: auto; min-height: 20px; max-width: 100%; padding: 2px 5px; font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
.compact .reason-text { line-height: 1.6; overflow-wrap: anywhere; white-space: normal; }
.key-score-tag,
.compact :deep(.key-score-tag) { min-width: 34px; padding: 2px 7px; font-size: 13px; font-weight: 700; justify-content: center; }
/* 原生折叠默认关闭；切换订单时通过 key 重建，避免沿用上一笔的展开状态。 */
.collapsible-section { display: block; }
.collapsible-section summary { cursor: pointer; user-select: none; }
.collapsible-section summary::marker { color: var(--el-color-primary); }
.collapsible-section[open] summary { margin-bottom: 6px; }
</style>
