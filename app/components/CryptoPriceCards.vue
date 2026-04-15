<template>
  <el-card class="price-cards-container" shadow="hover">
    <template #header>
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
    </template>

     <!-- TradingView弹窗 -->
    <KLineChartSimple :symbol="selectedSymbol || 'BTCUSDT'" />
    
    <!-- 水平线 -->
     <div class="horizontal-line"></div>



    <!-- WebSocket状态提示 -->
    <div v-if="!isWebSocketConnected" class="connection-warning">
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
    </div>

    <!-- 价格卡片网格 -->
    <div class="cards-grid">
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
              <img 
                v-if="getCryptoIcon(crypto.symbol)" 
                :src="getCryptoIcon(crypto.symbol)" 
                :alt="getSymbolDisplay(crypto.symbol)"
                class="crypto-icon"
              />
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
          </div>
          <div class="price-change-row">
            <div class="price-change-amount" :class="crypto.change24h >= 0 ? 'positive' : 'negative'">
              {{ crypto.change24h >= 0 ? '+' : '-' }}{{ formatPrice(Math.abs(crypto.change24h)) }}  
            </div>
            <div class="volume-24h">
              24h: {{ formatVolume(crypto.volume24h) }}
            </div>
          </div>
        </div>

        <!-- <div class="price-card-footer">
          <div class="price-range">
            <div class="range-item">
              <span class="range-label">高:</span>
              <span class="range-value">${{ formatPrice(crypto.high24h) }}</span>
            </div>
            <div class="range-item">
              <span class="range-label">低:</span>
              <span class="range-value">${{ formatPrice(crypto.low24h) }}</span>
            </div>
          </div>
          <div class="volume-info">
            <span class="volume-label">24h量:</span>
            <span class="volume-value">{{ formatVolume(crypto.volume24h) }}</span>
          </div>
        </div> -->

        <!-- <div class="last-update">
          更新: {{ formatTime(crypto.lastUpdate) }}
        </div> -->
      </div>
    </div>

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
import dayjs from 'dayjs'
import TradingViewChartModal from './TradingViewChartModal.vue'
import KLineChartSimple from '../components/kline-chart/KLineChartSimple.vue'
import { useBotStore } from '../stores/bot'

const botStore = useBotStore()

// 从配置文件获取加密货币列表，处理去掉/
const DEFAULT_CRYPTOS = computed<string[]>(() => {
  if (botStore.config?.symbols && Array.isArray(botStore.config.symbols)) {
    return botStore.config.symbols.map((symbol: string) => symbol.replace('/', ''))
  }
  // 配置加载失败时使用默认值
  return [
    'BTCUSDT',
    'ETHUSDT', 
    'BNBUSDT',
    'SOLUSDT',
    'DOGEUSDT',
    'XAUUSDT',
    'XAGUSDT',
    'HYPEUSDT',
  ]
})

// 响应式数据
const cryptoPrices = ref<CryptoPrice[]>([])
const isLoading = ref(false)
const isWebSocketConnected = ref(false)
const showChartModal = ref(false)
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

