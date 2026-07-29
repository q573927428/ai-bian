// ==================== 仓位管理器 ====================

import type { StrategyId, TradeDirection } from '../../../types/strategy'
import type { Position } from '../../../types'
import type { ScoreBreakdown } from '../../../types'
import { logger } from '../../utils/logger'
import { 
  saveActivePositions,
  loadActivePositions,
  saveSymbolLocks,
  loadSymbolLocks
} from '../../utils/storage'

const DEFAULT_ACCOUNT_ID = 'default'

/**
 * 仓位信息
 */
export interface PositionInfo {
  accountId?: string;                  // 账户ID，短期默认 default
  userId?: string;                     // 用户ID，预留多用户维度
  symbol: string;                      // 交易对
  strategyId: StrategyId;              // 策略ID
  direction: TradeDirection;           // 方向
  entryPrice: number;                  // 入场价
  quantity: number;                    // 数量
  leverage: number;                    // 杠杆
  mainTimeframe?: string;              // 入场指标使用的主时间周期
  stopLoss?: number;                   // 止损价格
  initialStopLoss?: number;            // 初始止损价格
  takeProfit1?: number;                // 止盈1价格
  takeProfit2?: number;                // 止盈2价格
  openTime: number;                    // 开仓时间
  highestPrice?: number;               // 持仓期间最高价
  lowestPrice?: number;                // 持仓期间最低价
  orderId?: string;                    // 订单ID
  stopLossOrderId?: string;            // 止损订单ID
  position?: Position;                 // 完整仓位信息
  confidence?: number;                 // 置信度
  reasoning?: string;                  // 推理信息
  entryCommission?: number;            // 开仓手续费
  entryCommissionAsset?: string;       // 开仓手续费原始资产
  entryCommissionRaw?: number;         // 开仓手续费原始数量
  entryOrderId?: string;               // 开仓订单ID，用于平仓后对账
  entryDataSource?: 'binance' | 'estimated'; // 开仓数据来源
  scoreBreakdown?: ScoreBreakdown;     // 评分拆解
  riskLevel?: string;                  // 风险等级
  
  // 入场指标（新增）
  entryIndicators?: Record<string, number>;  // 入场时的技术指标
  
  // 持仓期间的极值追踪（用于计算最大浮盈浮亏）
  maxFloatingProfit?: number;
  maxFloatingProfitPercent?: number;
  maxFloatingLoss?: number;
  maxFloatingLossPercent?: number;
}

/**
 * 仓位管理器
 *
 * 核心职责：
 * 1. 维护全局仓位映射
 * 2. 实现"同一交易对只能持有一个仓位"的互斥限制
 * 3. 开仓前检查冲突
 * 4. 开仓后锁定交易对
 * 5. 平仓后释放锁
 * 6. 程序启动时从交易所同步实际持仓
 */
export class PositionManager {
  // 当前仓位映射: accountId:symbol -> PositionInfo
  private positions: Map<string, PositionInfo> = new Map()

  // 策略锁映射: accountId:symbol -> strategyId (哪个策略锁定了该交易对)
  private symbolLocks: Map<string, StrategyId> = new Map()

  // 策略的仓位列表: strategyId -> Set<symbol>
  private strategyPositions: Map<StrategyId, Set<string>> = new Map()

  // 初始化完成标志
  private initialized = false
  // 初始化 Promise
  private initPromise: Promise<void> | null = null
  // 是否正在初始化中
  private isInitializing = false

  /**
   * 构造函数
   */
  constructor() {
    // 不在构造函数中自动加载，而是通过 init() 方法显式初始化
  }

  private getPositionKey(symbol: string, accountId = DEFAULT_ACCOUNT_ID): string {
    return `${accountId || DEFAULT_ACCOUNT_ID}:${symbol}`
  }

  private normalizeLockKey(key: string): string {
    return key.includes(':') ? key : this.getPositionKey(key)
  }

