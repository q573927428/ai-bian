// ==================== 仓位管理器 ====================

import type { StrategyId, TradeDirection } from '../../../types/strategy'
import type { Position } from '../../../types'
import { logger } from '../../utils/logger'
import { 
  saveActivePositions,
  loadActivePositions,
  saveSymbolLocks,
  loadSymbolLocks,
  clearActiveState
} from '../../utils/storage'

/**
 * 仓位信息
 */
export interface PositionInfo {
  symbol: string;                      // 交易对
  strategyId: StrategyId;              // 策略ID
  direction: TradeDirection;           // 方向
  entryPrice: number;                  // 入场价
  quantity: number;                    // 数量
  leverage: number;                    // 杠杆
  openTime: number;                    // 开仓时间
  highestPrice?: number;               // 持仓期间最高价
  lowestPrice?: number;                // 持仓期间最低价
  position?: Position;                 // 完整仓位信息
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
  // 当前仓位映射: symbol -> PositionInfo
  private positions: Map<string, PositionInfo> = new Map()

  // 策略锁映射: symbol -> strategyId (哪个策略锁定了该交易对)
  private symbolLocks: Map<string, StrategyId> = new Map()

  // 策略的仓位列表: strategyId -> Set<symbol>
  private strategyPositions: Map<StrategyId, Set<string>> = new Map()

  /**
   * 构造函数：初始化时加载本地持久化状态
   */
  constructor() {
    // 异步加载本地状态（不阻塞构造函数）
    this._loadLocalState().catch(err => {
      logger.error('PositionManager', '加载本地状态失败:', err.message)
    })
  }

  /**
   * 持久化当前状态到本地文件
   */
  private async _persistState(): Promise<void> {
    try {
      // 保存活跃持仓
      const positions = this.getActivePositions()
      await saveActivePositions(positions)

      // 保存交易对锁
      const locks: Record<string, string> = {}
      for (const [symbol, strategyId] of this.symbolLocks.entries()) {
        locks[symbol] = strategyId
      }
      await saveSymbolLocks(locks)
    } catch (error: any) {
      logger.error('PositionManager', '持久化状态失败:', error.message)
    }
  }

  /**
   * 从本地文件加载状态
   */
  private async _loadLocalState(): Promise<void> {
    try {
      logger.info('PositionManager', '开始加载本地持久化状态')
      
      // 加载活跃持仓
      const positions = await loadActivePositions()
      // 加载交易对锁
      const locks = await loadSymbolLocks()

      // 重建内存映射
      for (const position of positions) {
        this.positions.set(position.symbol, position)
      }

      for (const [symbol, strategyId] of Object.entries(locks)) {
        this.symbolLocks.set(symbol, strategyId as StrategyId)
        
        // 重建策略仓位映射
        if (!this.strategyPositions.has(strategyId as StrategyId)) {
          this.strategyPositions.set(strategyId as StrategyId, new Set())
        }
        this.strategyPositions.get(strategyId as StrategyId)!.add(symbol)
      }

      logger.success('PositionManager', `本地状态加载完成: ${positions.length} 个仓位, ${Object.keys(locks).length} 个锁`)
    } catch (error: any) {
      logger.error('PositionManager', '加载本地状态失败:', error.message)
    }
  }

  /**
   * 检查交易对是否可开仓
   */
  async canOpenPosition(symbol: string, strategyId: StrategyId): Promise<boolean> {
    // 1. 检查是否有其他策略已锁定该交易对
    const lockHolder = this.symbolLocks.get(symbol)
    if (lockHolder && lockHolder !== strategyId) {
      logger.error('PositionManager', `交易对 ${symbol} 已被策略 ${lockHolder} 锁定`)
      return false
    }

    // 2. 检查是否已有仓位
    if (this.positions.has(symbol)) {
      logger.error('PositionManager', `交易对 ${symbol} 已有仓位`)
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
  lockSymbol(symbol: string, strategyId: StrategyId): void {
    // 检查是否已被其他策略锁定
    const existingLock = this.symbolLocks.get(symbol)
    if (existingLock && existingLock !== strategyId) {
      throw new Error(`交易对 ${symbol} 已被策略 ${existingLock} 锁定`)
    }

    this.symbolLocks.set(symbol, strategyId)

    // 记录策略的仓位
    if (!this.strategyPositions.has(strategyId)) {
      this.strategyPositions.set(strategyId, new Set())
    }
    this.strategyPositions.get(strategyId)!.add(symbol)

    logger.info('PositionManager', `交易对 ${symbol} 已被策略 ${strategyId} 锁定`)
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 释放交易对锁
   */
  unlockSymbol(symbol: string): void {
    const strategyId = this.symbolLocks.get(symbol)
    if (strategyId) {
      // 从策略的仓位列表中移除
      const positions = this.strategyPositions.get(strategyId)
      if (positions) {
        positions.delete(symbol)
        if (positions.size === 0) {
          this.strategyPositions.delete(strategyId)
        }
      }

      this.symbolLocks.delete(symbol)
      logger.info('PositionManager', `交易对 ${symbol} 锁已释放`)
      
      // 持久化状态
      this._persistState().catch()
    }
  }

  /**
   * 记录仓位
   */
  recordPosition(symbol: string, positionInfo: PositionInfo): void {
    // 先锁定
    this.lockSymbol(symbol, positionInfo.strategyId)

    // 记录仓位
    this.positions.set(symbol, positionInfo)

    logger.info('PositionManager', `仓位已记录: ${symbol} by ${positionInfo.strategyId}`)
    
    // 持久化状态
    this._persistState().catch()
  }

  /**
   * 清除仓位记录
   */
  clearPosition(symbol: string): void {
    const positionInfo = this.positions.get(symbol)

    // 先释放锁
    this.unlockSymbol(symbol)

    // 清除仓位
    this.positions.delete(symbol)

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
    for (const symbol of symbols) {
      const position = this.positions.get(symbol)
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
    return this.positions.get(symbol)
  }

  /**
   * 检查交易对是否有仓位
   */
  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol)
  }

  /**
   * 获取交易对的锁持有者
   */
  getLockHolder(symbol: string): StrategyId | undefined {
    return this.symbolLocks.get(symbol)
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
      const direction = position.direction === 'LONG' ? 'long' as TradeDirection : 'short' as TradeDirection

      const positionInfo: PositionInfo = {
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
    const existing = this.positions.get(symbol)
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
    totalLocked: number
    strategiesWithPositions: number
  } {
    return {
      totalPositions: this.positions.size,
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
