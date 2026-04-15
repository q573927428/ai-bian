import { webSocketManager } from '../../../server/utils/websocket-manager'
import type { ApiResponse } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const state = webSocketManager.getWebSocketState()
    const allPrices = webSocketManager.getAllPrices()

    const response: ApiResponse = {
      success: true,
      message: 'WebSocket状态获取成功',
      data: {
        webSocketState: state,
        subscribedSymbols: state.connectedSymbols,
        priceCount: allPrices.size,
        lastUpdate: state.lastActivity,
        isConnected: state.status === 'CONNECTED'
      }
    }
    
    return response
  } catch (error: any) {
    const response: ApiResponse = {
      success: false,
      message: `获取WebSocket状态失败: ${error.message}`
    }
    
    return response
  }
})