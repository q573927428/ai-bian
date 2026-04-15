import { appendSimpleKLineData, getSimpleLastKLineTimestamp, updateLastKLine } from '../../utils/kline-simple-storage'
import type { KLineData, KLineTimeframe, KLineSyncConfig, TimeframeSyncConfig } from '../../../types/kline-simple'
import { DEFAULT_CONFIG } from '../../../types/kline-simple'
import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout
} from 'node:timers'

// Binance K线数据接口
interface BinanceKLine {
  timestamp: number
  open: string
  high: string
  low: string
  close: string
  volume: string
}

// 同步状态
interface SyncStatus {
  symbol: string
  timeframe: KLineTimeframe
  lastSyncTime: number
  lastSyncCount: number
  totalBars: number
  status: 'idle' | 'syncing' | 'error'
  error?: string
}

export class KLineSimpleSyncService {
  private config: KLineSyncConfig
  private syncStatus: Map<string, SyncStatus> = new Map()
  private syncIntervals: Map<KLineTimeframe, NodeJS.Timeout> = new Map()
  private lastSyncTimes: Map<KLineTimeframe, number> = new Map()
  private timeframeConfigs: Map<KLineTimeframe, TimeframeSyncConfig> = new Map()
  private isSyncing: Map<KLineTimeframe, boolean> = new Map() // 并发锁：防止同一周期同时执行多个同步

  constructor(config?: Partial<KLineSyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeTimeframeConfigs()
    this.initializeStatus()
    this.initializeLastSyncTimes()
  }

