import { webSocketManager } from '../../../server/utils/websocket-manager'
import type { ApiResponse } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    // 初始化WebSocket连接
    await webSocketManager.initialize()
    
    const state = webSocketManager.getWebSocketState()
    
    const response: ApiResponse = {
      success: true,
      message: 'WebSocket连接已建立',
      data: {
        status: state.status,
        connectedSymbols: state.connectedSymbols,
        subscriptions: state.subscriptions
      }
    }
    
    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `连接WebSocket失败: ${error.message}`
    }
    
    return response
  }
})