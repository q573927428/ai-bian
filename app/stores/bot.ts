import { defineStore } from 'pinia'
import type { 
  BotState,
  BotConfig, 
  TradeHistory, 
  LogEntry,
  CryptoBalance,
  StatusResponse,
  StartStopResponse,
  ConfigResponse,
  HistoryResponse,
  HistoryStats,
  PaginationInfo
} from '../../types'

// 脚本API响应类型
interface ScriptResponse {
  success: boolean
  message?: string
  error?: string
  stdout?: string
  outputPath?: string
  suggestion?: string
  content?: string
  fileInfo?: {
    path: string
    size: number
    modified: Date
    created: Date
  }
}

// 平仓API响应类型
interface ClosePositionResponse {
  success: boolean
  message?: string
  state?: BotState
}

export const useBotStore = defineStore('bot', {
  state: () => ({
    state: null as BotState | null,
    config: null as BotConfig | null,
    history: [] as TradeHistory[],
    logs: [] as LogEntry[],
    cryptoBalances: [] as CryptoBalance[],
    historyStats: null as HistoryStats | null,
    pagination: null as PaginationInfo | null,
    isLoading: false,
    error: null as string | null,
    
  // 共享轮询管理
  pollingSubscribers: new Map<string, () => void>(), // 改为Map，存储订阅者ID和回调函数
  pollingTimer: null as NodeJS.Timeout | null,
  isPollingActive: false,
  }),

  getters: {
    isRunning: (state) => {
      return state.state?.status === 'MONITORING' || state.state?.status === 'POSITION'
    },
    hasPosition: (state) => {
      return state.state?.currentPosition !== null
    },
    isHalted: (state) => {
      return state.state?.status === 'HALTED'
    },
  },

  actions: {
    async fetchStatus() {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<StatusResponse>('/api/bot/status')
        
        if (response.success) {
          this.state = response.data!.state
          this.config = response.data!.config
          this.logs = response.data!.logs
          // 更新加密货币余额
          if (response.data!.cryptoBalances) {
            this.cryptoBalances = response.data!.cryptoBalances
          }
        } else {
          this.error = response.message || '获取状态失败'
        }
      } catch (error: any) {
        this.error = error.message || '获取状态失败'
      } finally {
        this.isLoading = false
      }
    },

    async startBot() {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<StartStopResponse>('/api/bot/start', {
          method: 'POST',
        })

        if (response.success) {
          this.state = response.state!
          return true
        } else {
          this.error = response.message || '启动失败'
          return false
        }
      } catch (error: any) {
        this.error = error.message || '启动失败'
        return false
      } finally {
        this.isLoading = false
      }
    },

    async stopBot() {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<StartStopResponse>('/api/bot/stop', {
          method: 'POST',
        })

        if (response.success) {
          this.state = response.state!
          return true
        } else {
          this.error = response.message || '停止失败'
          return false
        }
      } catch (error: any) {
        this.error = error.message || '停止失败'
        return false
      } finally {
        this.isLoading = false
      }
    },

    async updateConfig(newConfig: Partial<BotConfig>) {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<ConfigResponse>('/api/bot/config', {
          method: 'PATCH',
          body: newConfig,
        })

        if (response.success) {
          this.config = response.config!
          return true
        } else {
          this.error = response.message || '更新配置失败'
          return false
        }
      } catch (error: any) {
        this.error = error.message || '更新配置失败'
        return false
      } finally {
        this.isLoading = false
      }
    },

    async fetchHistory(page: number = 1, pageSize: number = 10) {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<HistoryResponse>('/api/bot/history', {
          query: {
            page,
            pageSize
          }
        })

        if (response.success) {
          this.history = response.data!
          this.historyStats = response.stats || null
          this.pagination = response.pagination || null
        } else {
          this.error = response.message || '获取历史失败'
        }
      } catch (error: any) {
        this.error = error.message || '获取历史失败'
      } finally {
        this.isLoading = false
      }
    },

    startPolling(interval?: number) {
      // 使用持仓扫描间隔作为前端轮询间隔
      // 配置中的 positionScanInterval 是秒，需要转换为毫秒
      const pollInterval = interval || (this.config?.positionScanInterval || 60) * 1000
      
      // 定时轮询状态
      const timer = setInterval(() => {
        this.fetchStatus()
      }, pollInterval)

      return () => clearInterval(timer)
    },

    // 订阅共享轮询（带回调函数）
    subscribeToPolling(subscriberId: string, callback?: () => void) {
      // 添加订阅者
      this.pollingSubscribers.set(subscriberId, callback || (() => {}))
      
      // 如果有订阅者且轮询未启动，则启动轮询
      if (this.pollingSubscribers.size > 0 && !this.pollingTimer) {
        this.startSharedPolling()
      }
      
      console.log(`[Polling] 订阅者 ${subscriberId} 加入，当前订阅者: ${this.pollingSubscribers.size}`)
    },

    // 取消订阅共享轮询
    unsubscribeFromPolling(subscriberId: string) {
      // 移除订阅者
      this.pollingSubscribers.delete(subscriberId)
      
      // 如果没有订阅者了，则停止轮询
      if (this.pollingSubscribers.size === 0 && this.pollingTimer) {
        this.stopSharedPolling()
      }
      
      console.log(`[Polling] 订阅者 ${subscriberId} 离开，当前订阅者: ${this.pollingSubscribers.size}`)
    },

    // 启动共享轮询
    startSharedPolling() {
      if (this.pollingTimer) {
        return // 已经启动了
      }
      
      // 使用配置中的 positionScanInterval，转换为毫秒
      const pollInterval = (this.config?.positionScanInterval || 60) * 1000
      
      console.log(`[Polling] 启动共享轮询，间隔: ${pollInterval}ms`)
      
      this.pollingTimer = setInterval(() => {
        // 获取状态
        this.fetchStatus()
        
        // 调用所有订阅者的回调函数
        for (const callback of this.pollingSubscribers.values()) {
          try {
            callback()
          } catch (error) {
            console.error('[Polling] 调用订阅者回调失败:', error)
          }
        }
      }, pollInterval)
      
      this.isPollingActive = true
      
      // 立即执行一次获取状态
      this.fetchStatus()
    },

    // 停止共享轮询
    stopSharedPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer)
        this.pollingTimer = null
        this.isPollingActive = false
        console.log('[Polling] 停止共享轮询')
      }
    },

    // 获取当前轮询状态
    getPollingStatus() {
      return {
        isActive: this.isPollingActive,
        subscribers: Array.from(this.pollingSubscribers),
        interval: (this.config?.positionScanInterval || 60) * 1000,
        hasTimer: !!this.pollingTimer
      }
    },

    // 生成Pine脚本
    async generatePineScript() {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<ScriptResponse>('/api/scripts/generate-tv', {
          method: 'POST'
        })
        
        if (response.success) {
          return {
            success: true,
            message: response.message || 'Pine脚本生成成功',
            data: response
          }
        } else {
          this.error = response.message || '生成失败'
          return {
            success: false,
            message: response.message || '生成失败',
            error: response.error
          }
        }
      } catch (error: any) {
        this.error = error.message || '生成脚本时发生错误'
        return {
          success: false,
          message: '生成脚本时发生错误',
          error: error.message || String(error)
        }
      } finally {
        this.isLoading = false
      }
    },

    // 获取Pine脚本内容
    async getPineScriptContent() {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<ScriptResponse>('/api/scripts/get-pine')
        
        if (response.success) {
          return {
            success: true,
            message: response.message || '获取Pine脚本成功',
            content: response.content,
            fileInfo: response.fileInfo,
            data: response
          }
        } else {
          this.error = response.message || '获取脚本失败'
          return {
            success: false,
            message: response.message || '获取脚本失败',
            error: response.error,
            suggestion: response.suggestion
          }
        }
      } catch (error: any) {
        this.error = error.message || '获取脚本时发生错误'
        return {
          success: false,
          message: '获取脚本时发生错误',
          error: error.message || String(error)
        }
      } finally {
        this.isLoading = false
      }
    },

    // 手动平仓
    async closePosition(password: string, reason: string = '手动平仓') {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<ClosePositionResponse>('/api/bot/close-position', {
          method: 'POST',
          body: { password, reason }
        })
        
        if (response.success) {
          // 更新状态
          if (response.state) {
            this.state = response.state
          }
          return {
            success: true,
            message: response.message || '平仓成功'
          }
        } else {
          this.error = response.message || '平仓失败'
          return {
            success: false,
            message: response.message || '平仓失败'
          }
        }
      } catch (error: any) {
        this.error = error.message || '平仓时发生错误'
        return {
          success: false,
          message: '平仓时发生错误',
          error: error.message || String(error)
        }
      } finally {
        this.isLoading = false
      }
    },

    // 手动开仓
    async manualOpenPosition(params: {
      symbol: string
      direction: 'LONG' | 'SHORT'
      orderType: 'MARKET' | 'LIMIT'
      price?: number
      amountType: 'USDT' | 'PERCENTAGE'
      amount: number
      leverage: number
      password: string
    }) {
      try {
        this.isLoading = true
        this.error = null

        const response = await $fetch<ClosePositionResponse>('/api/bot/manual-open-position', {
          method: 'POST',
          body: params
        })
        
        if (response.success) {
          // 更新状态
          if (response.state) {
            this.state = response.state
          }
          return {
            success: true,
            message: response.message || '手动开仓成功'
          }
        } else {
          this.error = response.message || '手动开仓失败'
          return {
            success: false,
            message: response.message || '手动开仓失败'
          }
        }
      } catch (error: any) {
        this.error = error.message || '手动开仓时发生错误'
        return {
          success: false,
          message: '手动开仓时发生错误',
          error: error.message || String(error)
        }
      } finally {
        this.isLoading = false
      }
    },
  },
})
