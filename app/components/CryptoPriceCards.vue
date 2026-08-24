<template>
  <el-card class="price-cards-container" shadow="hover">
    <!-- <template #header>
      <div class="card-header">
        <span>📊 价格看板</span>
        <div class="header-actions">
          <el-button 
            text 
            type="primary" 
            size="small" 
            @click="refreshPrices"
            :loading="isLoading"
          >
            <el-icon><ElIconRefresh /></el-icon>
            刷新
          </el-button>
          <el-button 
            text 
            type="info" 
            size="small" 
            @click="showWebSocketStatus"
          >
            <el-icon><ElIconConnection /></el-icon>
            连接状态
          </el-button>
        </div>
      </div>
    </template> -->

    <!-- K线图表（引擎可切换：自研K线 / TradingView） -->
    <ClientOnly>
      <ChartEngineSwitcher
        :symbol="selectedSymbol || 'BTCUSDT'"
        @open-price-drawer="showPriceDrawer = true"
      />
    </ClientOnly>
    
    <!-- 水平线 -->
    <div class="horizontal-line"></div>

    <!-- WebSocket状态提示 -->
    <!-- <div v-if="!isWebSocketConnected" class="connection-warning">
      <el-alert
        title="WebSocket未连接"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #default>
          <span>价格数据可能不是实时的，正在尝试重新连接...</span>
        </template>
      </el-alert>
    </div> -->

    <!-- 价格列表抽屉：由 K 线控制栏中的交易对按钮打开 -->
    <el-drawer
      v-model="showPriceDrawer"
      title="选择交易对"
      direction="ltr"
      size="min(460px, 88vw)"
      append-to-body
      class="price-drawer"
    >
      <div class="cards-list">
      <div 
        v-for="crypto in cryptoPrices" 
        :key="crypto.symbol"
        class="price-card"
        :class="{ 'price-up': crypto.change24hPercent > 0, 'price-down': crypto.change24hPercent < 0 }"
        @click="openChartModal(crypto)"
      >
        <div class="price-card-header">
        <div class="crypto-info">
        <div class="crypto-symbol">
            <template v-if="!iconFailed[crypto.symbol] && cryptoIconUrl(crypto.symbol)">
              <img 
                :src="cryptoIconUrl(crypto.symbol)" 
                :alt="getSymbolDisplay(crypto.symbol)"
                class="crypto-icon"
                @error="onIconError(crypto.symbol)"
              />
            </template>
            <span v-else
              class="crypto-icon-placeholder"
              :style="{ backgroundColor: getRandomColor(crypto.symbol) }"
            >{{ getSymbolDisplay(crypto.symbol).substring(0, 1).toUpperCase() }}</span>
              {{ getSymbolDisplay(crypto.symbol) }}
            </div>
          </div>
          <div class="price-change" :class="crypto.change24hPercent >= 0 ? 'positive' : 'negative'">
            {{ formatPercent(crypto.change24hPercent) }}
          </div>
        </div>

        <div class="price-card-body">
          <div 
            class="current-price" 
            :class="{
              'price-up-animation': priceChangeAnimations[crypto.symbol] === 'up',
              'price-down-animation': priceChangeAnimations[crypto.symbol] === 'down'
            }"
          >
            ${{ formatPrice(crypto.price) }}
            <span class="volume-24h">{{ formatVolume(crypto.volume24h) }}</span>
          </div>
        </div>

      </div>
      </div>
    </el-drawer>

    <!-- 加载状态 -->
    <div v-if="isLoading && cryptoPrices.length === 0" class="loading-state">
      <el-skeleton :rows="3" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!isLoading && cryptoPrices.length === 0" class="empty-state">
      <el-empty description="暂无价格数据" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import ChartEngineSwitcher from '../components/kline-chart/ChartEngineSwitcher.vue'
import { formatPrice } from './kline-chart/utils/kline-formatters'
import { useBotStore } from '../stores/bot'
import { useCoinIcon } from '../composables/useCoinIcon'

const botStore = useBotStore()
const { getCoinIconUrl } = useCoinIcon()

// 从配置文件获取加密货币列表，处理去掉/
const DEFAULT_CRYPTOS = computed<string[]>(() => {
  if (botStore.config?.symbols && Array.isArray(botStore.config.symbols)) {
    return botStore.config.symbols.map((symbol: string) => symbol.replace('/', ''))
  }
  // 配置加载失败时返回空数组
  return []
})

// 响应式数据
const cryptoPrices = ref<CryptoPrice[]>([])
const isLoading = ref(false)
const isWebSocketConnected = ref(false)
const showChartModal = ref(false)
const showPriceDrawer = ref(false)
const selectedSymbol = ref('')
// 价格变动动画状态
const priceChangeAnimations = ref<Record<string, 'up' | 'down' | null>>({})

// 计算属性
const hasPrices = computed(() => cryptoPrices.value.length > 0)

// 获取WebSocket连接状态
async function fetchWebSocketStatus() {
  try {
    const response = await $fetch<WebSocketStatusResponse>('/api/websocket/status')
    if (response.success && response.data?.isConnected !== undefined) {
      isWebSocketConnected.value = response.data.isConnected
    }
  } catch (error) {
    console.error('获取WebSocket状态失败:', error)
  }
}

