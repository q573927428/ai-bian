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
  
  async function runAllTests() {
    try {
      // 测试1: 状态API
      const statusRes = await $fetch('/api/websocket/status')
      console.log('状态测试:', statusRes)
      
      // 测试2: 连接API
      const connectRes = await $fetch('/api/websocket/connect', { method: 'POST' })
      console.log('连接测试:', connectRes)
      
      // 测试3: 订阅API
      const subscribeRes = await $fetch('/api/websocket/subscribe', {
        method: 'POST',
        body: { symbols: ['BTCUSDT', 'ETHUSDT'] }
      })
      console.log('订阅测试:', subscribeRes)
      
      // 等待数据
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      // 测试4: 价格API
      const pricesRes = await $fetch('/api/websocket/prices?symbols=BTCUSDT,ETHUSDT')
      console.log('价格测试:', pricesRes)
      
      results.value = {
        status: statusRes,
        connect: connectRes,
        subscribe: subscribeRes,
        prices: pricesRes,
        timestamp: new Date().toISOString()
      }
      
    } catch (error) {
      console.error('测试失败:', error)
      results.value = { error: error.message }
    }
  }
  </script>