// 获取价格数据
async function fetchPrices() {
  isLoading.value = true
  try {
    const response = await $fetch<ApiResponse>('/api/websocket/prices', {
      params: {
        symbols: DEFAULT_CRYPTOS.value.join(',')
      }
    })

    if (response.success && response.data?.prices) {
      updateCryptoPrices(response.data.prices)
    } else {
      ElMessage.warning('获取价格数据失败')
    }
  } catch (error: any) {
    console.error('获取价格失败:', error)
    ElMessage.error(`获取价格失败: ${error.message}`)
  } finally {
    isLoading.value = false
  }
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
        change24h: priceData.change24h || 0,
        change24hPercent: priceData.change24hPercent || 0,
        high24h: priceData.high24h || 0,
        low24h: priceData.low24h || 0,
        volume24h: priceData.volume24h || 0,
        lastUpdate: priceData.timestamp || Date.now()
      })
    } else {
      // 如果没有数据，使用默认值
      updatedPrices.push({
        symbol,
        price: 0,
        change24h: 0,
        change24hPercent: 0,
        high24h: 0,
        low24h: 0,
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

// 刷新价格
function refreshPrices() {
  fetchPrices()
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
  showChartModal.value = true
}

// 关闭图表弹窗
function closeChartModal() {
  showChartModal.value = false
  selectedSymbol.value = ''
}

// 格式化函数
function formatPrice(price: number): string {
  if (price === 0) return '0'
  
  if (price < 0.001) {
    return price.toFixed(6)
  } else if (price < 1) {
    return price.toFixed(3)
  } else if (price < 1000) {
    return price.toFixed(2)
  } else {
    // 对于大数字，添加千位分隔符
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
}

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

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('HH:mm:ss')
}

function getSymbolDisplay(symbol: string): string {
  return symbol.replace('USDT', '')
}

// 获取加密货币图标
function getCryptoIcon(symbol: string): string {
  const baseSymbol = symbol.replace('USDT', '').toLowerCase()
  
  // 加密货币图标映射 - 使用本地路径
  const iconMap: Record<string, string> = {
    'btc': '/assets/crypto-icons/btc.png',
    'eth': '/assets/crypto-icons/eth.png',
    'bnb': '/assets/crypto-icons/bnb.png',
    'sol': '/assets/crypto-icons/sol.png',
    'doge': '/assets/crypto-icons/doge.png',
    'xau': '/assets/crypto-icons/xau.png', // 黄金图标
    'xag': '/assets/crypto-icons/xag.png', // 白银图标
    'hype': '/assets/crypto-icons/hype.png', // 默认代币图标
  }
  
  return iconMap[baseSymbol] || ''
}


// 定时刷新
let refreshInterval: NodeJS.Timeout | null = null

function startAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
  
  // 每10秒刷新一次价格
  refreshInterval = setInterval(() => {
    if (!isLoading.value) {
      fetchPrices()
    }
  }, 10000)
}

// 组件生命周期
onMounted(() => {
  fetchWebSocketStatus()
  fetchPrices()
  startAutoRefresh()
  
  // 订阅共享轮询，自动更新配置
  botStore.subscribeToPolling('crypto-price-cards', () => {
    // 配置变化时重新获取价格
    fetchPrices()
  })
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  // 取消订阅轮询
  botStore.unsubscribeFromPolling('crypto-price-cards')
})

// 类型定义
interface CryptoPrice {
  symbol: string
  price: number
  change24h: number
  change24hPercent: number
  high24h: number
  low24h: number
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.connection-warning {
  margin-bottom: 16px;
}

.cards-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.horizontal-line{
  margin-bottom: 30px;
}

.price-card {
  background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  min-height: 70px;
  min-width: 138px;
  flex-shrink: 0;
  flex: 1 0 calc(12.5% - 8px); /* 默认一行显示8个 (100% / 8 = 12.5%) */
}

.price-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: #409eff;
}

.price-card.price-up:hover {
  border-color: #67c23a;
  box-shadow: 0 4px 12px rgba(103, 194, 58, 0.15);
}

.price-card.price-down:hover {
  border-color: #f56c6c;
  box-shadow: 0 4px 12px rgba(245, 108, 108, 0.15);
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
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}

.crypto-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}

.price-change {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 2px;
}

.price-change.positive {
  background: rgba(103, 194, 58, 0.1);
  color: #67c23a;
}

.price-change.negative {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

/* .price-card-body {
  margin-bottom: 12px;
} */

.current-price {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
  margin-bottom: 4px;
  transition: all 0.3s ease;
}

/* 简洁的价格上涨动画 */
.price-up-animation {
  animation: priceUpEffect 0.3s ease;
  color: #67c23a !important;
}

/* 简洁的价格下跌动画 */
.price-down-animation {
  animation: priceDownEffect 0.3s ease;
  color: #f56c6c !important;
}

/* 简洁的价格上涨动画关键帧 */
@keyframes priceUpEffect {
  0% {
    transform: scale(1);
    color: #67c23a;
  }
  50% {
    transform: scale(1.05);
    color: #67c23a;
  }
  100% {
    transform: scale(1);
    color: #67c23a;
  }
}

/* 简洁的价格下跌动画关键帧 */
@keyframes priceDownEffect {
  0% {
    transform: scale(1);
    color: #f56c6c;
  }
  50% {
    transform: scale(1.05);
    color: #f56c6c;
  }
  100% {
    transform: scale(1);
    color: #f56c6c;
  }
}

.price-change-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}

.price-change-amount {
  font-size: 12px;
  font-weight: 500;
}

.price-change-amount.positive {
  color: #67c23a;
}

.price-change-amount.negative {
  color: #f56c6c;
}

.volume-24h {
  font-size: 11px;
  color: #909399;
  font-weight: 500;
}

.price-card-footer {
  border-top: 1px solid #ebeef5;
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
  color: #909399;
  margin-bottom: 2px;
}

.range-value {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.volume-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.volume-label {
  font-size: 11px;
  color: #909399;
}

.volume-value {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.last-update {
  font-size: 10px;
  color: #c0c4cc;
  text-align: right;
  margin-top: 4px;
}

.loading-state,
.empty-state {
  padding: 40px 0;
  text-align: center;
}

/* 手机端尺寸 (小于等于480px) */
@media (max-width: 480px) {
  .cards-grid {
    gap: 6px;
  }
  
  .price-card {
    padding: 6px;
    min-height: 75px;
    flex: 1 0 calc(50% - 6px); /* 手机端一行显示2个 */
    min-width: 0; /* 移除最小宽度限制 */
  }
  
  .crypto-symbol {
    font-size: 12px;
  }
  
  .crypto-icon {
    width: 12px;
    height: 12px;
  }
  
  .current-price {
    font-size: 14px;
  }
  
  .price-change {
    font-size: 8px;
    padding: 1px 2px;
  }
  
  .price-change-amount {
    font-size: 10px;
  }
  
  .volume-24h {
    font-size: 9px;
  }
  
  .price-card-header {
    margin-bottom: 6px;
  }
}
</style>