# WebSocket获取币安代币价格接口文档

## 概述

本系统提供了一个完整的WebSocket接口，用于实时获取币安期货交易对的代币价格。系统包含以下组件：

1. **WebSocket服务** (`BinanceWebSocketService`) - 底层WebSocket连接管理
2. **WebSocket管理器** (`WebSocketManager`) - 全局价格数据管理和订阅分发
3. **REST API端点** - 供前端调用的HTTP接口
4. **类型定义** - TypeScript类型支持

## 安装和配置

### 1. 环境要求
- Node.js 16+
- Nuxt 4.3+
- 币安期货账户（可选，用于测试）

### 2. 项目结构
```
server/
├── utils/
│   ├── websocket.ts          # WebSocket服务类
│   └── websocket-manager.ts  # WebSocket管理器
├── api/
│   └── websocket/
│       ├── connect.post.ts   # 连接WebSocket
│       ├── subscribe.post.ts # 订阅价格
│       ├── prices.get.ts     # 获取价格
│       └── status.get.ts     # 获取状态
types/
└── websocket.ts              # WebSocket类型定义
```

## API接口

### 1. 连接WebSocket
**端点**: `POST /api/websocket/connect`

**功能**: 建立与币安WebSocket的连接

**响应**:
```json
{
  "success": true,
  "message": "WebSocket连接已建立",
  "data": {
    "status": "CONNECTED",
    "connectedSymbols": [],
    "subscriptions": {
      "symbols": []
    }
  }
}
```

### 2. 订阅价格数据
**端点**: `POST /api/websocket/subscribe`

**请求体**:
```json
{
  "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
}
```

**响应**:
```json
{
  "success": true,
  "message": "已订阅 3 个交易对",
  "data": {
    "subscribedSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
    "currentPrices": {
      "BTCUSDT": {
        "symbol": "BTCUSDT",
        "price": 45000.50,
        "timestamp": 1678888888888,
        "volume": 1234.56,
        "bid": 44999.00,
        "ask": 45001.00
      }
    },
    "webSocketState": {...}
  }
}
```

### 3. 获取价格数据
**端点**: `GET /api/websocket/prices`

**查询参数**:
- `symbols` (可选): 逗号分隔的交易对列表，如 `?symbols=BTCUSDT,ETHUSDT`

**响应**:
```json
{
  "success": true,
  "message": "获取到 2 个交易对的价格",
  "data": {
    "prices": {
      "BTCUSDT": {
        "symbol": "BTCUSDT",
        "price": 45000.50,
        "timestamp": 1678888888888
      },
      "ETHUSDT": {
        "symbol": "ETHUSDT",
        "price": 2500.75,
        "timestamp": 1678888888888
      }
    },
    "timestamp": 1678888888888,
    "webSocketState": {...}
  }
}
```

### 4. 获取WebSocket状态
**端点**: `GET /api/websocket/status`

**响应**:
```json
{
  "success": true,
  "message": "WebSocket状态获取成功",
  "data": {
    "webSocketState": {
      "status": "CONNECTED",
      "connectedSymbols": ["BTCUSDT", "ETHUSDT"],
      "subscriptions": {
        "symbols": ["BTCUSDT", "ETHUSDT"]
      },
      "lastActivity": 1678888888888,
      "reconnectAttempts": 0
    },
    "subscribedSymbols": ["BTCUSDT", "ETHUSDT"],
    "priceCount": 2,
    "lastUpdate": 1678888888888,
    "isConnected": true
  }
}
```

## 代码使用示例

### 1. 使用WebSocket管理器

```typescript
import { webSocketManager } from '~/server/utils/websocket-manager'

// 初始化连接
await webSocketManager.initialize()

// 订阅价格数据
const priceCallback = (priceData: PriceData) => {
  console.log(`价格更新: ${priceData.symbol} = ${priceData.price}`)
}

webSocketManager.subscribePrice('BTCUSDT', priceCallback)
webSocketManager.subscribePrice('ETHUSDT', priceCallback)

// 批量订阅
webSocketManager.subscribePrices(['BTCUSDT', 'ETHUSDT', 'BNBUSDT'], priceCallback)

// 获取当前价格
const btcPrice = webSocketManager.getPrice('BTCUSDT')
console.log(`BTC当前价格: ${btcPrice?.price}`)

// 获取所有价格
const allPrices = webSocketManager.getAllPrices()

// 获取WebSocket状态
const state = webSocketManager.getWebSocketState()

// 取消订阅
webSocketManager.unsubscribePrice('ETHUSDT', priceCallback)

// 断开连接
webSocketManager.disconnect()
```

### 2. 直接使用WebSocket服务

```typescript
import { BinanceWebSocketService } from '~/server/utils/websocket'

// 创建服务实例
const wsService = new BinanceWebSocketService({
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
  pingInterval: 25000,
  timeout: 8000
})

// 添加事件监听
wsService.on('price', (event) => {
  console.log(`价格更新: ${event.data.symbol} = ${event.data.price}`)
})

wsService.on('status', (event) => {
  console.log(`状态变化: ${event.data}`)
})

// 连接
await wsService.connect()

// 订阅
wsService.subscribePrices(['BTCUSDT', 'ETHUSDT'])

// 订阅K线数据
wsService.subscribeKlines(['BTCUSDT'], ['1m', '5m', '15m'])

// 获取价格
const price = wsService.getPrice('BTCUSDT')

// 断开连接
wsService.disconnect()
```