  // 初始化状态
  private initializeStatus(): void {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        const key = this.getStatusKey(symbol, timeframe)
        this.syncStatus.set(key, {
          symbol,
          timeframe,
          lastSyncTime: 0,
          lastSyncCount: 0,
          totalBars: 0,
          status: 'idle'
        })
      }
    }
  }

  // 初始化周期配置
  private initializeTimeframeConfigs(): void {
    this.timeframeConfigs.clear()
    
    // 如果有自定义的周期配置，使用它们
    if (this.config.timeframeConfigs && this.config.timeframeConfigs.length > 0) {
      for (const config of this.config.timeframeConfigs) {
        this.timeframeConfigs.set(config.timeframe, config)
      }
    } else {
      // 否则使用默认配置
      for (const timeframe of this.config.timeframes) {
        this.timeframeConfigs.set(timeframe, {
          timeframe,
          syncInterval: this.config.syncInterval, // 使用全局同步间隔
          enabled: true
        })
      }
    }
  }

  // 初始化最后同步时间
  private initializeLastSyncTimes(): void {
    for (const timeframe of this.config.timeframes) {
      this.lastSyncTimes.set(timeframe, 0)
    }
  }

  // 获取状态键
  private getStatusKey(symbol: string, timeframe: KLineTimeframe): string {
    return `${symbol}-${timeframe}`
  }

  // 更新状态
  private updateStatus(
    symbol: string, 
    timeframe: KLineTimeframe, 
    updates: Partial<SyncStatus>
  ): void {
    const key = this.getStatusKey(symbol, timeframe)
    const current = this.syncStatus.get(key)
    if (current) {
      this.syncStatus.set(key, { ...current, ...updates })
    }
  }

  // 获取时间间隔秒数
  private getIntervalSeconds(timeframe: KLineTimeframe): number {
    switch (timeframe) {
      case '15m': return 15 * 60
      case '1h': return 60 * 60
      case '4h': return 4 * 60 * 60
      case '1d': return 24 * 60 * 60
      case '1w': return 7 * 24 * 60 * 60
      default: return 60 * 60
    }
  }

  // 获取下一次同步的延迟时间（毫秒）
  private getNextSyncDelay(timeframe: KLineTimeframe, delaySeconds = 20): number {
    const now = Math.floor(Date.now() / 1000) // 当前时间戳（秒）
    
    const timeframeSecondsMap: Record<KLineTimeframe, number> = {
      '15m': 15 * 60,
      '1h': 60 * 60,
      '4h': 4 * 60 * 60,
      '1d': 24 * 60 * 60,
      '1w': 7 * 24 * 60 * 60
    }
    
    const tf = timeframeSecondsMap[timeframe]
    if (!tf) throw new Error(`不支持的周期: ${timeframe}`)
    
    // 向上取整到下一个周期
    const next = Math.ceil(now / tf) * tf
    
    // 延迟几秒，确保交易所K线已完成
    return (next + delaySeconds - now) * 1000 // 转换为毫秒
  }

  // 获取合约信息
  private async getSymbolInfo(symbol: string): Promise<{
    exists: boolean
    symbol: string
    status: string
    onboardDate: number
    onboardTimestamp: number
    baseAsset: string
    quoteAsset: string
  } | null> {
    try {
      const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      const symbolInfo = data.symbols.find((s: any) => s.symbol === symbol.replace('/', ''))
      
      if (!symbolInfo) {
        return null
      }
      
      return {
        exists: true,
        symbol: symbolInfo.symbol,
        status: symbolInfo.status,
        onboardDate: symbolInfo.onboardDate,
        onboardTimestamp: Math.floor(symbolInfo.onboardDate / 1000),
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset
      }
    } catch (error) {
      console.error(`获取合约信息失败: ${symbol}`, error)
      return null
    }
  }

  // 从Binance获取K线数据
  private async fetchKLineFromBinance(
    symbol: string, 
    timeframe: KLineTimeframe, 
    startTime?: number, 
    endTime?: number,
    limit: number = 1000
  ): Promise<KLineData[]> {
    try {
      // 构建请求URL
      const intervalMap: Record<KLineTimeframe, string> = {
        '15m': '15m',
        '1h': '1h',
        '4h': '4h',
        '1d': '1d',
        '1w': '1w'
      }
      
      const interval = intervalMap[timeframe]
      const binanceSymbol = symbol.replace('/', '')
      
      let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
      
      if (startTime) {
        url += `&startTime=${startTime}`
      }
      
      if (endTime) {
        url += `&endTime=${endTime}`
      }
      
      // 发送请求
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // 解析数据
      return data.map((item: any[]): KLineData => ({
        timestamp: Math.floor(item[0] / 1000), // 转换为秒
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5])
      }))
      
    } catch (error) {
      console.error(`从Binance获取K线数据失败: ${symbol}/${timeframe}`, error)
      throw error
    }
  }

  // 同步单个交易对的K线数据
  async syncSymbolKLine(
    symbol: string, 
    timeframe: KLineTimeframe, 
    options: {
      force?: boolean
      initialBars?: number
    } = {}
  ): Promise<{
    success: boolean
    message: string
    symbol: string
    timeframe: KLineTimeframe
    count: number
    newBars: number
  }> {
    const { force = false, initialBars = 1000 } = options
    const key = this.getStatusKey(symbol, timeframe)
    
    try {
      // 检查是否正在同步
      const currentStatus = this.syncStatus.get(key)
      if (currentStatus?.status === 'syncing' && !force) {
        return {
          success: false,
          message: '正在同步中，请稍后再试',
          symbol,
          timeframe,
          count: 0,
          newBars: 0
        }
      }
      
      // 更新状态为同步中
      this.updateStatus(symbol, timeframe, { status: 'syncing', error: undefined })
      
      // 获取最后一条数据的时间戳
      let lastTimestamp = getSimpleLastKLineTimestamp(symbol, timeframe)
      
      if (!lastTimestamp || force) {
        // 首次同步或强制同步，使用manualSyncHistory获取maxBars条数据
        console.log(`[首次同步] 开始获取历史数据: ${symbol}/${timeframe}`)
        const historyResult = await this.manualSyncHistory(symbol, timeframe, {
          totalBars: this.config.maxBars,
          batchSize: 1000
        })
        
        if (historyResult.success) {
          this.updateStatus(symbol, timeframe, { 
            status: 'idle', 
            lastSyncTime: Math.floor(Date.now() / 1000),
            lastSyncCount: historyResult.totalBars,
            totalBars: historyResult.totalBars
          })
          
          return {
            success: true,
            message: `首次同步成功，获取 ${historyResult.totalBars} 条数据`,
            symbol,
            timeframe,
            count: historyResult.totalBars,
            newBars: historyResult.totalBars
          }
        } else {
          throw new Error(`首次同步失败: ${historyResult.message}`)
        }
      } else {
        // 已经有数据，进行增量更新
        // 修复：不要使用 lastTimestamp + 1，直接使用 lastTimestamp
        // 这样可以确保获取到最后一根未收盘K线
        const startTime = lastTimestamp * 1000 // 转换为毫秒
        
        // 获取数据
        const klineData = await this.fetchKLineFromBinance(
          symbol, 
          timeframe, 
          startTime, 
          undefined, // endTime
          initialBars // limit
        )
        
        if (klineData.length === 0) {
          this.updateStatus(symbol, timeframe, { 
            status: 'idle', 
            lastSyncTime: Math.floor(Date.now() / 1000),
            lastSyncCount: 0
          })
          
          return {
            success: true,
            message: '没有新数据',
            symbol,
            timeframe,
            count: 0,
            newBars: 0
          }
        }
        
        // 分离数据：新K线和需要更新的最后一根K线
        let newBars: KLineData[] = []
        let updateBar: KLineData | null = null
        
        for (const item of klineData) {
          if (item.timestamp > lastTimestamp) {
            newBars.push(item) // 新K线
          } else if (item.timestamp === lastTimestamp) {
            updateBar = item // 未收盘K线（需要更新）
          }
        }
        
        let updatedCount = 0
        let appendedCount = 0
        
        // 1. 更新最后一根K线（如果存在未收盘K线）
        if (updateBar) {
          const updateSuccess = updateLastKLine(symbol, timeframe, updateBar)
          if (updateSuccess) {
            updatedCount = 1
            // console.log(`已更新最后一根未收盘K线: ${symbol}/${timeframe} 时间戳: ${updateBar.timestamp}`)
          }
        }
        
        // 2. 追加新K线
        if (newBars.length > 0) {
          const appendSuccess = appendSimpleKLineData(symbol, timeframe, newBars)
          if (!appendSuccess) {
            throw new Error('保存新K线数据失败')
          }
          appendedCount = newBars.length
        }
        
        const totalCount = updatedCount + appendedCount
        
        // 更新状态
        this.updateStatus(symbol, timeframe, { 
          status: 'idle', 
          lastSyncTime: Math.floor(Date.now() / 1000),
          lastSyncCount: totalCount,
          totalBars: (currentStatus?.totalBars || 0) + appendedCount
        })
        
        let message = ''
        if (updatedCount > 0 && appendedCount > 0) {
          message = `增量同步成功，更新 ${updatedCount} 条未收盘K线，追加 ${appendedCount} 条新K线`
        } else if (updatedCount > 0) {
          message = `增量同步成功，更新 ${updatedCount} 条未收盘K线`
        } else if (appendedCount > 0) {
          message = `增量同步成功，追加 ${appendedCount} 条新K线`
        } else {
          message = '没有新数据'
        }
        
        return {
          success: true,
          message,
          symbol,
          timeframe,
          count: totalCount,
          newBars: appendedCount
        }
      }
      
    } catch (error: any) {
      console.error(`同步K线数据失败: ${symbol}/${timeframe}`, error)
      
      this.updateStatus(symbol, timeframe, { 
        status: 'error', 
        error: error.message 
      })
      
      return {
        success: false,
        message: `同步失败: ${error.message}`,
        symbol,
        timeframe,
        count: 0,
        newBars: 0
      }
    }
  }

  // 同步所有配置的交易对和周期
  async syncAllKLine(options: { force?: boolean } = {}): Promise<Array<{
    success: boolean
    message: string
    symbol: string
    timeframe: KLineTimeframe
    count: number
  }>> {
    const { force = false } = options
    const results = []
    
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        try {
          const result = await this.syncSymbolKLine(symbol, timeframe, { force })
          results.push(result)
          
          // 避免请求过于频繁
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error: any) {
          results.push({
            success: false,
            message: `同步失败: ${error.message}`,
            symbol,
            timeframe,
            count: 0
          })
        }
      }
    }
    
    return results
  }


  // 手动同步历史数据（优化版，参考scripts/fetch-binance-history-fixed.cjs）
  async manualSyncHistory(
    symbol: string, 
    timeframe: KLineTimeframe, 
    options: {
      totalBars?: number
      batchSize?: number
      startTime?: number
      endTime?: number
    } = {}
  ): Promise<{
    success: boolean
    message: string
    symbol: string
    timeframe: KLineTimeframe
    totalBars: number
    batches: number
    duration?: number
    symbolInfo?: {
      onboardDate: number
      status: string
    }
  }> {
    const { totalBars = this.config.maxBars, batchSize = 1000, startTime, endTime } = options
    const startTimestamp = Date.now()
    
    try {
      // 1. 先获取合约信息，包括上线时间
      console.log(`[手动同步] 获取合约信息: ${symbol}`)
      const symbolInfo = await this.getSymbolInfo(symbol)
      
      if (!symbolInfo) {
        const message = `合约 ${symbol} 不存在`
        console.log(`[手动同步] ${message}`)
        return {
          success: false,
          message,
          symbol,
          timeframe,
          totalBars: 0,
          batches: 0
        }
      }
      
      // 2. 计算实际可获取的时间范围
      const now = Math.floor(Date.now() / 1000)
      const intervalSeconds = this.getIntervalSeconds(timeframe)
      const totalSeconds = totalBars * intervalSeconds
      
      // 合约上线时间（秒）
      const onboardTimestamp = symbolInfo.onboardTimestamp
      
      // 计算理论开始时间（从当前时间往前推）
      const theoreticalStartTimestamp = now - totalSeconds
      
      // 实际开始时间：取理论开始时间和上线时间的较大值（不能早于上线时间）
      const actualStartTimestamp = Math.max(theoreticalStartTimestamp, onboardTimestamp)
      
      // 3. 计算实际可获取的数据量
      const availableSeconds = now - actualStartTimestamp
      const maxAvailableBars = Math.floor(availableSeconds / intervalSeconds)
      const actualTargetBars = Math.min(totalBars, maxAvailableBars)
      
      if (actualTargetBars <= 0) {
        const message = `合约上线时间太短，无法获取任何数据`
        console.log(`[手动同步] ${message}`)
        return {
          success: false,
          message,
          symbol,
          timeframe,
          totalBars: 0,
          batches: 0,
          symbolInfo: {
            onboardDate: symbolInfo.onboardDate,
            status: symbolInfo.status
          }
        }
      }
      
      if (actualTargetBars < totalBars) {
        console.log(`[手动同步] 注意：合约上线时间较短，只能获取 ${actualTargetBars} 条数据（原目标: ${totalBars} 条）`)
      }
      
      // 4. 开始批量获取数据
      this.updateStatus(symbol, timeframe, { status: 'syncing', error: undefined })
      
      let currentStartTime = startTime || actualStartTimestamp
      let fetchedBars = 0
      let batches = 0
      const allData: KLineData[] = []
      let consecutiveEmptyBatches = 0
      const maxConsecutiveEmptyBatches = 3
      
      console.log(`[手动同步] 开始获取历史数据: ${symbol}/${timeframe}，目标: ${actualTargetBars} 条`)
      
      while (fetchedBars < actualTargetBars && consecutiveEmptyBatches < maxConsecutiveEmptyBatches) {
        const remaining = actualTargetBars - fetchedBars
        const currentBatchSize = Math.min(batchSize, remaining)
        
        // 计算结束时间（当前批次）
        const batchEndTime = currentStartTime + (currentBatchSize * intervalSeconds)
        
        try {
          const batchData = await this.fetchKLineFromBinance(
            symbol, 
            timeframe, 
            currentStartTime * 1000, // 转换为毫秒
            batchEndTime * 1000,     // 转换为毫秒
            currentBatchSize
          )
          
          if (batchData.length === 0) {
            consecutiveEmptyBatches++
            
            if (consecutiveEmptyBatches >= maxConsecutiveEmptyBatches) {
              console.log(`[手动同步] 连续 ${maxConsecutiveEmptyBatches} 个批次返回空数据，停止获取`)
              break
            }
            
            // 跳过一段时间继续尝试
            currentStartTime = batchEndTime + 1
          } else {
            consecutiveEmptyBatches = 0 // 重置连续空批次计数
            allData.push(...batchData)
            fetchedBars += batchData.length
            batches++
            
            // 每5个批次或最后一批显示进度
            if (batches % 5 === 0 || fetchedBars >= actualTargetBars) {
              const progress = Math.round((fetchedBars / actualTargetBars) * 100)
              console.log(`[手动同步] 进度: ${fetchedBars}/${actualTargetBars} (${progress}%)，批次: ${batches}`)
            }
            
            // 更新下一个批次的开始时间
            const lastItem = batchData[batchData.length - 1]
            if (lastItem) {
              currentStartTime = lastItem.timestamp + intervalSeconds
            } else {
              console.log('[手动同步] 批次数据异常，停止获取')
              break
            }
          }
        } catch (batchError: any) {
          console.log(`[手动同步] 批次 ${batches + 1} 获取失败: ${batchError.message}`)
          consecutiveEmptyBatches++
          
          if (consecutiveEmptyBatches >= maxConsecutiveEmptyBatches) {
            console.log(`[手动同步] 连续 ${maxConsecutiveEmptyBatches} 个批次失败，停止获取`)
            break
          }
          
          // 跳过一段时间继续尝试
          currentStartTime = batchEndTime + 1
        }
        
        // 避免请求过于频繁
        if (fetchedBars < actualTargetBars && consecutiveEmptyBatches < maxConsecutiveEmptyBatches) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }
      
      // 5. 保存所有数据
      if (allData.length > 0) {
        console.log(`[手动同步] 保存数据到文件...`)
        const success = appendSimpleKLineData(symbol, timeframe, allData)
        
        if (!success) {
          throw new Error('保存数据失败')
        }
        
        const endTimestamp = Date.now()
        const duration = (endTimestamp - startTimestamp) / 1000
        
        // 更新状态
        this.updateStatus(symbol, timeframe, { 
          status: 'idle', 
          lastSyncTime: Math.floor(Date.now() / 1000),
          lastSyncCount: allData.length,
          totalBars: allData.length
        })
        
        console.log(`[手动同步] 完成! 获取 ${allData.length} 条数据，${batches} 个批次，耗时 ${duration.toFixed(2)} 秒`)
        
        return {
          success: true,
          message: `手动同步完成，获取 ${allData.length} 条数据，共 ${batches} 个批次`,
          symbol,
          timeframe,
          totalBars: allData.length,
          batches,
          duration,
          symbolInfo: {
            onboardDate: symbolInfo.onboardDate,
            status: symbolInfo.status
          }
        }
      } else {
        const message = '没有获取到任何数据'
        console.log(`[手动同步] ${message}`)
        
        this.updateStatus(symbol, timeframe, { 
          status: 'idle', 
          lastSyncTime: Math.floor(Date.now() / 1000),
          lastSyncCount: 0
        })
        
        return {
          success: false,
          message,
          symbol,
          timeframe,
          totalBars: 0,
          batches: 0,
          duration: (Date.now() - startTimestamp) / 1000,
          symbolInfo: {
            onboardDate: symbolInfo.onboardDate,
            status: symbolInfo.status
          }
        }
      }
      
    } catch (error: any) {
      console.error(`[手动同步] 失败: ${symbol}/${timeframe}`, error)
      
      this.updateStatus(symbol, timeframe, { 
        status: 'error', 
        error: error.message 
      })
      
      const duration = (Date.now() - startTimestamp) / 1000
      
      return {
        success: false,
        message: `手动同步失败: ${error.message}`,
        symbol,
        timeframe,
        totalBars: 0,
        batches: 0,
        duration
      }
    }
  }

  // 开始定时同步（按周期调度）
  startAutoSync(): void {
    // 检查是否已经在运行
    if (this.syncIntervals.size > 0) {
      console.warn('定时同步已经在运行')
      return
    }
    
    console.log('🚀 开始按周期调度定时同步...')
    
    // 为每个周期创建独立的定时器
    for (const timeframe of this.config.timeframes) {
      this.startTimeframeSync(timeframe)
    }
  }

  // 开始特定周期的定时同步（使用递归调度，对齐K线周期时间点）
  private startTimeframeSync(timeframe: KLineTimeframe): void {
    // 如果已经有定时器，先清除
    if (this.syncIntervals.has(timeframe)) {
      this.stopTimeframeSync(timeframe)
    }
    
    // 获取周期配置
    const config = this.timeframeConfigs.get(timeframe)
    if (!config || !config.enabled) {
      console.log(`⏭️  ${timeframe} 周期同步已禁用，跳过`)
      return
    }
    
    // 递归调度函数
    const scheduleNext = () => {
      // 计算下一次同步的延迟
      const delay = this.getNextSyncDelay(timeframe)
      
      console.log(`⏰ ${timeframe} 下一次同步 ${delay / 1000}s 后`)
      
      const timeout = nodeSetTimeout(async () => {
        try {
          await this.syncTimeframe(timeframe)
        } catch (error) {
          // 错误已经在syncTimeframe中处理，这里只确保继续调度
          console.error(`${timeframe} 周期同步失败:`, error)
        } finally {
          // 无论成功失败，都调度下一次（等待下一个周期）
          scheduleNext()
        }
      }, delay)
      
      this.syncIntervals.set(timeframe, timeout as unknown as NodeJS.Timeout)
    }
    
    // 开始调度
    scheduleNext()
    
    // 立即执行一次同步（可选）
    nodeSetTimeout(async () => {
      try {
        await this.syncTimeframe(timeframe)
      } catch (error) {
        console.error(`${timeframe} 周期初始同步失败:`, error)
      }
    }, 1000) // 延迟1秒开始，避免同时启动所有周期
  }

  // 同步特定周期的所有交易对（带并发锁和超时保护）
  private async syncTimeframe(timeframe: KLineTimeframe): Promise<void> {
    const config = this.timeframeConfigs.get(timeframe)
    if (!config || !config.enabled) {
      return
    }
    
    // 并发锁检查：防止同一周期同时执行多个同步
    if (this.isSyncing.get(timeframe)) {
      // 减少日志：只在调试时记录
      // console.log(`⏭️  ${timeframe} 周期正在同步中，跳过本次`)
      return
    }
    
    try {
      // 设置并发锁
      this.isSyncing.set(timeframe, true)
      
      const now = Math.floor(Date.now() / 1000)
      this.lastSyncTimes.set(timeframe, now)
      
      // 设置超时保护：统一5分钟（300000毫秒）
      const timeoutPromise = new Promise((_, reject) => {
        nodeSetTimeout(() => reject(new Error(`同步超时: ${timeframe} (超过5分钟)`)), 5 * 60 * 1000)
      })
      
      // 执行同步任务，带超时保护
      await Promise.race([
        this.executeSyncTimeframe(timeframe),
        timeoutPromise
      ])
      
    } catch (error: any) {
      // 减少日志：只记录错误，不记录跳过信息
      if (!error.message.includes('正在同步中')) {
        console.error(`${timeframe} 周期同步失败:`, error.message)
      }
    } finally {
      // 清除并发锁（确保即使出错也能清除）
      this.isSyncing.set(timeframe, false)
    }
  }

  // 实际执行同步任务的私有方法（被syncTimeframe调用）
  private async executeSyncTimeframe(timeframe: KLineTimeframe): Promise<void> {
    const config = this.timeframeConfigs.get(timeframe)
    if (!config || !config.enabled) {
      return
    }
    
    // console.log(`📊 开始同步 ${timeframe} 周期数据...`)
    
    const results = []
    for (const symbol of this.config.symbols) {
      try {
        const result = await this.syncSymbolKLine(symbol, timeframe, { force: false })
        results.push(result)
        
        // 避免请求过于频繁
        await new Promise(resolve => nodeSetTimeout(resolve, 100))
      } catch (error: any) {
        results.push({
          success: false,
          message: `同步失败: ${error.message}`,
          symbol,
          timeframe,
          count: 0
        })
      }
    }
    
    const successCount = results.filter(r => r.success).length
    const totalCount = results.reduce((sum, r) => sum + r.count, 0)
    
    console.log(`✅ ${timeframe} 周期同步完成: ${successCount}/${results.length} 成功，共获取 ${totalCount} 条数据`)
  }

  // 停止特定周期的定时同步
  private stopTimeframeSync(timeframe: KLineTimeframe): void {
    const timeout = this.syncIntervals.get(timeframe)
    if (timeout) {
      nodeClearTimeout(timeout)
      this.syncIntervals.delete(timeframe)
      console.log(`🛑 已停止 ${timeframe} 周期同步`)
    }
  }

  // 停止定时同步
  stopAutoSync(): void {
    if (this.syncIntervals.size === 0) {
      return
    }
    
    console.log('🛑 停止所有周期定时同步...')
    
    // 停止所有周期的定时器
    for (const timeframe of Array.from(this.syncIntervals.keys())) {
      this.stopTimeframeSync(timeframe)
    }
    
    console.log('✅ 所有周期定时同步已停止')
  }

  // 获取同步状态
  getSyncStatus(): SyncStatus[] {
    return Array.from(this.syncStatus.values())
  }

  // 获取特定交易对和周期的状态
  getSymbolSyncStatus(symbol: string, timeframe: KLineTimeframe): SyncStatus | null {
    const key = this.getStatusKey(symbol, timeframe)
    return this.syncStatus.get(key) || null
  }

  // 获取配置
  getConfig(): KLineSyncConfig {
    return { ...this.config }
  }

  // 更新配置
  updateConfig(newConfig: Partial<KLineSyncConfig>): void {
    this.config = { ...this.config, ...newConfig }
    
    // 重新初始化状态
    this.initializeTimeframeConfigs()
    this.initializeStatus()
    this.initializeLastSyncTimes()
    
    // 如果定时同步在运行，重启它
    if (this.syncIntervals.size > 0) {
      this.stopAutoSync()
      this.startAutoSync()
    }
  }
}