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
    state: null as {
      isRunning: boolean
      runningStrategies: string[]
      totalStrategies: number
      activeStrategies: number
      currentPositions: number
    } | null,
    statusConfig: null as {
      strategies: any[]
    } | null,
    botConfig: null as BotConfig | null,
    logs: [] as LogEntry[],
    cryptoBalances: [] as CryptoBalance[],
    isLoading: false,
    error: null as string | null,
    
    // 共享轮询管理
    pollingSubscribers: new Map<string, () => void>(), // 改为Map，存储订阅者ID和回调函数
    pollingTimer: null as NodeJS.Timeout | null,
    isPollingActive: false,

    // 共享价格管理
    prices: {} as Record<string, any>, // 存储所有交易对的价格数据
    priceSubscribers: new Set<string>(), // 价格订阅者
    priceTimer: null as NodeJS.Timeout | null,
    lastPriceUpdate: 0,
  }),

  getters: {
    isRunning: (state) => {
      return state.state?.isRunning || false
    },
    hasPosition: (state) => {
      return (state.state?.currentPositions || 0) > 0
    },
    isHalted: () => {
      return false
    },
    // 兼容旧代码，返回 botConfig 如果可用，否则返回 statusConfig
    config: (state) => {
      return (state.botConfig || state.statusConfig) as any
    },
  },

  actions: {
    // ========== 共享价格管理 ==========

    // 获取需要订阅的所有交易对
    getPriceSymbols() {
      const symbols = new Set<string>()

      // 从配置中获取所有交易对
      if (this.botConfig?.symbols && Array.isArray(this.botConfig.symbols)) {
        this.botConfig.symbols.forEach((symbol: string) => {
          symbols.add(symbol.replace('/', ''))
        })
      }

      return Array.from(symbols)
    },

    // 获取价格数据
    async fetchPrices() {
      const symbols = this.getPriceSymbols()
      if (symbols.length === 0) return

      try {
        const response = await $fetch<any>('/api/websocket/prices', {
          params: { symbols: symbols.join(',') }
        })

        if (response.success && response.data?.prices) {
          this.prices = response.data.prices
          this.lastPriceUpdate = Date.now()
        }
      } catch (error) {
        console.error('[Price] 获取价格失败:', error)
      }
    },

    // 订阅价格更新
    subscribeToPrices(subscriberId: string) {
      this.priceSubscribers.add(subscriberId)

      if (this.priceSubscribers.size === 1 && !this.priceTimer) {
        this.startPricePolling()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 加入，当前订阅者: ${this.priceSubscribers.size}`)

      // 立即获取一次价格
      if (Object.keys(this.prices).length === 0) {
        this.fetchPrices()
      }
    },

    // 取消订阅价格更新
    unsubscribeFromPrices(subscriberId: string) {
      this.priceSubscribers.delete(subscriberId)

      if (this.priceSubscribers.size === 0 && this.priceTimer) {
        this.stopPricePolling()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 离开，当前订阅者: ${this.priceSubscribers.size}`)
    },

    // 启动价格轮询
    startPricePolling() {
      if (this.priceTimer) {
        return
      }

      console.log('[Price] 启动共享价格轮询，间隔: 5000ms')

      this.priceTimer = setInterval(() => {
        this.fetchPrices()
      }, 5000)

      // 立即执行一次
      this.fetchPrices()
    },

    // 停止价格轮询
    stopPricePolling() {
      if (this.priceTimer) {
        clearInterval(this.priceTimer)
        this.priceTimer = null
        console.log('[Price] 停止共享价格轮询')
      }
    },

    // 获取单个交易对的价格
    getPrice(symbol: string) {
      return this.prices[symbol] || null
    },

    // 获取所有价格
    getAllPrices() {
      return this.prices
    },

    // ========== 状态管理 ==========

    async fetchStatus() {
      try {
        this.isLoading = true
        this.error = null

        // 同时获取 bot 配置
        this.fetchBotConfig()

        const response = await $fetch<StatusResponse>('/api/bot/status')
        
        if (response.success) {
          this.state = response.data!.state
          this.statusConfig = response.data!.config
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

    async fetchBotConfig() {
      try {
        const response = await $fetch<{ success: boolean, data: BotConfig }>('/api/bot/config')
        if (response.success) {
          this.botConfig = response.data
        }
      } catch (error) {
        console.error('获取 bot config 失败:', error)
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
