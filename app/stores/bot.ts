import { defineStore } from 'pinia'
import type { 
  BotState,
  BotConfig, 
  LogEntry,
  CryptoBalance,
  StatusResponse
} from '../../types'

export const useBotStore = defineStore('bot', {
  state: () => ({
    state: null as BotState | null,
    config: null as BotConfig | null,
    logs: [] as LogEntry[],
    cryptoBalances: [] as CryptoBalance[],
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
      return state.state?.status === 'POSITION'
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
      
      // 使用默认60秒作为轮询间隔
      const pollInterval = 60 * 1000
      
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

  },
})
