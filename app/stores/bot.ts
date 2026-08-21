import { defineStore } from 'pinia'
import { markRaw } from 'vue'
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
    priceStream: null as EventSource | null,
    priceFallbackTimer: null as ReturnType<typeof setInterval> | null,
    priceConnectionStatus: 'disconnected' as 'connecting' | 'connected' | 'disconnected',
    priceStreamError: null as string | null,
    lastPriceUpdate: 0,
    lastPriceEventAt: 0,

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
      if (!this.botConfig) {
        await this.fetchBotConfig()
      }
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

      if (this.priceSubscribers.size === 1 && !this.priceStream) {
        await this.startPriceStream()
      } else if (Object.keys(this.prices).length === 0) {
        void this.fetchPrices()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 加入，当前订阅者: ${this.priceSubscribers.size}`)
    },

    // 取消订阅价格更新
    async unsubscribeFromPrices(subscriberId: string) {
      this.priceSubscribers.delete(subscriberId)

      if (this.priceSubscribers.size === 0) {
        this.stopPriceStream()
      }

      console.log(`[Price] 订阅者 ${subscriberId} 离开，当前订阅者: ${this.priceSubscribers.size}`)
    },

    /**
     * 启动当前标签页唯一的 SSE 实时价格连接。
     */
    async startPriceStream() {
      if (!import.meta.client || this.priceStream) return
      if (!this.botConfig) await this.fetchBotConfig()
      // 配置请求返回前页面可能已经卸载，避免在没有消费者时补建一条孤立连接。
      if (this.priceSubscribers.size === 0 || this.priceStream) return

      this.priceConnectionStatus = 'connecting'
      this.priceStreamError = null
      const stream = markRaw(new EventSource('/api/market/prices/stream'))
      this.priceStream = stream

      stream.onopen = () => {
        this.priceConnectionStatus = 'connected'
        this.priceStreamError = null
        this.lastPriceEventAt = Date.now()
      }

      stream.addEventListener('snapshot', (event) => {
        this.handlePriceStreamEvent('snapshot', event as MessageEvent<string>)
      })
      stream.addEventListener('prices', (event) => {
        this.handlePriceStreamEvent('prices', event as MessageEvent<string>)
      })
      stream.addEventListener('status', (event) => {
        this.handlePriceStreamEvent('status', event as MessageEvent<string>)
      })
      stream.addEventListener('ping', (event) => {
        this.handlePriceStreamEvent('ping', event as MessageEvent<string>)
      })

      stream.onerror = () => {
        // EventSource 会自动重连；Store 只标记状态并让快照兜底监控接管陈旧数据。
        this.priceConnectionStatus = 'disconnected'
        this.priceStreamError = '实时价格连接中断，正在自动重连'
      }

      this.startPriceFallbackMonitor()
    },

    /** 解析 SSE 事件并按事件类型更新共享价格状态。 */
    handlePriceStreamEvent(eventName: 'snapshot' | 'prices' | 'status' | 'ping', event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(event.data || '{}')
        this.lastPriceEventAt = Date.now()

        if (eventName === 'snapshot' && payload.prices) {
          this.prices = { ...payload.prices }
          if (Object.keys(payload.prices).length > 0) this.lastPriceUpdate = Date.now()
          return
        }

        if (eventName === 'prices' && payload.prices) {
          this.prices = { ...this.prices, ...payload.prices }
          this.lastPriceUpdate = Date.now()
          return
        }

        if (eventName === 'status' && payload.status?.status) {
          this.priceConnectionStatus = payload.status.status === 'CONNECTED'
            ? 'connected'
            : 'connecting'
        }
      } catch (error) {
        console.error(`[Price] 解析 SSE ${eventName} 事件失败:`, error)
      }
    },

    /**
     * SSE 长时间没有价格时低频拉取一次内存快照，避免网络半开导致页面永久陈旧。
     */
    startPriceFallbackMonitor() {
      if (this.priceFallbackTimer) return
      this.priceFallbackTimer = setInterval(() => {
        const priceIsStale = !this.lastPriceUpdate || Date.now() - this.lastPriceUpdate > 10_000
        if (priceIsStale) void this.fetchPrices()
      }, 10_000)
    },

    /** 关闭当前标签页的 SSE 与断线兜底监控。 */
    stopPriceStream() {
      if (this.priceStream) {
        this.priceStream.close()
        this.priceStream = null
      }
      if (this.priceFallbackTimer) {
        clearInterval(this.priceFallbackTimer)
        this.priceFallbackTimer = null
      }
      this.priceConnectionStatus = 'disconnected'
    },

    // 页面关闭/刷新时同步关闭 SSE，服务端会通过连接关闭事件释放客户端引用。
    cleanupOnUnload() {
      this.stopPriceStream()
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
