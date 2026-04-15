import { webSocketManager } from '../../../server/utils/websocket-manager'
import {
  cleanupExpiredClients,
  updateClientActivity,
  getClientCallbacks,
  deleteClientCallbacks
} from '../../../server/utils/websocket-client-manager'
import type { ApiResponse } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { symbols, clientId } = body

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      const response: ApiResponse = {
        success: false,
        message: '请提供有效的交易对数组'
      }
      return response
    }

    if (!clientId) {
      const response: ApiResponse = {
        success: false,
        message: '请提供clientId'
      }
      return response
    }

    // 确保WebSocket已连接
    await webSocketManager.initialize()

    // 清理过期客户端
    cleanupExpiredClients()
    
    // 更新客户端最后活动时间
    updateClientActivity(clientId)

    // 获取客户端的回调函数映射
    const symbolCallbacks = getClientCallbacks(clientId)
    
    if (!symbolCallbacks) {
      const response: ApiResponse = {
        success: true,
        message: `客户端 ${clientId} 没有找到订阅记录`,
        data: {
          clientId,
          requestedUnsubscribeSymbols: symbols,
          actualUnsubscribed: []
        }
      }
      return response
    }

    const unsubscribedSymbols: string[] = []

    // 取消订阅每个交易对
    for (const symbol of symbols) {
      const callback = symbolCallbacks.get(symbol)
      if (callback) {
        // 从WebSocket管理器取消订阅
        webSocketManager.unsubscribePrice(symbol, callback)
        
        // 从客户端映射中移除
        symbolCallbacks.delete(symbol)
        unsubscribedSymbols.push(symbol)
      }
    }

    // 如果客户端没有更多订阅，清理映射
    if (symbolCallbacks.size === 0) {
      deleteClientCallbacks(clientId)
      // console.log(`🗑️  清理客户端 ${clientId} 的订阅记录`)
    }

    const state = webSocketManager.getWebSocketState()

    const response: ApiResponse = {
      success: true,
      message: `取消订阅完成: ${unsubscribedSymbols.length} 个交易对`,
      data: {
        clientId,
        requestedUnsubscribeSymbols: symbols,
        actualUnsubscribed: unsubscribedSymbols,
        remainingSubscriptions: symbolCallbacks ? Array.from(symbolCallbacks.keys()) : [],
        webSocketState: state
      }
    }
    
    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `取消订阅失败: ${error.message}`
    }
    
    return response
  }
})