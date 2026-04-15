/**
 * WebSocket客户端管理器 - 共享模块
 * 用于管理WebSocket订阅的客户端状态，确保subscribe和unsubscribe API使用相同的Map实例
 */

import { webSocketManager } from './websocket-manager'

// 存储客户端回调函数的映射
// 格式: { [clientId]: { [symbol]: callback } }
const clientCallbacks = new Map<string, Map<string, (data: any) => void>>()

// 存储客户端最后活动时间
const clientLastActivity = new Map<string, number>()

// 清理过期客户端（超过5分钟没有活动）
function cleanupExpiredClients(): void {
  const now = Date.now()
  const expirationTime = 5 * 60 * 1000 // 5分钟
  
  for (const [clientId, lastActivity] of clientLastActivity.entries()) {
    if (now - lastActivity > expirationTime) {
      const symbolCallbacks = clientCallbacks.get(clientId)
      if (symbolCallbacks) {
        // 取消订阅所有交易对
        for (const [symbol, callback] of symbolCallbacks.entries()) {
          webSocketManager.unsubscribePrice(symbol, callback)
          // console.log(`🗑️  清理过期客户端 ${clientId} 的订阅: ${symbol}`)
        }
        clientCallbacks.delete(clientId)
      }
      clientLastActivity.delete(clientId)
      // console.log(`🗑️  已清理过期客户端: ${clientId}`)
    }
  }
}

// 生成客户端ID
function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 更新客户端活动时间
function updateClientActivity(clientId: string): void {
  clientLastActivity.set(clientId, Date.now())
}

// 获取客户端回调映射
function getClientCallbacks(clientId: string): Map<string, (data: any) => void> | undefined {
  return clientCallbacks.get(clientId)
}

// 设置客户端回调映射
function setClientCallbacks(clientId: string, callbacks: Map<string, (data: any) => void>): void {
  clientCallbacks.set(clientId, callbacks)
}

// 删除客户端回调映射
function deleteClientCallbacks(clientId: string): void {
  clientCallbacks.delete(clientId)
  clientLastActivity.delete(clientId)
}

// 获取客户端最后活动时间
function getClientLastActivity(clientId: string): number | undefined {
  return clientLastActivity.get(clientId)
}

// 导出共享的函数和变量
export {
  clientCallbacks,
  clientLastActivity,
  cleanupExpiredClients,
  generateClientId,
  updateClientActivity,
  getClientCallbacks,
  setClientCallbacks,
  deleteClientCallbacks,
  getClientLastActivity
}