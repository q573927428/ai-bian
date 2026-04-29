// 市场数据管理器 - 负责全市场数据的获取、缓存、更新
import fs from 'fs'
import path from 'path'
import type {
  MarketSymbolData,
  SquareHeatData,
} from '../../../types/market-board'
import { rateLimiter } from '../../utils/rate-limiter'

// 缓存文件路径
const CACHE_FILE = path.resolve(process.cwd(), 'data', 'market-cache.json')

// 缓存数据结构
interface FileCache {
  symbolData: Record<string, MarketSymbolData>
  lastUpdated: number
}

const REST_BASE = 'https://fapi.binance.com'

export class MarketDataManager {
  private static instance: MarketDataManager

  // 数据缓存
  private symbolData: Map<string, MarketSymbolData> = new Map()

  // 记录每个 baseAsset 最后更新热度的时间
  private heatLastUpdated: Map<string, number> = new Map()

  // 定时任务
  private tickerUpdateTimer: NodeJS.Timeout | null = null
  private fundingRateTimer: NodeJS.Timeout | null = null
  private openInterestTimer: NodeJS.Timeout | null = null
  private squareHeatTimer: NodeJS.Timeout | null = null
  private cacheCleanTimer: NodeJS.Timeout | null = null
  private cacheSaveTimer: NodeJS.Timeout | null = null

  private isInitialized: boolean = false

  private initPromise: Promise<void> | null = null

  private constructor() {}

  static getInstance(): MarketDataManager {
    if (!MarketDataManager.instance) {
      MarketDataManager.instance = new MarketDataManager()
    }
    return MarketDataManager.instance
  }

