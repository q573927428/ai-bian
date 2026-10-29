<!-- ==================== 历史订单列表与筛选 ==================== -->
<template>
  <component
    :is="embedded ? 'section' : ElDrawer"
    v-model="visible"
    class="history-drawer"
    :class="{ 'is-embedded': embedded }"
    direction="rtl"
    size="75%"
    destroy-on-close
  >
    <div v-if="embedded" class="card-header embedded-header">
      <span>历史订单 ({{ total }})</span>
      <div class="header-actions">
        <el-button size="small" text @click="showFilter = !showFilter">筛选</el-button>
        <el-button size="small" text :loading="loading" @click="refreshHistory">刷新</el-button>
      </div>
    </div>
    <template #header>
      <div class="card-header">
        <span>📋 历史订单 ({{ total }})</span>
        <div class="header-actions">
          <el-button size="small" text @click="showFilter = !showFilter">
            <el-icon><ElIconFilter /></el-icon>
            筛选
          </el-button>
          <el-button type="primary" size="small" text :loading="loading" @click="refreshHistory">
            <el-icon><ElIconRefresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>
    </template>

    <!-- 筛选栏 -->
    <div v-if="showFilter" class="filter-bar">
      <div class="filter-row">
        <div class="filter-item">
          <span class="filter-label">交易对</span>
          <el-select
            v-model="filter.symbol"
            placeholder="全部"
            size="small"
            clearable
            style="width: 110px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="s in tradeHistoryStore.availableSymbols"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">方向</span>
          <el-select
            v-model="filter.direction"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option label="做多" value="LONG" />
            <el-option label="做空" value="SHORT" />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">策略</span>
          <el-select
            v-model="filter.strategyId"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="s in tradeHistoryStore.availableStrategies"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">平仓原因</span>
          <el-select
            v-model="filter.closeCategory"
            placeholder="全部"
            size="small"
            clearable
            style="width: 100px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="c in tradeHistoryStore.availableCloseCategories"
              :key="c"
              :label="getCloseCategoryLabel(c)"
              :value="c"
            />
          </el-select>
        </div>
      </div>

      <div class="filter-row range-filter-row">
        <div class="filter-item">
          <span class="filter-label">盈亏区间</span>
          <el-input-number
            v-model="filter.pnlMin"
            class="range-input"
            placeholder="最小"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-separator">至</span>
          <el-input-number
            v-model="filter.pnlMax"
            class="range-input"
            placeholder="最大"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
        </div>

        <div class="filter-item">
          <span class="filter-label">评分区间</span>
          <el-input-number
            v-model="filter.scoreMin"
            class="range-input"
            placeholder="最小"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-separator">至</span>
          <el-input-number
            v-model="filter.scoreMax"
            class="range-input"
            placeholder="最大"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
        </div>

        <div class="filter-item">
          <span class="filter-label">置信度区间</span>
          <el-input-number
            v-model="filter.confidenceMin"
            class="range-input"
            placeholder="最小"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-separator">至</span>
          <el-input-number
            v-model="filter.confidenceMax"
            class="range-input"
            placeholder="最大"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
        </div>

        <div class="filter-item">
          <span class="filter-label">OI区间</span>
          <el-input-number
            v-model="filter.oiMin"
            class="range-input"
            placeholder="最小"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-separator">至</span>
          <el-input-number
            v-model="filter.oiMax"
            class="range-input"
            placeholder="最大"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-unit">%</span>
        </div>

        <div class="filter-item">
          <span class="filter-label">预计量区间</span>
          <el-input-number
            v-model="filter.estimatedVolumeMin"
            class="range-input"
            placeholder="最小"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-separator">至</span>
          <el-input-number
            v-model="filter.estimatedVolumeMax"
            class="range-input"
            placeholder="最大"
            size="small"
            :controls="false"
            @change="handleFilterChange"
          />
          <span class="range-unit">%</span>
        </div>

        <el-button size="small" type="primary" @click="handleResetFilter">
          重置
        </el-button>
      </div>

      <!-- 筛选汇总基于全部匹配订单计算，不受分页影响。 -->
      <div class="history-summary">
        <div class="summary-item">
          <span class="summary-label">总盈亏</span>
          <span :class="tradeHistoryStore.filteredSummary.totalPnl >= 0 ? 'text-success' : 'text-danger'">
            ${{ tradeHistoryStore.filteredSummary.totalPnl >= 0 ? '+' : '' }}{{ formatSummaryNumber(tradeHistoryStore.filteredSummary.totalPnl) }}
          </span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">总胜率</span>
          <span class="summary-value">
            {{ tradeHistoryStore.filteredSummary.winRate.toFixed(2) }}%
            <small>({{ tradeHistoryStore.filteredSummary.winCount }}/{{ tradeHistoryStore.filteredSummary.orderCount }})</small>
          </span>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && orders.length === 0" class="loading-state">
      <el-icon class="loading-icon"><ElIconLoading /></el-icon>
      <span>加载中...</span>
    </div>

    <!-- 空状态 -->
    <div v-else-if="orders.length === 0" class="empty-state">
      <el-icon class="empty-icon"><ElIconDataAnalysis /></el-icon>
      <span>暂无历史订单</span>
    </div>

    <!-- 常用字段直接展示，所选订单的策略与平仓详情由右侧图表区域展示。 -->
    <el-table
      v-else-if="embedded"
      v-loading="loading"
      class="compact-orders-table"
      scrollbar-always-on
      :data="orders"
      row-key="id"
      :current-row-key="selectedId"
      highlight-current-row
      stripe
      border
      size="small"
      style="width: 100%"
      @row-click="(order: TradeHistory) => emit('select-order', order)"
      @sort-change="handleSortChange"
    >
      <el-table-column type="index" label="" width="30" align="center" :index="(index: number) => (currentPage - 1) * pageSize + index + 1" />
      <el-table-column label="交易对" prop="symbol" min-width="104" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="emit('select-order', row as TradeHistory)">{{ row.symbol }}</el-button>
        </template>
      </el-table-column>
      <el-table-column label="方向" width="40" align="center">
        <template #default="{ row }"><span :class="row.direction === 'LONG' ? 'text-success' : 'text-danger'">{{ row.direction === 'LONG' ? '多' : '空' }}</span></template>
      </el-table-column>
      <el-table-column label="周期" width="38" align="center">
        <template #default="{ row }">{{ row.mainTimeframe || row.entrySupportResistance?.timeframe || '1h' }}</template>
      </el-table-column>
      <el-table-column label="开仓" prop="entryPrice" min-width="70" align="right" show-overflow-tooltip>
        <template #default="{ row }">{{ formatTradePrice(row.entryPrice) }}</template>
      </el-table-column>
      <el-table-column label="平仓" prop="exitPrice" min-width="70" align="right" show-overflow-tooltip>
        <template #default="{ row }">{{ formatTradePrice(row.exitPrice) }}</template>
      </el-table-column>
      <el-table-column label="杠杆" width="38" align="center">
        <template #default="{ row }">{{ row.leverage }}x</template>
      </el-table-column>
      <el-table-column label="盈亏" prop="pnl" min-width="99" align="right" sortable="custom">
        <template #default="{ row }"><span :class="row.pnl >= 0 ? 'text-success' : 'text-danger'">{{ row.pnl.toFixed(2) }} ({{ formatPercent2(row.pnlPercentage) }})</span></template>
      </el-table-column>
      <el-table-column label="评分" prop="entryScore" width="68" align="center" sortable="custom">
        <template #default="{ row }">{{ formatScore(row.entryScoreBreakdown?.finalScore ?? row.entryScore) }}</template>
      </el-table-column>
      <el-table-column label="置信" prop="entryConfidence" width="68" align="center" sortable="custom">
        <template #default="{ row }">{{ formatScore(row.entryConfidence) }}</template>
      </el-table-column>
      <el-table-column label="OI" prop="oiChangePercent" width="62" align="right" sortable="custom">
        <template #default="{ row }">
          <span :class="getOiChangeClass(row.entryIndicators?.OIChangePercent)">{{ formatPercent2(row.entryIndicators?.OIChangePercent) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="预量" prop="estimatedVolumeEmaRatioPercent" width="72" align="right" sortable="custom">
        <template #default="{ row }">{{ formatPercent2(row.entryIndicators?.EstimatedVolumeEmaRatioPercent) }}</template>
      </el-table-column>
      <el-table-column label="持仓" prop="holdingMinutes" width="80" align="center" sortable="custom" show-overflow-tooltip>
        <template #default="{ row }">{{ formatHoldingTime(row.openTime, row.closeTime) }}</template>
      </el-table-column>
      <el-table-column label="开仓" prop="openTime" width="80" sortable="custom">
        <template #default="{ row }">{{ formatTime(row.openTime) }}</template>
      </el-table-column>
      <el-table-column label="原因" width="64" align="center">
        <template #default="{ row }">
          <el-tooltip :content="row.reason || '暂无平仓原因'" placement="top">
            <el-tag :type="getCloseCategoryType(row.closeCategory)" size="small">
              {{ getCloseCategoryLabel(row.closeCategory) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
    <!-- 表格 -->
    <el-table
      ref="tableRef"
      v-else
      class="history-detail-table"
      :data="orders"
      stripe
      border
      size="small"
      style="width: 100%"
      :header-cell-style="{ background: 'var(--table-header-bg)', color: 'var(--table-header-color)', fontWeight: 600 }"
      @sort-change="handleSortChange"
      :row-key="(row: any) => row.id"
    >
      <el-table-column type="index" label="序号" width="52" align="center" :index="(index: number) => (currentPage - 1) * pageSize + index + 1" />
      <!-- 展开行 -->
      <el-table-column type="expand" width="1">
        <template #default="{ row }">
          <div class="expand-detail">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">入场置信度</span>
                <span class="detail-value">{{ row.entryConfidence ?? '--' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">总评分</span>
                <span class="detail-value">{{ formatScore(row.entryScoreBreakdown?.finalScore ?? row.entryScore) }}</span>
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
                <span class="detail-label">风险等级</span>
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
                <span class="detail-label">止盈1价</span>
                <span class="detail-value">${{ formatPrice(row.takeProfit1Price) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">止盈2价</span>
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
                <span class="detail-label">K 线完成进度</span>
                <span class="detail-value">{{ formatPrice(row.candleProgressPercent) }}%</span>
              </div>
            </div>
            <div v-if="row.entryIndicators" class="detail-section">
              <span class="detail-label">入场指标</span>
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
            </div>
            <div v-if="row.entrySupportResistance" class="detail-section">
              <span class="detail-label">入场支撑阻力快照</span>
              <SupportResistanceInfo :snapshot="row.entrySupportResistance" detailed />
            </div>
            <div v-if="row.entryCommunitySentiment" class="detail-section">
              <span class="detail-label">入场社区情绪</span>
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
            </div>
            <div v-if="row.aiReasoning" class="detail-section">
              <span class="detail-label">AI 推理</span>
              <span class="detail-value reason-text">平仓原因：{{ row.reason }}； {{ row.aiReasoning }}</span>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="交易对" width="126" fixed>
        <template #default="{ row }">
          <button
            type="button"
            class="symbol symbol-link"
            :title="`查看 ${row.symbol}${row.mainTimeframe ? ' ' + row.mainTimeframe : ''} 图表`"
            @click.stop="selectChart(row.symbol, row.mainTimeframe)"
          >{{ row.symbol }}</button>
        </template>
      </el-table-column>

      <el-table-column label="方向" width="70" align="center">
        <template #default="{ row }">
          <el-tag
            :type="row.direction === 'LONG' ? 'success' : 'danger'"
            size="small"
            effect="dark"
          >
            {{ row.direction === 'LONG' ? '做多' : '做空' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="策略" min-width="110">
        <template #default="{ row }">
          <el-tag v-if="row.strategyId" type="info" size="small" effect="plain">
            {{ row.strategyId }}
          </el-tag>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column>

      <el-table-column
        label="入场价"
        width="80"
        align="right"
        prop="entryPrice"
      >
        <template #default="{ row }">
          ${{ formatTradePrice(row.entryPrice) }}
        </template>
      </el-table-column>

      <el-table-column
        label="出场价"
        width="80"
        align="right"
        prop="exitPrice"
      >
        <template #default="{ row }">
          ${{ formatTradePrice(row.exitPrice) }}
        </template>
      </el-table-column>

      <!-- <el-table-column
        label="数量"
        width="70"
        align="right"
        prop="quantity"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ row.quantity }}
        </template>
      </el-table-column> -->

      <el-table-column
        label="杠杆"
        width="65"
        align="center"
        prop="leverage"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ row.leverage }}x
        </template>
      </el-table-column>

      <el-table-column
        label="盈亏"
        width="70"
        align="right"
        prop="pnl"
        sortable="custom"
      >
        <template #default="{ row }">
          <span :class="row.pnl >= 0 ? 'text-success' : 'text-danger'">
            ${{ row.pnl >= 0 ? '+' : '' }}{{ row.pnl?.toFixed(2) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column
        label="盈亏%"
        width="80"
        align="right"
        prop="pnlPercentage"
        sortable="custom"
      >
        <template #default="{ row }">
          <span :class="row.pnlPercentage >= 0 ? 'text-success' : 'text-danger'">
            {{ row.pnlPercentage >= 0 ? '+' : '' }}{{ row.pnlPercentage?.toFixed(2) }}%
          </span>
        </template>
      </el-table-column>

      <el-table-column label="手续费" width="60" align="right">
        <template #default="{ row }">
          ${{ row.totalCommission != null ? row.totalCommission.toFixed(2) : '--' }}
        </template>
      </el-table-column>

      <el-table-column label="评分" width="65" align="center" prop="entryScore" sortable="custom">
        <template #default="{ row }">
          {{ formatScore(row.entryScoreBreakdown?.finalScore ?? row.entryScore) }}
        </template>
      </el-table-column>

      <el-table-column label="置信" width="65" align="center" prop="entryConfidence" sortable="custom">
        <template #default="{ row }">
          {{ row.entryConfidence != null ? row.entryConfidence : '--' }}
        </template>
      </el-table-column>

      <!-- <el-table-column label="风险" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            v-if="row.entryRiskLevel"
            :type="row.entryRiskLevel === 'LOW' ? 'success' : row.entryRiskLevel === 'HIGH' ? 'danger' : 'warning'"
            size="small"
            effect="dark"
          >
            {{ row.entryRiskLevel }}
          </el-tag>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column> -->

      <el-table-column
        label="OI"
        width="60"
        align="center"
        prop="oiChangePercent"
        sortable="custom"
      >
        <template #default="{ row }">
          <span
            v-if="row.entryIndicators?.OIChangePercent != null"
            :class="getOiChangeClass(row.entryIndicators.OIChangePercent)"
          >
            {{ formatPercent2(row.entryIndicators.OIChangePercent) }}
          </span>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column>

      <el-table-column
        label="预计量"
        width="80"
        align="center"
        prop="estimatedVolumeEmaRatioPercent"
        sortable="custom"
      >
        <template #default="{ row }">
          <span v-if="row.entryIndicators?.EstimatedVolumeEmaRatioPercent != null">
            {{ formatPercent2(row.entryIndicators.EstimatedVolumeEmaRatioPercent) }}
          </span>
          <span v-else class="text-muted">--</span>
        </template>
      </el-table-column>

      <el-table-column
        label="开仓时间"
        width="95"
        align="center"
        prop="openTime"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatTime(row.openTime) }}
        </template>
      </el-table-column>

      <el-table-column
        label="平仓时间"
        width="95"
        align="center"
        prop="closeTime"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatTime(row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column
        label="持仓"
        min-width="98"
        align="center"
        prop="holdingMinutes"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatHoldingTime(row.openTime, row.closeTime) }}
        </template>
      </el-table-column>

      <el-table-column label="原因" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            :type="getCloseCategoryType(row.closeCategory)"
            size="small"
            class="close-category-tag"
            @click="toggleExpand(row as TradeHistory)"
          >
            <span class="tag-text">{{ getCloseCategoryLabel(row.closeCategory) }}</span>
            <el-icon class="tag-icon">
              <ElIconArrowRight />
            </el-icon>
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        hide-on-single-page
        :page-size="pageSize"
        :total="total"
        :pager-count="5"
        layout="prev, pager, next, total"
        background
        size="small"
        @current-change="handlePageChange"
      />
    </div>
  </component>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import type { TradeHistory } from '../../types'
import SupportResistanceInfo from './SupportResistanceInfo.vue'
import { useTradeHistoryStore, type FilterConfig } from '../stores/tradeHistory'
import { formatTradePrice } from './kline-chart/utils/kline-formatters'

const tradeHistoryStore = useTradeHistoryStore()

const props = defineProps<{
  modelValue: boolean
  /** 页面内嵌模式使用窄栏订单卡片，不打开抽屉。 */
  embedded?: boolean
  selectedId?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select-symbol', symbol: string, mainTimeframe?: string): void
  (event: 'select-order', order: TradeHistory): void
}>()

// 页面内嵌时保持加载；抽屉兼容模式仍向父组件同步显隐。
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** 使用历史订单保存的入场主周期定位图表；旧记录缺失周期时保留图表当前周期。 */
function selectChart(symbol: string, mainTimeframe?: string) {
  emit('select-symbol', symbol, mainTimeframe)
  visible.value = false
}

const orders = ref<TradeHistory[]>([])
const currentPage = ref(1)
const pageSize = ref(15)
const total = ref(0)
const totalPages = ref(0)
const loading = ref(false)
const showFilter = ref(false)

// 表格实例引用
const tableRef = ref<any>(null)

// 切换展开/折叠（使用 el-table 的 toggleRowExpansion）
const toggleExpand = (row: TradeHistory) => {
  if (tableRef.value) {
    tableRef.value.toggleRowExpansion(row)
  }
}

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

// 本地筛选条件（与 store 同步）

const filter = reactive<FilterConfig>({
  symbol: '',
  direction: '',
  strategyId: '',
  closeCategory: '',
  pnlMin: undefined,
  pnlMax: undefined,
  scoreMin: undefined,
  scoreMax: undefined,
  confidenceMin: undefined,
  confidenceMax: undefined,
  oiMin: undefined,
  oiMax: undefined,
  estimatedVolumeMin: undefined,
  estimatedVolumeMax: undefined,
})

// 加载当前页，服务端返回全部筛选结果的汇总。
let historyRequest = 0
const loadHistory = async () => {
  const request = ++historyRequest
  loading.value = true
  try {
    const response = await tradeHistoryStore.fetchPage(currentPage.value, pageSize.value)
    if (!response || request !== historyRequest) return
    orders.value = response.data
    // 首次打开自动展示最新订单，轮询、分页和排序不覆盖用户已经选中的复盘。
    if (props.embedded && !props.selectedId && orders.value[0]) {
      emit('select-order', orders.value[0])
    }
    total.value = response.pagination.total
    totalPages.value = response.pagination.totalPages
    currentPage.value = response.pagination.page
  } catch (error) {
    console.error('加载历史订单失败:', error)
  } finally {
    if (request === historyRequest) loading.value = false
  }
}
const refreshHistory = () => loadHistory()

// 筛选条件变更
const handleFilterChange = () => {
  tradeHistoryStore.setFilter({ ...filter })
  currentPage.value = 1
  loadHistory()
}

// 重置筛选
const handleResetFilter = () => {
  filter.symbol = ''
  filter.direction = ''
  filter.strategyId = ''
  filter.closeCategory = ''
  filter.pnlMin = undefined
  filter.pnlMax = undefined
  filter.scoreMin = undefined
  filter.scoreMax = undefined
  filter.confidenceMin = undefined
  filter.confidenceMax = undefined
  filter.oiMin = undefined
  filter.oiMax = undefined
  filter.estimatedVolumeMin = undefined
  filter.estimatedVolumeMax = undefined
  tradeHistoryStore.resetFilter()
  currentPage.value = 1
  loadHistory()
}

// 排序变更
const handleSortChange = (data: { prop: string | null; order: 'ascending' | 'descending' | null }) => {
  if (data.prop && data.order) {
    tradeHistoryStore.setSort(
      data.prop as Parameters<typeof tradeHistoryStore.setSort>[0],
      data.order === 'ascending' ? 'asc' : 'desc'
    )
  }
  currentPage.value = 1
  loadHistory()
}

// 分页切换
const handlePageChange = (page: number) => {
  currentPage.value = page
  loadHistory()
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

/** 持仓时长最多使用小时单位，跨天仍累计小时，方便直接比较订单。 */
function formatHoldingTime(openTime: number, closeTime: number): string {
  if (!openTime || !closeTime) return '--'
  const diffMs = closeTime - openTime
  if (diffMs < 0) return '--'
  const totalMinutes = Math.floor(diffMs / 60000)
  if (totalMinutes < 60) return `${totalMinutes}分钟`
  const hours = Math.floor(totalMinutes / 60)
  const remainMinutes = totalMinutes % 60
  return remainMinutes > 0 ? `${hours}时 ${remainMinutes}分` : `${hours}时`
}

// 获取平仓分类标签
function getCloseCategoryLabel(category?: string): string {
  const labels: Record<string, string> = {
    stop_loss: '止损',
    take_profit: '止盈',
    timeout: '超时',
    manual: '手动',
    trailing_stop: '移止',
    unknown: '未知',
  }
  return category ? labels[category] || category : '--'
}

// OI变化率正负值样式
function getOiChangeClass(value: number | undefined): string {
  if (value == null || isNaN(value)) return ''
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-danger'
  return ''
}

/**
 * 格式化筛选汇总数值，统一保留两位小数并添加千位分隔符。
 */
function formatSummaryNumber(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// 获取平仓分类类型
function getCloseCategoryType(category?: string): 'primary' | 'danger' | 'success' | 'warning' | 'info' {
  const types: Record<string, 'primary' | 'danger' | 'success' | 'warning' | 'info'> = {
    stop_loss: 'danger',
    take_profit: 'success',
    timeout: 'warning',
    manual: 'info',
    trailing_stop: 'primary',
    unknown: 'info',
  }
  return category ? types[category] || 'info' : 'info'
}

// 轮询定时器
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 复盘页首次进入按最近平仓排序，保证默认图表对应最新一笔已完成订单。
  if (props.embedded) tradeHistoryStore.setSort('closeTime', 'desc')
  // 抽屉打开后才加载和轮询，避免页面隐藏时持续传输历史数据。
  if (visible.value) {
    loadHistory()
    pollTimer = setInterval(loadHistory, 30000)
  }
})

watch(visible, (isVisible) => {
  if (isVisible) {
    void loadHistory()
    if (!pollTimer) pollTimer = setInterval(loadHistory, 30000)
  } else if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped>
.embedded-header { margin-bottom: 16px; font-size: 15px !important; }
.compact-orders-table :deep(.el-table__row) { cursor: pointer; }
.compact-orders-table :deep(.el-table__cell) { padding: 5px 0; }
.compact-orders-table :deep(.cell) { padding: 0 6px; white-space: nowrap; font-size: 12px; }
.compact-orders-table :deep(.current-row > .el-table__cell) { background: var(--el-color-primary-light-9) !important; }
/* 只隐藏纵向条及重复的原生条；横向溢出时必须保留可拖动入口，避免右侧列像被裁掉。 */
.is-embedded :deep(.el-scrollbar__bar.is-vertical) { display: none; }
.compact-orders-table :deep(.el-scrollbar__bar.is-horizontal) { height: 6px; }
.is-embedded :deep(.el-scrollbar__wrap),
.is-embedded .pagination-wrapper { scrollbar-width: none; }
.is-embedded :deep(.el-scrollbar__wrap)::-webkit-scrollbar,
.is-embedded .pagination-wrapper::-webkit-scrollbar { display: none; width: 0; height: 0; }
.history-drawer :deep(.filter-row) { flex-wrap: wrap; }
.is-embedded .history-summary { flex-wrap: wrap; gap: 8px; padding: 8px; }
.is-embedded .summary-divider { display: none; }
.is-embedded .pagination-wrapper { overflow-x: auto; justify-content: flex-start; }
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 18px;
  font-weight: 600;
}

.header-actions {
  gap: 8px;
}

.filter-bar {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}

/* 旧表格通过原因标签展开详情；隐藏箭头的兼容规则不能影响复盘表格。 */
.history-detail-table :deep(.el-table__expand-icon) {
  display: none !important;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 10px;
  align-items: center;
}

.range-filter-row {
  margin-top: 10px;
  column-gap: 28px;
  row-gap: 14px;
}

.range-input {
  width: 78px;
}

:deep(.range-input .el-input__inner) {
  text-align: center;
}

.range-separator,
.range-unit {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.history-summary {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 38px;
  padding: 0 12px;
  margin-top: 10px;
  border: 1px solid var(--border-color);
  background: var(--table-header-bg);
  font-size: 14px;
}

.summary-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.summary-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.summary-value {
  color: var(--text-primary);
  font-weight: 600;
}

.summary-value small {
  color: var(--text-secondary);
  font-weight: 400;
}

.summary-divider {
  width: 1px;
  height: 18px;
  background: var(--border-color);
}

.filter-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  min-height: 28px;
}

.filter-label {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  align-self: stretch;
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--text-regular);
  line-height: 1;
  text-align: right;
  white-space: nowrap;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: var(--text-secondary);
  gap: 12px;
}

.loading-icon {
  font-size: 32px;
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-icon {
  font-size: 48px;
  color: var(--text-placeholder);
}

.symbol {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 13px;
}

.symbol-link { padding: 0; border: 0; background: transparent; font-family: inherit; cursor: pointer; text-align: left; }
.symbol-link:hover { color: var(--el-color-primary); }
.symbol-link:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 3px; }

.text-success,
.text-warning,
.text-danger,
.text-info {
  font-weight: 600;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

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

/* 平仓原因标签 - 文字和图标同行 */
.close-category-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}

.close-category-tag .tag-text {
  line-height: 1;
}

.close-category-tag .tag-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 1px;
}

@media (max-width: 768px) {
  :global(.history-drawer) {
    width: 100% !important;
  }

  .card-header {
    font-size: 16px;
  }
}
</style>
