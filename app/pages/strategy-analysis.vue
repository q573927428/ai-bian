<template>
  <div class="strategy-analysis-page">
    <div class="header">
      <h1>策略分析仪表板</h1>
      <p class="subtitle">交易策略性能分析与优化</p>
    </div>

    <!-- 筛选控制 -->
    <div class="filters">
      <div class="filter-group">
        <label>交易对:</label>
        <select v-model="filters.symbol" @change="loadData">
          <option value="">全部</option>
          <option v-for="symbol in availableSymbols" :key="symbol" :value="symbol">{{ symbol }}</option>
        </select>
      </div>
      
      <div class="filter-group">
        <label>方向:</label>
        <select v-model="filters.direction" @change="loadData">
          <option value="">全部</option>
          <option value="LONG">做多</option>
          <option value="SHORT">做空</option>
        </select>
      </div>
      
      <div class="filter-group">
        <label>退出原因:</label>
        <select v-model="filters.exitReason" @change="loadData">
          <option value="">全部</option>
          <option v-for="reason in availableExitReasons" :key="reason" :value="reason">{{ reason }}</option>
        </select>
      </div>
      
      <div class="filter-group">
        <label>时间范围:</label>
        <select v-model="filters.timeRange" @change="loadData">
          <option value="all">全部</option>
          <option value="today">今日</option>
          <option value="week">本周</option>
          <option value="month">本月</option>
        </select>
      </div>
      
      <div class="filter-group">
        <button @click="exportData" class="export-btn">
          <span>📊 导出数据</span>
        </button>
      </div>
    </div>

    <!-- 统计数据概览 -->
    <div class="stats-overview" v-if="stats">
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalTrades }}</div>
        <div class="stat-label">总交易次数</div>
      </div>
      
      <div class="stat-card" :class="{ 'positive': stats.totalPnL > 0, 'negative': stats.totalPnL < 0 }">
        <div class="stat-value">{{ stats.totalPnL.toFixed(2) }} USDT</div>
        <div class="stat-label">总盈亏</div>
      </div>
      
      <div class="stat-card" :class="{ 'good': stats.winRate > 50, 'bad': stats.winRate < 40 }">
        <div class="stat-value">{{ stats.winRate.toFixed(1) }}%</div>
        <div class="stat-label">胜率</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-value">{{ stats.avgRiskRewardRatio.toFixed(2) }}</div>
        <div class="stat-label">平均风险回报比</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-value">{{ stats.avgMFE.toFixed(2) }}</div>
        <div class="stat-label">平均MFE</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-value">{{ stats.avgMAE.toFixed(2) }}</div>
        <div class="stat-label">平均MAE</div>
      </div>
    </div>

    <!-- 退出原因分析 -->
    <div class="section" v-if="exitReasonStats">
      <h2>退出原因分析</h2>
      <div class="exit-reason-chart">
        <div v-for="(stat, reason) in exitReasonStats" :key="reason" class="reason-bar">
          <div class="reason-label">{{ reason }}</div>
          <div class="reason-bar-container">
            <div class="reason-bar-fill" :style="{ width: (stat.count / maxExitReasonCount * 100) + '%' }">
              <span class="reason-count">{{ stat.count }} 次</span>
            </div>
          </div>
          <div class="reason-stats">
            <span class="pnl" :class="{ 'positive': stat.totalPnL > 0, 'negative': stat.totalPnL < 0 }">
              {{ stat.totalPnL.toFixed(2) }} USDT
            </span>
            <span class="win-rate">胜率: {{ stat.winRate.toFixed(1) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 交易对分析 -->
    <div class="section" v-if="symbolStats">
      <h2>交易对表现</h2>
      <div class="symbols-table">
        <table>
          <thead>
            <tr>
              <th>交易对</th>
              <th>交易次数</th>
              <th>总盈亏</th>
              <th>平均盈亏</th>
              <th>胜率</th>
              <th>做多次数</th>
              <th>做空次数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(stat, symbol) in symbolStats" :key="symbol">
              <td>{{ symbol }}</td>
              <td>{{ stat.count }}</td>
              <td :class="{ 'positive': stat.totalPnL > 0, 'negative': stat.totalPnL < 0 }">
                {{ stat.totalPnL.toFixed(2) }} USDT
              </td>
              <td :class="{ 'positive': stat.avgPnL > 0, 'negative': stat.avgPnL < 0 }">
                {{ stat.avgPnL.toFixed(2) }} USDT
              </td>
              <td :class="{ 'good': stat.winRate > 50, 'bad': stat.winRate < 40 }">
                {{ stat.winRate.toFixed(1) }}%
              </td>
              <td>{{ stat.longCount }}</td>
              <td>{{ stat.shortCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 详细交易记录 -->
    <div class="section">
      <h2>详细交易记录</h2>
      
      <!-- 表格控制栏 -->
      <div class="table-controls">
        <div class="pagination-controls">
          <button @click="prevPage" :disabled="pagination.page === 1">上一页</button>
          <span>第 {{ pagination.page }} 页 / 共 {{ pagination.totalPages }} 页 ({{ pagination.total }} 条记录)</span>
          <button @click="nextPage" :disabled="pagination.page === pagination.totalPages">下一页</button>
        </div>
        
        <div class="table-actions">
          <div class="page-size-selector">
            <label>每页显示:</label>
            <select v-model="pagination.pageSize" @change="changePageSize">
              <option value="10">10条</option>
              <option value="20">20条</option>
              <option value="50">50条</option>
              <option value="100">100条</option>
            </select>
          </div>
          
          <div class="sort-controls">
            <label>排序:</label>
            <select v-model="sortBy" @change="applySorting">
              <option value="closeTime">出场时间</option>
              <option value="pnl">盈亏金额</option>
              <option value="pnlPercentage">盈亏百分比</option>
              <option value="riskRewardRatio">风险回报比</option>
              <option value="aiConfidence">AI置信度</option>
            </select>
            <select v-model="sortOrder" @change="applySorting">
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </div>
        </div>
      </div>
      
      <!-- 交易记录表格 -->
      <div class="trades-table-container">
        <div class="trades-table">
          <table>
            <thead>
              <tr>
                <th class="expand-col"></th>
                <th @click="sortByColumn('tradeId')" class="sortable">
                  交易ID
                  <span v-if="sortBy === 'tradeId'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('symbol')" class="sortable">
                  交易对
                  <span v-if="sortBy === 'symbol'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('direction')" class="sortable">
                  方向
                  <span v-if="sortBy === 'direction'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('openTime')" class="sortable">
                  入场时间
                  <span v-if="sortBy === 'openTime'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('closeTime')" class="sortable">
                  出场时间
                  <span v-if="sortBy === 'closeTime'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('duration')" class="sortable">
                  持仓时长
                  <span v-if="sortBy === 'duration'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('pnl')" class="sortable">
                  盈亏(USDT)
                  <span v-if="sortBy === 'pnl'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('pnlPercentage')" class="sortable">
                  盈亏%
                  <span v-if="sortBy === 'pnlPercentage'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('entryPrice')" class="sortable">
                  入场价
                  <span v-if="sortBy === 'entryPrice'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('exitPrice')" class="sortable">
                  出场价
                  <span v-if="sortBy === 'exitPrice'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('positionSizePercentage')" class="sortable">
                  仓位%
                  <span v-if="sortBy === 'positionSizePercentage'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('actualLeverage')" class="sortable">
                  杠杆
                  <span v-if="sortBy === 'actualLeverage'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('aiConfidence')" class="sortable">
                  AI置信度
                  <span v-if="sortBy === 'aiConfidence'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
                <th @click="sortByColumn('exitReason')" class="sortable">
                  退出原因
                  <span v-if="sortBy === 'exitReason'" class="sort-indicator">
                    {{ sortOrder === 'asc' ? '↑' : '↓' }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="trade in sortedTrades" :key="trade.tradeId">
                <tr @click="toggleTradeDetails(trade.tradeId)" class="trade-row" :class="{ 'expanded': expandedTrades[trade.tradeId] }">
                  <td class="expand-col">
                    <span class="expand-icon">{{ expandedTrades[trade.tradeId] ? '−' : '+' }}</span>
                  </td>
                  <td class="trade-id">{{ trade.tradeId.substring(0, 8) }}...</td>
                  <td>{{ trade.symbol }}</td>
                  <td :class="{ 'long': trade.direction === 'LONG', 'short': trade.direction === 'SHORT' }">
                    <span class="direction-badge">{{ trade.direction === 'LONG' ? '做多' : '做空' }}</span>
                  </td>
                  <td>{{ formatDate(trade.openTime) }}</td>
                  <td>{{ formatDate(trade.closeTime) }}</td>
                  <td>{{ formatDuration(trade.duration) }}</td>
                  <td :class="{ 'positive': trade.pnl > 0, 'negative': trade.pnl < 0 }">
                    <span class="pnl-value">{{ trade.pnl.toFixed(2) }} USDT</span>
                  </td>
                  <td :class="{ 'positive': trade.pnlPercentage > 0, 'negative': trade.pnlPercentage < 0 }">
                    {{ trade.pnlPercentage.toFixed(2) }}%
                  </td>
                  <td>{{ trade.entryPrice.toFixed(2) }}</td>
                  <td>{{ trade.exitPrice.toFixed(2) }}</td>
                  <td>{{ trade.positionSizePercentage.toFixed(2) }}%</td>
                  <td>{{ trade.actualLeverage }}x</td>
                  <td>
                    <div class="confidence-indicator" :class="getConfidenceClass(trade.aiConfidence)">
                      {{ trade.aiConfidence || 0 }}
                    </div>
                  </td>
                  <td :class="getExitReasonClass(trade.exitReasonCategory)">
                    <span class="exit-reason-badge">{{ trade.exitReason }}</span>
                  </td>
                </tr>
                
                <!-- 展开的详细信息 -->
                <tr v-if="expandedTrades[trade.tradeId]" class="trade-details-row">
                  <td colspan="15">
                    <div class="trade-details">
                      <div class="details-grid">
                        <!-- 价格信息 -->
                        <div class="details-section">
                          <h4>价格信息</h4>
                          <div class="details-content">
                            <div class="detail-item">
                              <span class="detail-label">入场价格:</span>
                              <span class="detail-value">{{ trade.entryPrice.toFixed(2) }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场价格:</span>
                              <span class="detail-value">{{ trade.exitPrice.toFixed(2) }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">止损价格:</span>
                              <span class="detail-value">{{ trade.stopLossPrice?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">止盈1价格:</span>
                              <span class="detail-value">{{ trade.takeProfit1Price?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">止盈2价格:</span>
                              <span class="detail-value">{{ trade.takeProfit2Price?.toFixed(2) || 'N/A' }}</span>
                            </div>
                          </div>
                        </div>
                        
                        <!-- 风险指标 -->
                        <div class="details-section">
                          <h4>风险指标</h4>
                          <div class="details-content">
                            <div class="detail-item">
                              <span class="detail-label">MFE:</span>
                              <span class="detail-value" :class="{ 'positive': trade.mfe > 0, 'negative': trade.mfe < 0 }">
                                {{ trade.mfe.toFixed(2) }} ({{ trade.mfePercentage?.toFixed(2) || 0 }}%)
                              </span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">MAE:</span>
                              <span class="detail-value" :class="{ 'positive': trade.mae > 0, 'negative': trade.mae < 0 }">
                                {{ trade.mae.toFixed(2) }} ({{ trade.maePercentage?.toFixed(2) || 0 }}%)
                              </span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">风险回报比:</span>
                              <span class="detail-value">{{ trade.riskRewardRatio.toFixed(2) }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">最大回撤:</span>
                              <span class="detail-value negative">{{ trade.maxDrawdownPercentage?.toFixed(2) || 0 }}%</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">平均ATR:</span>
                              <span class="detail-value">{{ trade.averageATR?.toFixed(2) || 'N/A' }}</span>
                            </div>
                          </div>
                        </div>
                        
                        <!-- AI分析 -->
                        <div class="details-section ai-analysis">
                          <h4>AI分析</h4>
                          <div class="details-content">
                            <div class="ai-stats">
                              <div class="ai-stat">
                                <span class="ai-stat-label">置信度:</span>
                                <span class="ai-stat-value" :class="getConfidenceClass(trade.aiConfidence)">
                                  {{ trade.aiConfidence || 0 }}
                                </span>
                              </div>
                              <div class="ai-stat">
                                <span class="ai-stat-label">评分:</span>
                                <span class="ai-stat-value">{{ trade.aiScore || 0 }}</span>
                              </div>
                              <div class="ai-stat">
                                <span class="ai-stat-label">风险等级:</span>
                                <span class="ai-stat-value" :class="getRiskLevelClass(trade.aiRiskLevel)">
                                  {{ trade.aiRiskLevel || 'N/A' }}
                                </span>
                              </div>
                            </div>
                            
                            <div v-if="trade.aiKeyFactors && trade.aiKeyFactors.length > 0" class="ai-key-factors">
                              <h5>关键因素:</h5>
                              <div class="factors-list">
                                <span v-for="factor in trade.aiKeyFactors" :key="factor" class="factor-badge">
                                  {{ factor }}
                                </span>
                              </div>
                            </div>
                            
                            <div v-if="trade.aiReasoning" class="ai-reasoning">
                              <h5>AI推理:</h5>
                              <div class="reasoning-text">{{ trade.aiReasoning }}</div>
                            </div>
                          </div>
                        </div>
                        
                        <!-- 移动止损信息 -->
                        <div class="details-section" v-if="trade.trailingStopEnabled !== undefined">
                          <h4>移动止损</h4>
                          <div class="details-content">
                            <div class="detail-item">
                              <span class="detail-label">启用状态:</span>
                              <span class="detail-value">{{ trade.trailingStopEnabled ? '已启用' : '未启用' }}</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled" class="detail-item">
                              <span class="detail-label">激活盈亏比:</span>
                              <span class="detail-value">{{ trade.trailingStopActivationRatio?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled" class="detail-item">
                              <span class="detail-label">跟踪距离(ATR倍数):</span>
                              <span class="detail-value">{{ trade.trailingStopDistance?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled" class="detail-item">
                              <span class="detail-label">最小移动幅度(%):</span>
                              <span class="detail-value">{{ trade.trailingStopMinMovePercent?.toFixed(3) || 'N/A' }}</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled && trade.trailingStopCount" class="detail-item">
                              <span class="detail-label">移动止损次数:</span>
                              <span class="detail-value">{{ trade.trailingStopCount }} 次</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled && trade.lastTrailingStopPrice" class="detail-item">
                              <span class="detail-label">最后移动止损价:</span>
                              <span class="detail-value">{{ trade.lastTrailingStopPrice.toFixed(2) }}</span>
                            </div>
                            <div v-if="trade.trailingStopEnabled && trade.lastTrailingStopUpdateTime" class="detail-item">
                              <span class="detail-label">最后更新时间:</span>
                              <span class="detail-value">{{ formatDate(trade.lastTrailingStopUpdateTime) }}</span>
                            </div>
                          </div>
                        </div>
                        
                        <!-- 技术指标 -->
                        <div class="details-section">
                          <h4>技术指标</h4>
                          <div class="details-content">
                            <div class="detail-item">
                              <span class="detail-label">入场RSI:</span>
                              <span class="detail-value">{{ trade.entryRSI?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">入场ADX(15m):</span>
                              <span class="detail-value">{{ trade.entryADX15m?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">入场ADX(1h):</span>
                              <span class="detail-value">{{ trade.entryADX1h?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">入场ADX(4h):</span>
                              <span class="detail-value">{{ trade.entryADX4h?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">入场EMA20:</span>
                              <span class="detail-value">{{ trade.entryEMA20?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">入场EMA60:</span>
                              <span class="detail-value">{{ trade.entryEMA60?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场RSI:</span>
                              <span class="detail-value">{{ trade.exitRSI?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场ADX(15m):</span>
                              <span class="detail-value">{{ trade.exitADX15m?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场ADX(1h):</span>
                              <span class="detail-value">{{ trade.exitADX1h?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场ADX(4h):</span>
                              <span class="detail-value">{{ trade.exitADX4h?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场EMA20:</span>
                              <span class="detail-value">{{ trade.exitEMA20?.toFixed(2) || 'N/A' }}</span>
                            </div>
                            <div class="detail-item">
                              <span class="detail-label">出场EMA60:</span>
                              <span class="detail-value">{{ trade.exitEMA60?.toFixed(2) || 'N/A' }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface StrategyAnalysisMetrics {
  tradeId: string
  symbol: string
  direction: 'LONG' | 'SHORT'
  openTime: number
  closeTime: number
  duration: number
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPercentage: number
  mfe: number
  mfePercentage: number
  mae: number
  maePercentage: number
  riskAmount: number
  rewardAmount: number
  riskRewardRatio: number
  exitReason: string
  exitReasonCategory: string
  [key: string]: any
}

interface Stats {
  totalTrades: number
  totalPnL: number
  winRate: number
  avgRiskRewardRatio: number
  avgMFE: number
  avgMAE: number
  avgDuration: number
  avgPositionSize: number
}

interface ExitReasonStat {
  count: number
  totalPnL: number
  avgPnL: number
  winRate: number
}

interface SymbolStat {
  count: number
  totalPnL: number
  avgPnL: number
  winRate: number
  longCount: number
  shortCount: number
}

// 响应式数据
const loading = ref(false)
const trades = ref<StrategyAnalysisMetrics[]>([])
const stats = ref<Stats | null>(null)
const exitReasonStats = ref<Record<string, ExitReasonStat> | null>(null)
const symbolStats = ref<Record<string, SymbolStat> | null>(null)
const availableSymbols = ref<string[]>([])
const availableExitReasons = ref<string[]>([])

// 筛选条件
const filters = ref({
  symbol: '',
  direction: '',
  exitReason: '',
  timeRange: 'all'
})

// 分页
const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPrevPage: false
})

// 排序
const sortBy = ref('closeTime')
const sortOrder = ref('desc')

// 展开的交易详情
const expandedTrades = ref<Record<string, boolean>>({})

// 计算最大退出原因数量（用于图表）
const maxExitReasonCount = computed(() => {
  if (!exitReasonStats.value) return 0
  return Math.max(...Object.values(exitReasonStats.value).map(stat => stat.count))
})

// 加载数据
async function loadData() {
  try {
    loading.value = true
    
    // 构建查询参数
    const params = new URLSearchParams()
    if (filters.value.symbol) params.append('symbol', filters.value.symbol)
    if (filters.value.direction) params.append('direction', filters.value.direction)
    if (filters.value.exitReason) params.append('exitReason', filters.value.exitReason)
    if (filters.value.timeRange === 'today') params.append('today', 'true')
    params.append('page', pagination.value.page.toString())
    params.append('pageSize', pagination.value.pageSize.toString())
    
    const response = await fetch(`/api/analysis/metrics?${params}`)
    const result = await response.json()
    
    if (result.success) {
      trades.value = result.data.metrics
      stats.value = result.data.stats
      exitReasonStats.value = result.data.exitReasonStats
      symbolStats.value = result.data.symbolStats
      pagination.value = result.data.pagination
      
      // 提取可用的交易对和退出原因
      updateAvailableFilters()
    }
  } catch (error) {
    console.error('加载策略分析数据失败:', error)
  } finally {
    loading.value = false
  }
}

// 更新可用的筛选选项
function updateAvailableFilters() {
  // 从交易记录中提取唯一的交易对
  const symbols = new Set<string>()
  trades.value.forEach(trade => symbols.add(trade.symbol))
  availableSymbols.value = Array.from(symbols).sort()
  
  // 从退出原因统计中提取退出原因
  if (exitReasonStats.value) {
    availableExitReasons.value = Object.keys(exitReasonStats.value).sort()
  }
}

// 导出数据
function exportData() {
  const params = new URLSearchParams()
  if (filters.value.symbol) params.append('symbol', filters.value.symbol)
  if (filters.value.direction) params.append('direction', filters.value.direction)
  
  window.open(`/api/analysis/export?${params}`, '_blank')
}

// 分页控制
function nextPage() {
  if (pagination.value.page < pagination.value.totalPages) {
    pagination.value.page++
    loadData()
  }
}

function prevPage() {
  if (pagination.value.page > 1) {
    pagination.value.page--
    loadData()
  }
}

// 工具函数
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

function getExitReasonClass(category: string): string {
  switch (category) {
    case 'TP1':
    case 'TP2':
      return 'exit-tp'
    case 'STOP_LOSS':
      return 'exit-sl'
    case 'TRAILING_STOP':
      return 'exit-ts'
    default:
      return 'exit-other'
  }
}

// 计算排序后的交易记录
const sortedTrades = computed(() => {
  const tradesArray = [...trades.value]
  
  return tradesArray.sort((a, b) => {
    let aValue = a[sortBy.value]
    let bValue = b[sortBy.value]
    
    // 处理可能不存在的字段
    if (aValue === undefined || aValue === null) aValue = 0
    if (bValue === undefined || bValue === null) bValue = 0
    
    // 处理字符串比较
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder.value === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }
    
    // 处理数字比较
    return sortOrder.value === 'asc' 
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number)
  })
})

// 切换交易详情展开状态
function toggleTradeDetails(tradeId: string) {
  expandedTrades.value[tradeId] = !expandedTrades.value[tradeId]
}

// 按列排序
function sortByColumn(column: string) {
  if (sortBy.value === column) {
    // 如果已经是按此列排序，切换排序顺序
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    // 否则设置新的排序列和默认排序顺序
    sortBy.value = column
    sortOrder.value = 'desc'
  }
}

// 应用排序
function applySorting() {
  // 排序逻辑已经在 sortedTrades computed 属性中处理
  // 这里只需要触发重新计算
}

// 更改每页显示数量
function changePageSize() {
  pagination.value.page = 1 // 重置到第一页
  loadData()
}

// 获取置信度样式类
function getConfidenceClass(confidence: number): string {
  if (!confidence) return 'confidence-low'
  
  if (confidence >= 90) return 'confidence-high'
  if (confidence >= 70) return 'confidence-medium'
  return 'confidence-low'
}

// 获取风险等级样式类
function getRiskLevelClass(riskLevel: string): string {
  if (!riskLevel) return 'risk-unknown'
  
  switch (riskLevel.toUpperCase()) {
    case 'LOW':
      return 'risk-low'
    case 'MEDIUM':
      return 'risk-medium'
    case 'HIGH':
      return 'risk-high'
    default:
      return 'risk-unknown'
  }
}

// 初始化
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.strategy-analysis-page {
  padding: 20px;
  max-width: 1600px;
  margin: 0 auto;
}

.header {
  margin-bottom: 30px;
  text-align: center;
}

.header h1 {
  font-size: 2.5rem;
  color: #333;
  margin-bottom: 10px;
}

.subtitle {
  color: #666;
  font-size: 1.1rem;
}

.filters {
  display: flex;
  gap: 20px;
  margin-bottom: 30px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-group label {
  font-weight: 600;
  color: #555;
}

.filter-group select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  min-width: 120px;
}

.export-btn {
  padding: 10px 20px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.3s;
}

.export-btn:hover {
  background: #45a049;
}

.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  text-align: center;
  border-left: 4px solid #3498db;
}

.stat-card.positive {
  border-left-color: #2ecc71;
}

.stat-card.negative {
  border-left-color: #e74c3c;
}

.stat-card.good {
  border-left-color: #2ecc71;
}

.stat-card.bad {
  border-left-color: #e74c3c;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 0.9rem;
  color: #7f8c8d;
}

.section {
  background: white;
  padding: 25px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 30px;
}

.section h2 {
  color: #2c3e50;
  margin-bottom: 20px;
  font-size: 1.5rem;
}

.exit-reason-chart {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.reason-bar {
  display: flex;
  align-items: center;
  gap: 15px;
}

.reason-label {
  min-width: 120px;
  font-weight: 600;
  color: #555;
}

.reason-bar-container {
  flex: 1;
  height: 30px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
}

.reason-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3498db, #2980b9);
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding-left: 10px;
  transition: width 0.3s ease;
}

.reason-count {
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
}

.reason-stats {
  min-width: 200px;
  display: flex;
  gap: 15px;
  justify-content: flex-end;
}

.reason-stats .pnl {
  font-weight: 600;
}

.reason-stats .pnl.positive {
  color: #2ecc71;
}

.reason-stats .pnl.negative {
  color: #e74c3c;
}

.reason-stats .win-rate {
  color: #7f8c8d;
  font-size: 0.9rem;
}

.symbols-table table {
  width: 100%;
  border-collapse: collapse;
}

.symbols-table th,
.symbols-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.symbols-table th {
  background: #f8f9fa;
  font-weight: 600;
  color: #555;
}

.symbols-table tr:hover {
  background: #f9f9f9;
}

.positive {
  color: #2ecc71;
  font-weight: 600;
}

.negative {
  color: #e74c3c;
  font-weight: 600;
}

.good {
  color: #2ecc71;
}

.bad {
  color: #e74c3c;
}

.long {
  color: #2ecc71;
  font-weight: 600;
}

.short {
  color: #e74c3c;
  font-weight: 600;
}

.exit-tp {
  color: #2ecc71;
  font-weight: 600;
}

.exit-sl {
  color: #e74c3c;
  font-weight: 600;
}

.exit-ts {
  color: #3498db;
  font-weight: 600;
}

.exit-other {
  color: #7f8c8d;
}

.pagination-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.pagination-controls button {
  padding: 8px 16px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
}

.pagination-controls button:disabled {
  background: #bdc3c7;
  cursor: not-allowed;
}

.pagination-controls span {
  color: #555;
  font-weight: 600;
}

.trades-table {
  overflow-x: auto;
}

.trades-table table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1200px;
}

.trades-table th,
.trades-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.trades-table th {
  background: #f8f9fa;
  font-weight: 600;
  color: #555;
  position: sticky;
  top: 0;
}

.trades-table tr:hover {
  background: #f9f9f9;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading p {
  color: #555;
  font-size: 1.1rem;
}

/* 表格控制栏样式 */
.table-controls {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 20px;
}

.table-actions {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
}

.page-size-selector,
.sort-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-size-selector label,
.sort-controls label {
  font-weight: 600;
  color: #555;
}

.page-size-selector select,
.sort-controls select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  min-width: 100px;
}

/* 表格样式 */
.trades-table-container {
  overflow-x: auto;
  border: 1px solid #eee;
  border-radius: 8px;
}

.trades-table {
  min-width: 1400px;
}

.trades-table table {
  width: 100%;
  border-collapse: collapse;
}

.trades-table th,
.trades-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
}

.trades-table th {
  background: #f8f9fa;
  font-weight: 600;
  color: #555;
  position: sticky;
  top: 0;
  z-index: 10;
}

.trades-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.trades-table th.sortable:hover {
  background: #e9ecef;
}

.sort-indicator {
  margin-left: 5px;
  font-weight: bold;
  color: #3498db;
}

/* 交易行样式 */
.trade-row {
  cursor: pointer;
  transition: background 0.2s;
}

.trade-row:hover {
  background: #f8f9fa !important;
}

.trade-row.expanded {
  background: #f0f7ff;
}

.expand-col {
  width: 40px;
  text-align: center;
}

.expand-icon {
  display: inline-block;
  width: 20px;
  height: 20px;
  line-height: 18px;
  text-align: center;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: white;
  font-weight: bold;
  color: #555;
}

.trade-id {
  font-family: monospace;
  font-size: 0.9em;
  color: #666;
}

.direction-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 600;
}

.long .direction-badge {
  background: rgba(46, 204, 113, 0.1);
  color: #2ecc71;
}

.short .direction-badge {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
}

.pnl-value {
  font-weight: 600;
}

/* 置信度指示器 */
.confidence-indicator {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 600;
  text-align: center;
  min-width: 40px;
}

.confidence-high {
  background: rgba(46, 204, 113, 0.1);
  color: #2ecc71;
}

.confidence-medium {
  background: rgba(241, 196, 15, 0.1);
  color: #f1c40f;
}

.confidence-low {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
}

/* 退出原因徽章 */
.exit-reason-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 600;
}

/* 交易详情样式 */
.trade-details-row {
  background: #f8f9fa;
}

.trade-details {
  padding: 20px;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.details-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}

.details-section h4 {
  margin: 0;
  padding: 15px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
  color: #2c3e50;
  font-size: 1.1em;
}

.details-content {
  padding: 15px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f5f5f5;
}

.detail-item:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.detail-label {
  font-weight: 600;
  color: #555;
  min-width: 120px;
}

.detail-value {
  color: #333;
  text-align: right;
  flex: 1;
}

/* AI分析样式 */
.ai-analysis .details-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.ai-stats {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.ai-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ai-stat-label {
  font-size: 0.9em;
  color: #7f8c8d;
}

.ai-stat-value {
  font-weight: 600;
  font-size: 1.1em;
}

.risk-low {
  color: #2ecc71;
}

.risk-medium {
  color: #f1c40f;
}

.risk-high {
  color: #e74c3c;
}

.risk-unknown {
  color: #7f8c8d;
}

.ai-key-factors h5 {
  margin: 0 0 10px 0;
  color: #555;
  font-size: 1em;
}

.factors-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.factor-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(52, 152, 219, 0.1);
  color: #3498db;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.ai-reasoning h5 {
  margin: 0 0 10px 0;
  color: #555;
  font-size: 1em;
}

.reasoning-text {
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  font-size: 0.9em;
  line-height: 1.5;
  color: #555;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
}

@media (max-width: 768px) {
  .filters {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filter-group {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .stats-overview {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .reason-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .reason-stats {
    width: 100%;
    justify-content: space-between;
  }
  
  .table-actions {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .details-grid {
    grid-template-columns: 1fr;
  }
  
  .ai-stats {
    flex-direction: column;
    gap: 10px;
  }
}
</style>