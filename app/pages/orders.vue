<!-- ==================== 订单复盘页面：共用首页导航与等宽复盘布局 ==================== -->
<template>
  <div class="orders-page">
    <main class="orders-main">
    <ClientOnly>
      <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
      <el-row v-if="passwordVerified" :gutter="20" class="orders-layout">
        <el-col :xs="24" :sm="24" :md="13" class="orders-sidebar">
          <TradeHistory :model-value="true" embedded :selected-id="selectedOrder?.id" @select-order="selectOrder" />
        </el-col>
        <el-col :xs="24" :sm="24" :md="11" class="orders-chart">
          <template v-if="selectedOrder">
            <div class="order-summary">
              <div class="order-summary-row">
                <span>{{ selectedOrder.reason || '--' }}</span>
                <span class="order-trade-times">
                  <span>开仓：{{ new Date(selectedOrder.openTime).toLocaleString('zh-CN') }}</span>
                  <span>平仓：{{ selectedOrder.closeTime ? new Date(selectedOrder.closeTime).toLocaleString('zh-CN') : '--' }}</span>
                </span>
              </div>
            </div>
            <KLineChartSimple :key="selectedOrder.id" :symbol="selectedOrder.symbol" :timeframe="orderTimeframe" :historical-order="selectedOrder" :height="410" />
            <TradeOrderDetail :row="selectedOrder" compact :show-structure="false" />
          </template>
          <el-empty v-else description="点击左侧订单，查看开仓位置和入场支撑阻力" />
        </el-col>
      </el-row>
      <el-empty v-else description="解锁后查看订单复盘">
        <el-button type="primary" @click="handleUnlock">解锁订单</el-button>
      </el-empty>
    </ClientOnly>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import type { TradeHistory as HistoricalOrder } from '../../types'
import { useBotStore } from '../stores/bot'
import TradeHistory from '../components/TradeHistory.vue'
import TradeOrderDetail from '../components/TradeOrderDetail.vue'
import KLineChartSimple from '../components/kline-chart/KLineChartSimple.vue'
import PasswordDialog from '../components/PasswordDialog.vue'
import { usePageUnlock } from '../composables/usePageUnlock'
import { formatTradePrice } from '../components/kline-chart/utils/kline-formatters'

const selectedOrder = ref<HistoricalOrder | null>(null)
const botStore = useBotStore()
// 快照周期是旧订单的可靠回退来源，缺失时使用现有图表默认的 1h。
const orderTimeframe = computed(() => selectedOrder.value?.mainTimeframe || selectedOrder.value?.entrySupportResistance?.timeframe || '1h')
const { passwordVerified, showPasswordDialog, handleUnlock, handlePasswordSuccess } = usePageUnlock({
  onOpen: () => {},
  onLock: () => { selectedOrder.value = null }
})

// 直接访问订单页时也加载真实运行状态，供共用头部和图表配置使用。
onMounted(() => { void botStore.fetchStatus() })

/** 保留整笔订单快照，由现有图表负责入场标记和支撑阻力绘制。 */
function selectOrder(order: HistoricalOrder) {
  selectedOrder.value = order
}
</script>

<style scoped>
.orders-page {
  /* AppFooter 在文档流中另占一行，页面需扣除其高度，避免空白区域撑出整页滚动。 */
  min-height: calc(100vh - var(--app-footer-height, 27px) - var(--app-header-height, 60px));
  min-height: calc(100dvh - var(--app-footer-height, 27px) - var(--app-header-height, 60px));
  box-sizing: border-box;
  background: var(--bg-main);
}
.orders-main { padding: 20px; }
.orders-sidebar, .orders-chart { min-width: 0; }
.orders-sidebar { max-height: calc(100dvh - 100px - var(--app-footer-height, 27px)); overflow-y: auto; scrollbar-width: none; }
.orders-sidebar::-webkit-scrollbar { display: none; width: 0; height: 0; }
.order-summary { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; font-size: 13px; color: var(--text-regular); }
.order-summary-row { display: flex; flex-wrap: wrap; gap: 8px 20px; overflow-wrap: anywhere; line-height: 1.5; }
.order-trade-times { display: inline-flex; flex-wrap: nowrap; gap: 20px; max-width: 100%; overflow-x: auto; white-space: nowrap; }
@media (max-width: 991px) {
  .orders-main { padding: 12px; }
  .orders-sidebar { max-height: 35dvh; margin-bottom: 20px; }
}
</style>
