<!-- ==================== 首页状态统计与管理入口 ==================== -->
<template>
  <el-card class="card" shadow="hover">
    <template #header>
      <div class="card-header">
        <span>🎛️ 状态面板</span>
        <div class="card-header-actions">
          <el-button v-if="!passwordVerified" type="primary" size="small" text @click="emit('unlock')">
            <el-icon><ElIconUnlock /></el-icon>
            解锁
          </el-button>
          <el-button v-if="passwordVerified && hasPassword" type="primary" size="small" text @click="emit('lock')">
            <el-icon><ElIconLock /></el-icon>
            锁定
          </el-button>
        </div>
      </div>
    </template>
    
    <div class="control-panel">
      <!-- 将常用入口放在控制面板正文内，避免标题栏操作过于拥挤。 -->
      <div class="control-panel-actions">
        <el-button class="control-panel-action" type="primary" size="small" text @click="emit('open', 'config')">
          <el-icon><ElIconSetting /></el-icon>
          配置
        </el-button>
        <el-button class="control-panel-action" type="primary" size="small" text @click="emit('open', 'strategies')">
          <el-icon><ElIconOperation /></el-icon>
          策略
        </el-button>
        <el-button class="control-panel-action" type="primary" size="small" text @click="emit('logs')">
          <el-icon><ElIconDocument /></el-icon>
          日志
        </el-button>
        <el-button class="control-panel-action" type="primary" size="small" text @click="emit('open', 'orders')">
          <el-icon><ElIconTickets /></el-icon>
          订单
        </el-button>
      </div>
      <!-- 余额信息 -->
      <div class="balance-card-large">
        <!-- 紧凑统计卡片 -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-label">📊 交易</div>
            <div class="stat-card-value">{{ totalTrades }} </div>
            <div class="stat-card-sub">今日 {{ todayTrades }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">💰 总盈亏</div>
            <div :class="['stat-card-value', totalPnLClass]">{{ formatPnLShort(totalPnL) }}</div>
            <div class="stat-card-sub">今日 <span :class="[pnlClass]">{{ formatPnLShort(dailyPnL) }}</span></div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">🎯 总胜率</div>
            <div class="stat-card-value">{{ formatWinRate(winRate) }}</div>
            <div class="stat-card-sub">总体</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">📈 年化</div>
            <div :class="['stat-card-value', annualizedReturnClass]">{{ formatAnnualizedReturn(annualizedReturn) }}</div>
            <div class="stat-card-sub">收益率</div>
          </div>
        </div>
          <div class="balance-details-large">
            <div class="balance-row-large">
              <span class="balance-label-large">💰 本金</span>
              <span class="balance-capital-large">$ {{ formatBalance(initialCapital) }}</span>
            </div>
            <div class="balance-row-large">
              <span class="balance-label-large">💵 总余额</span>
              <span class="balance-total-large">$ {{ formatBalance(usdtBalance?.total || 0) }}</span>
            </div>
            <div class="balance-row-large">
              <span class="balance-label-large">💎 可用</span>
              <span class="balance-free-large">$ {{ formatBalance(usdtBalance?.free || 0) }}</span>
            </div>
            <div class="balance-row-large">
              <span class="balance-label-large">🔐 锁定</span>
              <span class="balance-locked-large">$ {{ formatBalance(usdtBalance?.locked || 0) }}</span>
            </div>
          </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CryptoBalance } from '../../types'

/** 状态面板展示数据由首页计算，管理入口通过事件交给首页验证权限。 */
interface Props {
  passwordVerified: boolean
  hasPassword: boolean
  totalTrades: number
  todayTrades: number
  totalPnL: number
  dailyPnL: number
  winRate: number
  annualizedReturn: number
  initialCapital: number
  usdtBalance: CryptoBalance | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  unlock: []
  lock: []
  logs: []
  open: [panel: 'config' | 'strategies' | 'orders']
}>()
const pnlClass = computed(() => props.dailyPnL >= 0 ? 'text-success' : 'text-danger')
const totalPnLClass = computed(() => props.totalPnL >= 0 ? 'text-success' : 'text-danger')
const annualizedReturnClass = computed(() => props.annualizedReturn >= 0 ? 'text-success' : 'text-danger')