  /**
   * 初始化方法 - 加载本地持久化状态
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.isInitializing = true
    this.initPromise = this._loadLocalState()
    await this.initPromise
    this.initialized = true
    this.isInitializing = false
  }

  /**
   * 等待初始化完成
   */
  async waitForInit(): Promise<void> {
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      await this.initPromise
    }
  }

  // 防抖定时器
  private persistTimer: NodeJS.Timeout | null = null
  
  /**
   * 持久化当前状态到本地文件（带防抖）
   */
  private async _persistState(): Promise<void> {
    // 如果正在初始化中，不持久化，避免覆盖数据
    if (this.isInitializing) {
      return
    }
    
    // 清除之前的定时器
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    
    // 设置新的定时器，延迟100ms执行，避免频繁写入
    this.persistTimer = setTimeout(async () => {
      try {
        // 保存活跃持仓
        const positions = this.getActivePositions()
        await saveActivePositions(positions)

        // 保存交易对锁
        const locks: Record<string, string> = {}
        for (const [key, strategyId] of this.symbolLocks.entries()) {
          locks[key] = strategyId
        }
        await saveSymbolLocks(locks)
      } catch (error: any) {
        logger.error('PositionManager', '持久化状态失败:', error.message)
      }
    }, 100)
  }

  /**
   * 从本地文件加载状态
   */
  private async _loadLocalState(): Promise<void> {
    try {
      // logger.info('PositionManager', '开始加载本地持久化状态')
      
      // 加载活跃持仓
      const positions = await loadActivePositions()

      // 重建内存映射 - 从持仓数据中重建所有映射
      for (const position of positions) {
        position.accountId = position.accountId || DEFAULT_ACCOUNT_ID
        // 如果没有 position 字段，自动构建一个
        if (!position.position) {
          position.position = this.buildPositionFromInfo(position)
        }
        
        const key = this.getPositionKey(position.symbol, position.accountId)
        this.positions.set(key, position)
        
        // 重建 symbolLocks
        this.symbolLocks.set(key, position.strategyId)
        
        // 重建 strategyPositions
        if (!this.strategyPositions.has(position.strategyId)) {
          this.strategyPositions.set(position.strategyId, new Set())
        }
        this.strategyPositions.get(position.strategyId)!.add(key)
      }

      const persistedLocks = await loadSymbolLocks()
      for (const [rawKey, strategyId] of Object.entries(persistedLocks)) {
        const key = this.normalizeLockKey(rawKey)
        if (!this.symbolLocks.has(key)) {
          this.symbolLocks.set(key, strategyId)
          if (!this.strategyPositions.has(strategyId)) {
            this.strategyPositions.set(strategyId, new Set())
          }
          this.strategyPositions.get(strategyId)!.add(key)
        }
      }

      logger.success('PositionManager', `本地状态加载完成: ${positions.length} 个仓位, ${this.symbolLocks.size} 个锁`)
    } catch (error: any) {
      logger.error('PositionManager', '加载本地状态失败:', error.message)
    }
  }

  /**
   * 从 PositionInfo 构建 Position 对象
   */
  private buildPositionFromInfo(info: PositionInfo): any {
    let direction: 'LONG' | 'SHORT' = 'LONG'
    if (info.direction === 'short') {
      direction = 'SHORT'
    } else if (info.direction === 'idle') {
      // idle 状态不应该有实际仓位，默认使用 LONG
      direction = 'LONG'
    }
    return {
      symbol: info.symbol,
      direction,
      entryPrice: info.entryPrice,
      quantity: info.quantity,
      leverage: info.leverage,
      stopLoss: info.stopLoss || 0,
      initialStopLoss: info.initialStopLoss || info.stopLoss || 0,
      takeProfit1: info.takeProfit1 || 0,
      takeProfit2: info.takeProfit2 || 0,
      openTime: info.openTime,
      highestPrice: info.highestPrice,
      lowestPrice: info.lowestPrice,
      orderId: info.orderId,
      stopLossOrderId: info.stopLossOrderId,
      entryCommission: info.entryCommission,
      entryCommissionAsset: info.entryCommissionAsset,
      entryCommissionRaw: info.entryCommissionRaw,
      entryOrderId: info.entryOrderId || info.orderId,
      entryDataSource: info.entryDataSource
    }
  }

  /**
   * 检查交易对是否可开仓
   */
  async canOpenPosition(symbol: string, strategyId: StrategyId): Promise<boolean> {
    const key = this.getPositionKey(symbol)
    // 1. 检查是否有其他策略已锁定该交易对
    const lockHolder = this.symbolLocks.get(key)
    if (lockHolder && lockHolder !== strategyId) {
      // logger.info('扫描结果', ` ${symbol} 已被策略 ${lockHolder} 锁定`)
      return false
    }

    // 2. 检查是否已有仓位
    if (this.positions.has(key)) {
      // logger.info('扫描结果', ` ${symbol} 已有仓位`)
      return false
    }

    return true
  }

  /**
   * 检查仓位冲突
   */
  async hasConflict(symbol: string, strategyId: StrategyId): Promise<boolean> {
    const canOpen = await this.canOpenPosition(symbol, strategyId)
    return !canOpen
  }

  /**
   * 获取所有仓位
   */
  getAllPositions(): PositionInfo[] {
    return Array.from(this.positions.values())
  }

  /**
   * 锁定交易对
   */
  lockSymbol(symbol: string, strategyId: StrategyId, accountId = DEFAULT_ACCOUNT_ID): void {
    const key = this.getPositionKey(symbol, accountId)
    // 检查是否已被其他策略锁定
    const existingLock = this.symbolLocks.get(key)
    if (existingLock && existingLock !== strategyId) {
      throw new Error(`交易对 ${symbol} 已被策略 ${existingLock} 锁定`)
    }

    this.symbolLocks.set(key, strategyId)

    // 记录策略的仓位
    if (!this.strategyPositions.has(strategyId)) {
      this.strategyPositions.set(strategyId, new Set())
    }
    this.strategyPositions.get(strategyId)!.add(key)

    logger.info('PositionManager', `交易对 ${symbol} 已被策略 ${strategyId} 锁定`)
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 释放交易对锁
   */
  unlockSymbol(symbol: string, accountId = DEFAULT_ACCOUNT_ID): void {
    const key = this.getPositionKey(symbol, accountId)
    const strategyId = this.symbolLocks.get(key)
    if (strategyId) {
      // 从策略的仓位列表中移除
      const positions = this.strategyPositions.get(strategyId)
      if (positions) {
        positions.delete(key)
        if (positions.size === 0) {
          this.strategyPositions.delete(strategyId)
        }
      }

      this.symbolLocks.delete(key)
      logger.info('PositionManager', `交易对 ${symbol} 锁已释放`)
      
      // 持久化状态
      this._persistState().catch()
    }
  }

  /**
   * 记录仓位
   */
  recordPosition(symbol: string, positionInfo: PositionInfo): void {
    positionInfo.accountId = positionInfo.accountId || DEFAULT_ACCOUNT_ID
    const key = this.getPositionKey(symbol, positionInfo.accountId)
    // 先锁定
    this.lockSymbol(symbol, positionInfo.strategyId, positionInfo.accountId)

    // 记录仓位
    this.positions.set(key, positionInfo)

    logger.info('PositionManager', `仓位已记录: ${symbol} by ${positionInfo.strategyId}`)
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 清除仓位记录
   */
  clearPosition(symbol: string): void {
    const defaultKey = this.getPositionKey(symbol)
    const positionInfo = this.positions.get(defaultKey) || Array.from(this.positions.values()).find(pos => pos.symbol === symbol)
    const key = positionInfo ? this.getPositionKey(symbol, positionInfo.accountId) : defaultKey

    // 先释放锁
    this.unlockSymbol(symbol, positionInfo?.accountId || DEFAULT_ACCOUNT_ID)

    // 清除仓位
    this.positions.delete(key)

    if (positionInfo) {
      logger.info('PositionManager', `仓位已清除: ${symbol} (策略: ${positionInfo.strategyId})`)
    }
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 获取所有活跃仓位
   */
  getActivePositions(): PositionInfo[] {
    return Array.from(this.positions.values())
  }

  /**
   * 获取指定策略的仓位
   */
  getStrategyPositions(strategyId: StrategyId): PositionInfo[] {
    const symbols = this.strategyPositions.get(strategyId)
    if (!symbols) {
      return []
    }

    const positions: PositionInfo[] = []
    for (const key of symbols) {
      const position = this.positions.get(key)
      if (position) {
        positions.push(position)
      }
    }

    return positions
  }

  /**
   * 获取指定交易对的仓位
   */
  getPosition(symbol: string): PositionInfo | undefined {
    return this.positions.get(this.getPositionKey(symbol))
  }

  /**
   * 检查交易对是否有仓位
   */
  hasPosition(symbol: string): boolean {
    return this.positions.has(this.getPositionKey(symbol))
  }

  /**
   * 获取交易对的锁持有者
   */
  getLockHolder(symbol: string): StrategyId | undefined {
    return this.symbolLocks.get(this.getPositionKey(symbol))
  }

  /**
   * 获取所有锁信息
   */
  getAllLocks(): Map<string, StrategyId> {
    return new Map(this.symbolLocks)
  }

  /**
   * 同步交易所实际持仓（程序启动时调用）
   */
  async syncExchangePositions(exchangePositions: Position[]): Promise<void> {
    logger.info('PositionManager', `开始同步交易所持仓，共 ${exchangePositions.length} 个仓位`)

    // 清除现有记录
    this.positions.clear()
    this.symbolLocks.clear()
    this.strategyPositions.clear()

    // 重建映射
    for (const position of exchangePositions) {
      // 需要从仓位信息中获取策略ID（如果没有，标记为 'unknown'）
      const strategyId = (position as any).strategyId || 'unknown'
      const symbol = position.symbol
      // 将 Position.Direction (大写) 转换为 TradeDirection (小写)
      let direction: TradeDirection
      if (position.direction === 'LONG') {
        direction = 'long'
      } else if (position.direction === 'SHORT') {
        direction = 'short'
      } else {
        // IDLE 不应该有实际仓位，默认使用 long
        direction = 'long'
      }

      const positionInfo: PositionInfo = {
        accountId: DEFAULT_ACCOUNT_ID,
        symbol,
        strategyId,
        direction,
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        leverage: position.leverage,
        openTime: position.openTime,
        position
      }

      this.recordPosition(symbol, positionInfo)
    }

    logger.success('PositionManager', `交易所持仓同步完成，共 ${exchangePositions.length} 个仓位`)
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 更新仓位信息
   */
  updatePosition(symbol: string, updates: Partial<PositionInfo>): void {
    const existing = this.positions.get(this.getPositionKey(symbol))
    if (existing) {
      Object.assign(existing, updates)
      
      // 持久化状态
      this._persistState().catch()
    }
  }

  /**
   * 获取仓位统计信息
   */
  getPositionStats(): {
    totalPositions: number
    longPositions: number
    shortPositions: number
    totalLocked: number
    strategiesWithPositions: number
  } {
    let longPositions = 0
    let shortPositions = 0
    for (const position of this.positions.values()) {
      if (position.direction === 'long') {
        longPositions++
      } else if (position.direction === 'short') {
        shortPositions++
      }
    }
    return {
      totalPositions: this.positions.size,
      longPositions,
      shortPositions,
      totalLocked: this.symbolLocks.size,
      strategiesWithPositions: this.strategyPositions.size
    }
  }

  /**
   * 检查策略是否有任何仓位
   */
  strategyHasPositions(strategyId: StrategyId): boolean {
    const positions = this.strategyPositions.get(strategyId)
    return positions !== undefined && positions.size > 0
  }

  /**
   * 获取策略的仓位数量
   */
  getStrategyPositionCount(strategyId: StrategyId): number {
    const positions = this.strategyPositions.get(strategyId)
    return positions ? positions.size : 0
  }

  /**
   * 清除所有仓位（慎用）
   */
  clearAllPositions(): void {
    const count = this.positions.size
    this.positions.clear()
    this.symbolLocks.clear()
    this.strategyPositions.clear()
    logger.warn('PositionManager', `已清除所有仓位，共 ${count} 个`)
    
    // 持久化状态
    this._persistState().catch()
  }
}

// 导出单例
export const positionManager = new PositionManager()