  /**
   * 初始化管理器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInitialize()

    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  /**
   * 实际执行初始化的内部方法
   */
  private async doInitialize(): Promise<void> {
    console.log('[MarketDataManager] 初始化...')

    try {
      // 1. 尝试从本地文件加载缓存
      const loadedFromCache = this.loadFromCache()

      // 2. 没有缓存时初始化基础市场数据
      if (!loadedFromCache) {
        await this.fetchSymbolInfo()
      } else {
        console.log('[MarketDataManager] 从本地缓存加载数据成功')
      }

      // 3. 启动定时任务
      this.startScheduledTasks()

      // 4. 后台异步更新数据（不阻塞启动）
      this.fetchAllFundingRates().catch((err) => {
        console.error('[MarketDataManager] 后台更新资金费率失败:', err)
      })

      this.fetchAllOpenInterest().catch((err) => {
        console.error('[MarketDataManager] 后台更新未平仓量失败:', err)
      })

      this.updateAllSquareHeat().catch((err) => {
        console.error('[MarketDataManager] 后台更新广场热度失败:', err)
      })

      // 5. 保存缓存
      this.saveToCache().catch(console.error)

      this.isInitialized = true

      console.log('[MarketDataManager] 初始化完成')
    } catch (error) {
      console.error('[MarketDataManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 断开连接并清理
   */
  destroy(): void {
    // 销毁前保存缓存
    if (this.cacheSaveTimer) clearInterval(this.cacheSaveTimer)
    this.cacheSaveTimer = null
        

    this.stopScheduledTasks()
    this.symbolData.clear()
    this.heatLastUpdated.clear()
    this.isInitialized = false
    this.initPromise = null
  }

  /**
   * 获取所有交易对数据
   */
  async getAllSymbolsData(): Promise<MarketSymbolData[]> {
    return Array.from(this.symbolData.values())
  }

  /**
   * 获取单个交易对数据
   */
  getSymbolData(symbol: string): MarketSymbolData | undefined {
    return this.symbolData.get(symbol)
  }


  /**
   * 获取币安广场热度
   */
  async getSquareHeat(symbol: string): Promise<SquareHeatData | null> {
    const baseAsset = symbol.replace(/USDT$/, '')

    // 检查是否需要更新
    const lastUpdated = this.heatLastUpdated.get(baseAsset)
    if (lastUpdated && lastUpdated > Date.now() - 30 * 60 * 1000) {
      // 从 symbolData 中获取已有数据
      const symbolData = this.symbolData.get(symbol)
      if (symbolData) {
        return {
          symbol: baseAsset,
          heat: symbolData.squareHeat,
          postCount: symbolData.squarePostCount,
          lastUpdated,
        }
      }
    }

    await rateLimiter.acquire(1)
    try {
      const heatData = await this.fetchSquareHeat(baseAsset)

      // 更新所有相同 baseAsset 的交易对
      for (const [sym, data] of this.symbolData) {
        if (data.baseAsset === baseAsset) {
          data.squareHeat = heatData.heat
          data.squarePostCount = heatData.postCount
        }
      }

      this.heatLastUpdated.set(baseAsset, heatData.lastUpdated)
      return heatData
    } catch (error) {
      console.error(`[MarketDataManager] 获取 ${symbol} 广场热度失败:`, error)
      return null
    }
  }

  // ========== 私有方法 ==========

  /**
   * 定期更新 ticker 数据（通过 REST API）
   */
  private async updateTickers(): Promise<void> {
    try {
      await rateLimiter.acquire(1)
      const response = await fetch(`${REST_BASE}/fapi/v1/ticker/24hr`)
      const tickers = await response.json()
      
      if (Array.isArray(tickers)) {
        this.processRestTickers(tickers)
      }
    } catch (error) {
      console.error('[MarketDataManager] 更新 ticker 数据失败:', error)
    }
  }

  /**
   * 处理 REST API 的 ticker 数据
   */
  private processRestTickers(tickers: any[]): void {
    const now = Date.now()

    for (const ticker of tickers) {
      const symbol = ticker.symbol

      if (!symbol.endsWith('USDT')) {
        continue
      }

      const currentPrice = parseFloat(ticker.lastPrice)
      const priceChange24h = parseFloat(ticker.priceChange)
      const priceChangePercent24h = parseFloat(ticker.priceChangePercent)
      const volume24h = parseFloat(ticker.volume)
      const quoteVolume24h = parseFloat(ticker.quoteVolume)

      const existing = this.symbolData.get(symbol)

      if (existing) {
        // 原地更新已有对象
        existing.currentPrice = currentPrice
        existing.priceChange = priceChange24h
        existing.priceChangePercent = priceChangePercent24h
        existing.volume = volume24h
        existing.quoteVolume = quoteVolume24h
        // 更新依赖于 currentPrice 的字段
        existing.openInterestValue = existing.openInterest * currentPrice
        existing.marketCapEstimate = existing.openInterest * currentPrice
        existing.lastUpdated = now
      } else {
        // 新交易对才创建新对象
        const baseAsset = symbol.replace(/USDT$/, '')
        this.symbolData.set(symbol, {
          symbol,
          baseAsset: baseAsset,
          quoteAsset: 'USDT',
          currentPrice,
          priceChange: priceChange24h,
          priceChangePercent: priceChangePercent24h,
          volume: volume24h,
          quoteVolume: quoteVolume24h,
          openInterest: 0,
          openInterestValue: 0,
          marketCapEstimate: 0,
          fundingRate: 0,
          nextFundingTime: 0,
          squareHeat: 0,
          squarePostCount: 0,
          lastUpdated: now,
        })
      }
    }
  }

  /**
   * 获取交易对列表并初始化
   */
  private async fetchSymbolInfo(): Promise<void> {
    await rateLimiter.acquire(1)
    try {
      const [exchangeInfoResponse, tickerResponse] = await Promise.all([
        fetch(`${REST_BASE}/fapi/v1/exchangeInfo`),
        fetch(`${REST_BASE}/fapi/v1/ticker/24hr`)
      ])

      const exchangeInfoData = await exchangeInfoResponse.json()
      const tickerData = await tickerResponse.json()

      // 过滤出 USDT 永续合约
      const validSymbols = new Set(
        exchangeInfoData.symbols
          .filter(
            (s: any) =>
              s.contractType === 'PERPETUAL' &&
              s.status === 'TRADING' &&
              s.symbol.endsWith('USDT'),
          )
          .map((s: any) => s.symbol),
      )

      const now = Date.now()

      for (const ticker of tickerData) {
        const symbol = ticker.symbol
        if (!symbol.endsWith('USDT')) continue
        if (!validSymbols.has(symbol)) continue

        const currentPrice = parseFloat(ticker.lastPrice)
        const priceChange24h = parseFloat(ticker.priceChange)
        const priceChangePercent24h = parseFloat(ticker.priceChangePercent)
        const volume24h = parseFloat(ticker.volume)
        const quoteVolume24h = parseFloat(ticker.quoteVolume)

        this.symbolData.set(symbol, {
          symbol,
          baseAsset: symbol.replace(/USDT$/, ''),
          quoteAsset: 'USDT',

          currentPrice,
          priceChange: priceChange24h,
          priceChangePercent: priceChangePercent24h,

          volume: volume24h,
          quoteVolume: quoteVolume24h,

          openInterest: 0,
          openInterestValue: 0,
          marketCapEstimate: 0,

          fundingRate: 0,
          nextFundingTime: 0,

          squareHeat: 0,
          squarePostCount: 0,

          lastUpdated: now,
        })
      }

      console.log(`[MarketDataManager] 初始加载 ${this.symbolData.size} 个USDT永续合约`)
    } catch (error) {
      console.error('[MarketDataManager] 获取交易对列表失败:', error)
      throw error
    }
  }

  /**
   * 获取所有交易对资金费率
   */
  private async fetchAllFundingRates(): Promise<void> {
    await rateLimiter.acquire(1)
    try {
      const response = await fetch(`${REST_BASE}/fapi/v1/premiumIndex`)
      const data = await response.json()

      for (const item of data) {
        const symbolData = this.symbolData.get(item.symbol)
        if (symbolData) {
          symbolData.fundingRate = parseFloat(item.lastFundingRate) * 100
          symbolData.nextFundingTime = item.nextFundingTime || 0
          symbolData.lastUpdated = Date.now()
        }
      }

      console.log('[MarketDataManager] 资金费率更新完成')
    } catch (error) {
      console.error('[MarketDataManager] 获取资金费率失败:', error)
    }
  }

  /**
   * 获取所有交易对未平仓合约量（分批）
   */
  private async fetchAllOpenInterest(): Promise<void> {
    const batchSize = 20
    const symbols = Array.from(this.symbolData.keys())

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize)

      await rateLimiter.acquire(batchSize) // 单次请求 batchSize weight
      try {
        const promises = batch.map((symbol: string) => this.fetchSingleOpenInterest(symbol))
        await Promise.allSettled(promises)

        // 避免请求过快
        await new Promise((r) => setTimeout(r, 200))
      } catch (error) {
        console.error('[MarketDataManager] 获取未平仓合约量批次失败:', error)
    }
    }

    console.log('[MarketDataManager] 未平仓合约量更新完成')
  }

  /**
   * 获取单个交易对未平仓合约量
   */
  private async fetchSingleOpenInterest(symbol: string): Promise<void> {
    try {
      const response = await fetch(`${REST_BASE}/fapi/v1/openInterest?symbol=${symbol}`)
      const data = await response.json()

      const symbolData = this.symbolData.get(symbol)
      if (symbolData) {
        const oi = parseFloat(data.openInterest)
        symbolData.openInterest = oi
        symbolData.openInterestValue = oi * symbolData.currentPrice
        symbolData.marketCapEstimate = oi * symbolData.currentPrice
      }
    } catch (error) {
      // 单个失败不影响整体
    }
  }

  /**
   * 获取币安广场热度
   */
  private async fetchSquareHeat(baseAsset: string): Promise<SquareHeatData> {
    try {
      // 币安广场 hashtag API
      const url = `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?hashtag=%23${baseAsset}&pageIndex=1&pageSize=1`
  
      const res = await fetch(url)
      const hashtag = (await res.json())?.data?.hashtag || {}
  
      // 总帖子 / 7天帖子 / 浏览量
      const total = Number(hashtag.contentCount || 0)
      const recent = Number(hashtag.contentCount7days || 0)
      const views = Number(hashtag.viewCount || 0)
  
      // 计算近期活跃度比率 (7天帖子 / 总帖子)，避免除零
      const activityRatio = total > 0 ? Math.min(1, recent / total) : 0
  
      // 新热度公式：
      // 7天帖子权重50% + 活跃度比率30% + 浏览量20%
      const raw =
        Math.log10(recent + 1) * 0.52 +
        activityRatio * 0.38 +
        Math.log10(views + 1) * 0.1
  
      /**
       * 归一化：
       * 4 作为当前市场顶级热度基准 基本能接近 90~100
       */
      const heat = Math.min(
        100,
        Number(((raw / 3.5) * 100).toFixed(1)),
      )
  
      return {
        symbol: baseAsset,
        heat,
        postCount: recent,
        lastUpdated: Date.now(),
      }
    } catch {
      return {
        symbol: baseAsset,
        heat: 0,
        postCount: 0,
        lastUpdated: Date.now(),
      }
    }
  }


  /**
   * 更新所有交易对广场热度（后台任务）
   */
  private async updateAllSquareHeat(): Promise<void> {
    const symbols = Array.from(this.symbolData.values())
    const updatedBaseAssets = new Set<string>()

    for (const symbolData of symbols) {
      // 避免重复更新相同 baseAsset
      if (updatedBaseAssets.has(symbolData.baseAsset)) {
        continue
      }

      try {
        await this.getSquareHeat(symbolData.symbol)
        updatedBaseAssets.add(symbolData.baseAsset)
        await new Promise((r) => setTimeout(r, 200)) // 避免请求过快
      } catch (error) {
        // 单个失败不影响
      }
    }

    console.log('[MarketDataManager] 广场热度更新完成')
  }

  /**
   * 启动定时任务
   */
  private startScheduledTasks(): void {
    // 每60秒更新一次 ticker 数据
    this.tickerUpdateTimer = setInterval(() => {
      this.updateTickers().catch(() => {})
    }, 60 * 1000)

    // 资金费率每50分钟更新
    this.fundingRateTimer = setInterval(() => {
      this.fetchAllFundingRates().catch(() => {})
    }, 50 * 60 * 1000)

    // 未平仓合约量每30分钟更新
    this.openInterestTimer = setInterval(() => {
      this.fetchAllOpenInterest().catch(() => {})
    }, 30 * 60 * 1000)

    // 广场热度每60分钟更新
    this.squareHeatTimer = setInterval(() => {
      this.updateAllSquareHeat().catch(() => {})
    }, 60 * 60 * 1000)

    // 清理过期缓存每小时
    this.cacheCleanTimer = setInterval(() => {
      this.cleanExpiredCache()
    }, 60 * 60 * 1000)

    // 保存缓存到文件每10分钟
    this.cacheSaveTimer = setInterval(() => {
      this.saveToCache().catch(console.error)
    }, 10 * 60 * 1000)
  }

  /**
   * 停止定时任务
   */
  private stopScheduledTasks(): void {
    if (this.tickerUpdateTimer) clearInterval(this.tickerUpdateTimer)
    if (this.fundingRateTimer) clearInterval(this.fundingRateTimer)
    if (this.openInterestTimer) clearInterval(this.openInterestTimer)
    if (this.squareHeatTimer) clearInterval(this.squareHeatTimer)
    if (this.cacheCleanTimer) clearInterval(this.cacheCleanTimer)
    if (this.cacheSaveTimer) clearInterval(this.cacheSaveTimer)

    this.tickerUpdateTimer = null
    this.fundingRateTimer = null
    this.openInterestTimer = null
    this.squareHeatTimer = null
    this.cacheCleanTimer = null
    this.cacheSaveTimer = null
  }

  /**
   * 清理过期缓存
   */
  private cleanExpiredCache(): void {
    const now = Date.now()

    // 清理热度更新时间记录（保留1小时以内的）
    for (const [key, lastUpdated] of this.heatLastUpdated) {
      if (lastUpdated < now - 60 * 60 * 1000) {
        this.heatLastUpdated.delete(key)
      }
    }
  }

  /**
   * 保存数据到本地缓存文件
   */
  private async saveToCache(): Promise<void> {
    try {
      const cacheData: FileCache = {
        symbolData: Object.fromEntries(this.symbolData),
        lastUpdated: Date.now(),
      }

      // 确保目录存在
      const dir = path.dirname(CACHE_FILE)
      try {
        await fs.promises.access(dir)
      } catch {
        await fs.promises.mkdir(dir, { recursive: true })
      }

      await fs.promises.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2))
      console.log('[MarketDataManager] 缓存已保存到本地文件')
    } catch (error) {
      console.error('[MarketDataManager] 保存缓存失败:', error)
    }
  }

  /**
   * 从本地缓存文件加载数据
   */
  private loadFromCache(): boolean {
    try {
      if (!fs.existsSync(CACHE_FILE)) {
        return false
      }

      const content = fs.readFileSync(CACHE_FILE, 'utf-8')
      // 使用 any 类型兼容旧格式
      const cacheData: any = JSON.parse(content)

      // 检查缓存是否过期（30分钟）
      if (Date.now() - cacheData.lastUpdated > 30 * 60 * 1000) {
        console.log('[MarketDataManager] 本地缓存已过期，将重新获取')
        return false
      }

      // 恢复缓存数据
      this.symbolData = new Map(Object.entries(cacheData.symbolData))

      console.log(`[MarketDataManager] 从缓存加载 ${this.symbolData.size} 个交易对数据`)
      return true
    } catch (error) {
      console.error('[MarketDataManager] 加载本地缓存失败:', error)
      return false
    }
  }
}