## 前端集成

### 1. 在Vue组件中使用

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { webSocketManager } from '~/server/utils/websocket-manager'

const prices = ref<Record<string, number>>({})
const isConnected = ref(false)

// 价格回调函数
const handlePriceUpdate = (priceData) => {
  prices.value[priceData.symbol] = priceData.price
}

onMounted(async () => {
  try {
    // 初始化WebSocket连接
    await webSocketManager.initialize()
    isConnected.value = true
    
    // 订阅价格
    webSocketManager.subscribePrices(['BTCUSDT', 'ETHUSDT'], handlePriceUpdate)
    
  } catch (error) {
    console.error('WebSocket连接失败:', error)
  }
})

onUnmounted(() => {
  // 清理订阅
  webSocketManager.disconnect()
})
</script>

<template>
  <div>
    <div v-if="isConnected" class="status connected">
      ✅ WebSocket已连接
    </div>
    <div v-else class="status disconnected">
      🔌 WebSocket未连接
    </div>
    
    <div class="prices">
      <div v-for="(price, symbol) in prices" :key="symbol" class="price-item">
        <span class="symbol">{{ symbol }}</span>
        <span class="price">${{ price.toFixed(2) }}</span>
      </div>
    </div>
  </div>
</template>
```

### 2. 在Pinia Store中使用

```typescript
// stores/websocket.ts
import { defineStore } from 'pinia'
import { webSocketManager } from '~/server/utils/websocket-manager'
import type { PriceData } from '~/types/websocket'

export const useWebSocketStore = defineStore('websocket', {
  state: () => ({
    prices: {} as Record<string, PriceData>,
    isConnected: false,
    subscribedSymbols: [] as string[],
  }),

  actions: {
    async connect() {
      try {
        await webSocketManager.initialize()
        this.isConnected = true
      } catch (error) {
        console.error('连接失败:', error)
        throw error
      }
    },

    subscribe(symbols: string[]) {
      symbols.forEach(symbol => {
        if (!this.subscribedSymbols.includes(symbol)) {
          webSocketManager.subscribePrice(symbol, this.handlePriceUpdate)
          this.subscribedSymbols.push(symbol)
        }
      })
    },

    unsubscribe(symbol: string) {
      const index = this.subscribedSymbols.indexOf(symbol)
      if (index > -1) {
        this.subscribedSymbols.splice(index, 1)
        // 注意：需要保存回调函数的引用才能正确取消订阅
      }
    },

    handlePriceUpdate(priceData: PriceData) {
      this.prices[priceData.symbol] = priceData
    },

    disconnect() {
      webSocketManager.disconnect()
      this.isConnected = false
      this.subscribedSymbols = []
      this.prices = {}
    }
  },

  getters: {
    getPrice: (state) => (symbol: string) => {
      return state.prices[symbol]?.price
    },
    
    getAllPrices: (state) => {
      return state.prices
    }
  }
})
```

## 错误处理

### 常见错误及解决方案

1. **连接失败**
   - 检查网络连接
   - 确认币安WebSocket端点可访问
   - 检查防火墙设置

2. **订阅失败**
   - 确认交易对格式正确（如 `BTCUSDT`）
   - 检查WebSocket连接状态
   - 确认交易对在币安期货市场存在

3. **数据不更新**
   - 检查事件监听器是否正确注册
   - 确认回调函数正常工作
   - 检查WebSocket连接是否断开

### 重连机制

系统内置自动重连机制：
- 连接断开后自动尝试重连
- 重连间隔指数退避（3000ms, 4500ms, 6750ms...）
- 最大重连尝试次数可配置（默认5次）

## 测试

### 运行测试脚本

```bash
# 运行WebSocket测试
node test/test_websocket.js
```

### 手动测试API

```bash
# 启动开发服务器
npm run dev

# 测试API端点
curl -X GET "http://localhost:3000/api/websocket/status"
curl -X GET "http://localhost:3000/api/websocket/prices?symbols=BTCUSDT,ETHUSDT"
curl -X POST "http://localhost:3000/api/websocket/connect"
curl -X POST "http://localhost:3000/api/websocket/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["BTCUSDT", "ETHUSDT"]}'
```

## 性能优化建议

1. **批量订阅**: 使用 `subscribePrices` 批量订阅多个交易对
2. **合理缓存**: 价格数据已自动缓存，无需频繁查询
3. **事件节流**: 在前端对高频更新进行节流处理
4. **连接复用**: 使用单例模式确保WebSocket连接复用
5. **内存管理**: 及时取消不再需要的订阅

## 注意事项

1. **币安限制**: 币安WebSocket有连接数和订阅数限制
2. **网络延迟**: 实时数据受网络延迟影响
3. **数据精度**: 价格数据精度为币安提供的最新价格
4. **错误恢复**: 系统会自动处理网络中断和重连
5. **生产环境**: 在生产环境中建议添加监控和告警

## 更新日志

### v1.0.0 (2026-02-02)
- 初始版本发布
- 实现WebSocket连接管理
- 提供完整的API接口
- 添加类型定义和文档