// 从 botStore 共享价格获取数据（自动更新）
function syncPricesFromStore() {
  const prices = botStore.prices
  if (Object.keys(prices).length > 0) {
    updateCryptoPrices(prices)
  }
}

// 监听store价格变化
watch(() => botStore.prices, () => {
  syncPricesFromStore()
}, { deep: true })

// 手动刷新价格（触发 botStore 重新拉取）
function fetchPrices() {
  isLoading.value = true
  syncPricesFromStore()
  isLoading.value = false
}

// 更新加密货币价格
function updateCryptoPrices(prices: Record<string, any>) {
  const updatedPrices: CryptoPrice[] = []
  
  DEFAULT_CRYPTOS.value.forEach((symbol: string) => {
    const priceData = prices[symbol]
    if (priceData) {
      // 获取当前价格用于比较
      const currentCrypto = cryptoPrices.value.find(c => c.symbol === symbol)
      const oldPrice = currentCrypto?.price || 0
      const newPrice = priceData.price || 0
      
      // 检测价格变动方向
      if (oldPrice > 0 && newPrice > 0) {
        if (newPrice > oldPrice) {
          // 价格上涨
          triggerPriceAnimation(symbol, 'up')
        } else if (newPrice < oldPrice) {
          // 价格下跌
          triggerPriceAnimation(symbol, 'down')
        }
      }
      
      updatedPrices.push({
        symbol,
        price: newPrice,
        change24hPercent: priceData.change24hPercent || 0,
        volume24h: priceData.volume24h || 0,
        lastUpdate: priceData.timestamp || Date.now()
      })
    } else {
      // 如果没有数据，使用默认值
      updatedPrices.push({
        symbol,
        price: 0,
        change24hPercent: 0,
        volume24h: 0,
        lastUpdate: Date.now()
      })
    }
  })
  
  cryptoPrices.value = updatedPrices
}

// 触发价格变动动画
function triggerPriceAnimation(symbol: string, direction: 'up' | 'down') {
  // 设置动画状态
  priceChangeAnimations.value[symbol] = direction
  
  // 1.5秒后清除动画状态
  if (import.meta.client) {
    setTimeout(() => {
      priceChangeAnimations.value[symbol] = null
    }, 1500)
  }
}

// 刷新价格（触发 botStore 重新拉取）
function refreshPrices() {
  botStore.fetchPrices()
  ElMessage.success('正在刷新价格数据...')
}

// 显示WebSocket状态
function showWebSocketStatus() {
  ElMessageBox.alert(
    `WebSocket连接状态: ${isWebSocketConnected.value ? '已连接' : '未连接'}`,
    '连接状态',
    {
      confirmButtonText: '确定',
      type: isWebSocketConnected.value ? 'success' : 'warning'
    }
  )
}

// 打开图表弹窗
function openChartModal(crypto: CryptoPrice) {
  selectedSymbol.value = crypto.symbol
  showPriceDrawer.value = false
  showChartModal.value = true
}

// 关闭图表弹窗
function closeChartModal() {
  showChartModal.value = false
  selectedSymbol.value = ''
}

// 格式化函数
function formatPercent(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}

function formatVolume(volume: number): string {
  if (volume >= 1000000000) {
    return `${(volume / 1000000000).toFixed(2)}B`
  } else if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(2)}M`
  } else if (volume >= 1000) {
    return `${(volume / 1000).toFixed(2)}K`
  } else {
    return volume.toFixed(2)
  }
}

function getSymbolDisplay(symbol: string): string {
  return symbol.replace('USDT', '')
}

// 获取加密货币图标（由币安官方清单驱动；无图标时返回空串，触发占位符显示）
function cryptoIconUrl(symbol: string): string {
  return getCoinIconUrl(symbol) || ''
}

// 记录加载失败的图标（true=加载失败，显示占位符）
const iconFailed = ref<Record<string, boolean>>({})

// 图标加载失败时标记，自动切换到占位符
function onIconError(symbol: string) {
  iconFailed.value[symbol] = true
}

// 为币种生成稳定的随机颜色
function getRandomColor(symbol: string) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i)
    hash |= 0
  }
  const color = Math.abs(hash).toString(16).substring(0, 6).padStart(6, '0')
  return `#${color}`
}


// 组件生命周期
onMounted(() => {
  fetchWebSocketStatus()
  // 订阅 botStore 共享价格更新，自动同步价格
  botStore.subscribeToPrices('crypto-price-cards')
  // 首次加载
  syncPricesFromStore()
})

onUnmounted(() => {
  botStore.unsubscribeFromPrices('crypto-price-cards')
})

// 类型定义
interface CryptoPrice {
  symbol: string
  price: number
  change24hPercent: number
  volume24h: number
  lastUpdate: number
}

interface ApiResponse {
  success: boolean
  message?: string
  data?: {
    prices: Record<string, any>
    timestamp: number
    webSocketState?: {
      connected: boolean
    }
  }
}