/** 盈亏统一保留正负号及两位小数。 */
function formatPnLShort(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

/** 胜率使用百分比展示并保留两位小数。 */
function formatWinRate(value: number): string {
  return `${value.toFixed(2)}%`
}

/** 小额余额保留更多精度，避免有效资产被显示为零。 */
function formatBalance(value: number): string {
  if (value === 0) return '0'
  
  // 根据数值大小格式化显示
  if (value < 0.001) {
    return value.toFixed(5)
  } else if (value < 1) {
    return value.toFixed(4)
  } else if (value < 1000) {
    return value.toFixed(2)
  } else {
    return value.toFixed(2)
  }
}

/** 年化异常值与正常数值保持原有展示格式。 */
function formatAnnualizedReturn(value: number): string {
  if (!isFinite(value)) {
    return value > 0 ? '> +999%' : '0.00%'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}
</script>

<style scoped>
.card {
  margin-bottom: 20px;
}

.card-header {
  font-weight: 600;
}

.card-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-panel {
  padding: 4px 0;
}

.control-panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  margin-top: -15px;
  background: var(--stat-card-bg);
  border-radius: 8px;
}

.control-panel-action {
  flex: 1;
  min-width: 0;
  height: 32px;
  margin: 0 !important;
  padding: 0 8px !important;
  border: 1px solid var(--el-border-color-lighter) !important;
  border-radius: 6px !important;
  background: var(--bg-card) !important;
  color: var(--text-regular) !important;
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.control-panel-action:hover {
  border-color: var(--el-color-primary) !important;
  background: var(--el-color-primary-light-9) !important;
  color: var(--el-color-primary) !important;
}

.control-panel-action :deep(.el-icon) {
  margin-right: 5px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.stat-card {
  background: var(--stat-card-bg);
  border: 1px solid var(--stat-card-border);
  border-radius: 10px;
  padding: 12px 4px;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-card:hover {
  box-shadow: var(--shadow-card);
  transform: translateY(-1px);
}

.stat-card-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 3px;
  white-space: nowrap;
}

.stat-card-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-card-sub {
  font-size: 12px;
  color: var(--text-placeholder);
  margin-top: 3px;
}
.balance-bar {
  display: flex;
  justify-content: space-between;
  background: var(--bg-main);
  border-radius: 4px;
  padding: 5px 6px;
  margin-top: 6px;
  font-size: 12px;
}

.balance-item {
  color: var(--text-regular);
}

.balance-label {
  color: var(--text-secondary);
}
.balance-card-large {
  background: var(--balance-card-bg);
  border: 1px solid var(--balance-card-border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: var(--shadow-card);
}

.balance-main-large {
  text-align: center;
  margin-bottom: 10px;
}

.balance-total-large {
  font-size: 14px;
  font-weight: 700;
  color: var(--balance-total-color);
}
.balance-usdt-large{
  font-size: 14px;
  color: var(--text-secondary);
  padding-left: 5px;
}

.balance-details-large {
  display: flex;
  justify-content: space-between;
  background: var(--balance-details-bg);
  border-radius: 6px;
  padding: 8px;
  margin-top: 10px;
}

.balance-row-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.balance-label-large {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.balance-free-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--balance-free-color);
}

.balance-capital-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.balance-locked-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--balance-locked-color);
}

@media (max-width: 768px) {
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
  }
  
  .stat-card {
    padding: 8px 3px;
  }
  
  .balance-bar {
    flex-wrap: wrap;
    gap: 3px;
    font-size: 9px;
  }
  
  .balance-card-large {
    padding: 10px;
  }

  .control-panel-actions {
    gap: 4px;
    padding: 5px;
  }

  .control-panel-action {
    padding: 0 5px !important;
  }
  
  
  .balance-details-large {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    padding: 6px;
  }

  .balance-row-large {
    flex: none;
  }
}
</style>
