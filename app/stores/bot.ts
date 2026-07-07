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

    // 性能与限流状态
    rateLimit: null as any | null,
    performance: null as any | null,
    performanceLoading: false,
    rateLimitLoading: false,
    performanceError: null as string | null,
    rateLimitError: null as string | null,
    
    // 共享轮询管理
    pollingSubscribers: new Map<string, () => void>(), // 改为Map，存储订阅者ID和回调函数
    pollingTimer: null as NodeJS.Timeout | null,
    isPollingActive: false,

    // 共享价格管理
    prices: {} as Record<string, any>, // 存储所有交易对的价格数据
    priceSubscribers: new Set<string>(), // 价格订阅者
    priceTimer: null as NodeJS.Timeout | null,
    lastPriceUpdate: 0,
    priceClientId: null as string | null, // WebSocket 客户端 ID（页面刷新时从sessionStorage恢复）
    subscribedSymbols: [] as string[], // 已订阅的交易对列表

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
    async subscribeToPrices(subscriberId: string) {
      this.priceSubscribers.add(subscriberId)

      if (this.priceSubscribers.size === 1 && !this.priceTimer) {
        this.startPricePolling()
      } else if (Object.keys(this.prices).length === 0) {
        // 仅当价格数据为空且轮询未启动时才立即获取一次
        this.fetchPrices()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 加入，当前订阅者: ${this.priceSubscribers.size}`)
    },

    // 取消订阅价格更新
    async unsubscribeFromPrices(subscriberId: string) {
      this.priceSubscribers.delete(subscriberId)

      if (this.priceSubscribers.size === 0 && this.priceTimer) {
        await this.stopPricePolling()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 离开，当前订阅者: ${this.priceSubscribers.size}`)
    },

    // 订阅 WebSocket 交易对
    async subscribeWebSocketSymbols() {
      // 如果没有配置，先获取配置
      if (!this.botConfig) {
        await this.fetchBotConfig()
      }

      const symbols = this.getPriceSymbols()
      if (symbols.length === 0) return

      // 尝试从 sessionStorage 恢复 clientId（页面刷新后保持同一客户端身份）
      if (!this.priceClientId && typeof sessionStorage !== 'undefined') {
        const savedClientId = sessionStorage.getItem('ws_price_client_id')
        if (savedClientId) {
          this.priceClientId = savedClientId
        }
      }

      // 检查是否需要重新订阅（交易对列表变化）
      const needsResubscribe = 
        symbols.length !== this.subscribedSymbols.length ||
        symbols.some(s => !this.subscribedSymbols.includes(s))

      if (!needsResubscribe && this.priceClientId) {
        return // 已经订阅过相同的交易对
      }

      try {
        console.log('[Price] 订阅 WebSocket 交易对:', symbols)
        
        const response = await $fetch<any>('/api/websocket/subscribe', {
          method: 'POST',
          body: {
            symbols,
            clientId: this.priceClientId || undefined
          }
        })

        if (response.success && response.data) {
          this.priceClientId = response.data.clientId
          this.subscribedSymbols = symbols
          
          // 持久化 clientId 到 sessionStorage（页面刷新后恢复）
          if (typeof sessionStorage !== 'undefined' && this.priceClientId) {
            sessionStorage.setItem('ws_price_client_id', this.priceClientId)
          }
          
          // 立即获取一次价格
          if (response.data.currentPrices) {
            this.prices = response.data.currentPrices
            this.lastPriceUpdate = Date.now()
          }
          
          console.log('[Price] WebSocket 订阅成功, clientId:', this.priceClientId)
        }
      } catch (error) {
        console.error('[Price] WebSocket 订阅失败:', error)
      }
    },


    // 取消订阅 WebSocket 交易对
    async unsubscribeWebSocketSymbols() {
      if (!this.priceClientId || this.subscribedSymbols.length === 0) {
        return
      }

      try {
        console.log('[Price] 取消订阅 WebSocket 交易对:', this.subscribedSymbols)
        
        await $fetch<any>('/api/websocket/unsubscribe', {
          method: 'POST',
          body: {
            symbols: this.subscribedSymbols,
            clientId: this.priceClientId
          }
        })

        this.subscribedSymbols = []
        console.log('[Price] WebSocket 取消订阅成功')
      } catch (error) {
        console.error('[Price] WebSocket 取消订阅失败:', error)
      }
    },

    // 启动价格轮询
    async startPricePolling() {
      if (this.priceTimer) {
        return
      }

      console.log('[Price] 启动共享价格轮询，间隔: 5000ms')

      // 先订阅 WebSocket 交易对
      await this.subscribeWebSocketSymbols()

      this.priceTimer = setInterval(async () => {
        // 检查是否需要重新订阅
        await this.subscribeWebSocketSymbols()
        await this.fetchPrices()
      }, 5000)

      // 立即执行一次
      await this.fetchPrices()
    },

    // 停止价格轮询
    async stopPricePolling() {
      if (this.priceTimer) {
        clearInterval(this.priceTimer)
        this.priceTimer = null
        console.log('[Price] 停止共享价格轮询')
      }

      // 取消 WebSocket 订阅
      await this.unsubscribeWebSocketSymbols()
    },

    // 页面卸载时清理 WebSocket 订阅
    cleanupOnUnload() {
      if (!this.priceClientId || this.subscribedSymbols.length === 0) return
      try {
        $fetch('/api/websocket/unsubscribe', {
          method: 'POST',
          body: {
            symbols: this.subscribedSymbols,
            clientId: this.priceClientId
          }
        })
      } catch (error) {
        console.error('[Price] 页面卸载取消订阅失败:', error)
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

    // ========== 限流与性能状态 ==========

    async fetchRateLimit() {
      try {
        this.rateLimitLoading = true
        this.rateLimitError = null
        const response = await $fetch<any>('/api/bot/rate-limit')
        if (response.success) {
          this.rateLimit = response.data
        } else {
          this.rateLimitError = response.message || '获取限流状态失败'
        }
      } catch (error: any) {
        this.rateLimitError = error.message || '获取限流状态失败'
      } finally {
        this.rateLimitLoading = false
      }
    },

    async fetchPerformance() {
      try {
        this.performanceLoading = true
        this.performanceError = null
        const response = await $fetch<any>('/api/bot/performance')
        if (response.success) {
          this.performance = response.data
        } else {
          this.performanceError = response.message || '获取性能状态失败'
        }
      } catch (error: any) {
        this.performanceError = error.message || '获取性能状态失败'
      } finally {
        this.performanceLoading = false
      }
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
