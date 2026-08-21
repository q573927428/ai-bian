<template>
    <div>
      <h1>WebSocket功能测试</h1>
      <button @click="runAllTests">运行所有测试</button>
      <div v-if="results">
        <h3>测试结果:</h3>
        <pre>{{ JSON.stringify(results, null, 2) }}</pre>
      </div>
    </div>
  </template>
  
  <script setup>
  const results = ref(null)

  /**
   * 收集实时价格流的首批事件，验证快照、连接状态和增量价格是否都能到达。
   */
  function collectPriceStreamEvents() {
    return new Promise((resolve, reject) => {
      const stream = new EventSource('/api/market/prices/stream')
      const events = {}
      const timeout = setTimeout(() => {
        stream.close()
        reject(new Error('等待 SSE 价格事件超时'))
      }, 8000)

      const receive = (eventName) => (event) => {
        events[eventName] = JSON.parse(event.data)
        if (events.snapshot && events.status && events.prices) {
          clearTimeout(timeout)
          stream.close()
          resolve(events)
        }
      }

      stream.addEventListener('snapshot', receive('snapshot'))
      stream.addEventListener('status', receive('status'))
      stream.addEventListener('prices', receive('prices'))
      stream.onerror = () => {
        clearTimeout(timeout)
        stream.close()
        reject(new Error('SSE 价格连接失败'))
      }
    })
  }
  
  async function runAllTests() {
    try {
      // 测试1: 状态API
      const statusRes = await $fetch('/api/websocket/status')
      console.log('状态测试:', statusRes)
      
      // 测试2: SSE 实时价格流
      const streamEvents = await collectPriceStreamEvents()
      console.log('SSE测试:', streamEvents)

      // 测试3: 价格快照API
      const pricesRes = await $fetch('/api/websocket/prices?symbols=BTCUSDT,ETHUSDT')
      console.log('价格测试:', pricesRes)
      
      results.value = {
        status: statusRes,
        streamEvents,
        prices: pricesRes,
        timestamp: new Date().toISOString()
      }
      
    } catch (error) {
      console.error('测试失败:', error)
      results.value = { error: error.message }
    }
  }
  </script>