interface WebSocketStatusResponse {
  success: boolean
  message?: string
  data?: {
    isConnected: boolean
    webSocketState?: any
    subscribedSymbols?: string[]
    priceCount?: number
    lastUpdate?: number
  }
}
</script>

<style scoped>
.price-cards-container {
  margin-bottom: 20px;
}

.card-header {
  font-weight: 600;
}

.header-actions {
  gap: 8px;
}

.connection-warning {
  margin-bottom: 16px;
}

.cards-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.horizontal-line{
  margin-bottom: 30px;
}

.price-card {
  background: var(--price-card-bg);
  border: 1px solid var(--price-card-border);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  min-height: 60px;
  min-width: 0;
}

.price-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--color-primary);
}

.price-card.price-up:hover {
  border-color: var(--price-up-hover-border);
  box-shadow: 0 4px 12px var(--price-up-hover-shadow);
}

.price-card.price-down:hover {
  border-color: var(--price-down-hover-border);
  box-shadow: 0 4px 12px var(--price-down-hover-shadow);
}

.price-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.crypto-info {
  display: flex;
  flex-direction: column;
}

.crypto-symbol {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}

.crypto-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}

.crypto-icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
  line-height: 1;
}

.price-change {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 2px;
}

.price-change.positive {
  background: rgba(103, 194, 58, 0.1);
  color: var(--color-success);
}

.price-change.negative {
  background: rgba(245, 108, 108, 0.1);
  color: var(--color-danger);
}

.current-price {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 4px;
  transition: all 0.3s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 简洁的价格上涨动画 */
.price-up-animation {
  animation: priceUpEffect 0.3s ease;
  color: var(--color-success) !important;
}

/* 简洁的价格下跌动画 */
.price-down-animation {
  animation: priceDownEffect 0.3s ease;
  color: var(--color-danger) !important;
}

@keyframes priceUpEffect {
  0% {
    transform: scale(1);
    color: var(--color-success);
  }
  50% {
    transform: scale(1.05);
    color: var(--color-success);
  }
  100% {
    transform: scale(1);
    color: var(--color-success);
  }
}

@keyframes priceDownEffect {
  0% {
    transform: scale(1);
    color: var(--color-danger);
  }
  50% {
    transform: scale(1.05);
    color: var(--color-danger);
  }
  100% {
    transform: scale(1);
    color: var(--color-danger);
  }
}

.volume-24h {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 6px;
}

.price-card-footer {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  margin-bottom: 8px;
}

.price-range {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.range-item {
  display: flex;
  flex-direction: column;
}

.range-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.range-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
}

.volume-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.volume-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.volume-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
}

.last-update {
  font-size: 10px;
  color: var(--text-placeholder);
  text-align: right;
  margin-top: 4px;
}

.loading-state,
.empty-state {
  padding: 40px 0;
  text-align: center;
}

/* 抽屉挂载到 body 后不再受 scoped 样式影响，使用全局选择器同步明暗主题。 */
:global(.price-drawer.el-drawer) {
  --el-drawer-bg-color: var(--bg-card);
  background: var(--bg-card);
  color: var(--text-primary);
}

:global(.price-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

:global(.price-drawer .el-drawer__title) {
  color: var(--text-primary);
  font-weight: 600;
}

:global(.price-drawer .el-drawer__close-btn) {
  color: var(--text-secondary);
}

:global(.price-drawer .el-drawer__body) {
  padding: 16px;
  background: var(--bg-card);
  color: var(--text-primary);
  scrollbar-width: thin;
  scrollbar-color: var(--price-drawer-scrollbar-thumb) transparent;
}

/* 抽屉滚动条保持窄尺寸，避免占用价格列表的可视宽度。 */
:global(.price-drawer .el-drawer__body::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}

:global(.price-drawer .el-drawer__body::-webkit-scrollbar-track) {
  background: transparent;
}

:global(.price-drawer .el-drawer__body::-webkit-scrollbar-thumb) {
  background: var(--price-drawer-scrollbar-thumb);
  border-radius: 3px;
}

:global(.price-drawer .el-drawer__body::-webkit-scrollbar-thumb:hover) {
  background: var(--price-drawer-scrollbar-thumb-hover);
}

:global(:root) {
  --price-drawer-scrollbar-thumb: #d4d7de;
  --price-drawer-scrollbar-thumb-hover: #b8bcc6;
}

:global(:root.dark) {
  --price-drawer-scrollbar-thumb: #292a2c;
  --price-drawer-scrollbar-thumb-hover: #3a3b3e;
}

@media (max-width: 480px) {
  .cards-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  
  .price-card {
    padding: 6px;
    min-height: 55px;
    min-width: 0;
  }
  
  .crypto-symbol {
    font-size: 14px;
  }
  
  .crypto-icon {
    width: 16px;
    height: 16px;
  }
  
  .price-change {
    font-size: 12px;
    padding: 1px 2px;
  }
  
  .volume-24h {
    font-size: 12px;
  }
  
  .price-card-header {
    margin-bottom: 6px;
  }
}
</style>
