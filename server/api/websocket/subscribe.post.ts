import { webSocketManager } from '../../../server/utils/websocket-manager'
import {
  cleanupExpiredClients,
  generateClientId,
  updateClientActivity,
  getClientCallbacks,
  setClientCallbacks
} from '../../../server/utils/websocket-client-manager'
import type { ApiResponse } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { symbols, clientId: providedClientId } = body

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      const response: ApiResponse = {
        success: false,
        message: '请提供有效的交易对数组'
      }
      return response
    }

    // 确保WebSocket已连接
    await webSocketManager.initialize()

    // 生成或使用提供的客户端ID
    const clientId = providedClientId || generateClientId()
    
    // 清理过期客户端
    cleanupExpiredClients()
    
    // 更新客户端最后活动时间
    updateClientActivity(clientId)
    
    // 获取或创建客户端的回调函数映射
    let symbolCallbacks = getClientCallbacks(clientId)
    if (!symbolCallbacks) {
      symbolCallbacks = new Map()
      setClientCallbacks(clientId, symbolCallbacks)
    }

    // 获取该客户端已有的共享回调（同一客户端所有交易对共享同一个回调）
    let sharedCallback: ((data: any) => void) | null = null
    if (symbolCallbacks.size > 0) {
      // 从已有回调中取第一个作为共享回调
      const firstSymbol = symbolCallbacks.keys().next().value
      if (firstSymbol) {
        sharedCallback = symbolCallbacks.get(firstSymbol) || null
      }
    }

    // 如果没有共享回调，创建一个新的
    if (!sharedCallback) {
      sharedCallback = (priceData: any) => {
        // 这里可以处理价格更新，例如记录日志或触发其他操作
        // console.log(`📈 客户端 ${clientId} 收到价格更新: ${priceData.symbol} = ${priceData.price}`)
      }
    }

    // 订阅所有交易对
    symbols.forEach(symbol => {
      // 如果已经订阅了这个交易对，跳过（复用已有回调，不重复添加）
      if (symbolCallbacks!.has(symbol)) {
        return
      }
      
      // 订阅新的
      webSocketManager.subscribePrice(symbol, sharedCallback!)
      symbolCallbacks!.set(symbol, sharedCallback!)
      
      // console.log(`✅ 客户端 ${clientId} 订阅: ${symbol}`)
    })
    
    const state = webSocketManager.getWebSocketState()
    const prices = new Map<string, any>()
    
    // 获取当前价格（如果有缓存）
    symbols.forEach(symbol => {
      const price = webSocketManager.getPrice(symbol)
      if (price) {
        prices.set(symbol, price)
      }
    })

    const response: ApiResponse = {
      success: true,
      message: `已订阅 ${symbols.length} 个交易对`,
      data: {
        clientId,
        subscribedSymbols: symbols,
        currentPrices: Object.fromEntries(prices),
        webSocketState: state,
        note: '请保存clientId用于后续取消订阅'
      }
    }
    
    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `订阅价格失败: ${error.message}`
    }
    
    return response
  }
})