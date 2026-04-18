// ==================== 策略数据存储系统 ====================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { Strategy, StrategyId, CreateStrategyInput, UpdateStrategyInput } from '../../../types/strategy'
import { logger } from '../../utils/logger'

// 项目根目录（ES模块兼容）
const PROJECT_ROOT = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))
const STRATEGIES_DIR = join(PROJECT_ROOT, 'data', 'strategies')
const TRADE_HISTORY_FILE = join(PROJECT_ROOT, 'data', 'trade-history.json')

/**
 * 确保策略数据目录存在
 */
async function ensureDataDir(): Promise<void> {
  if (!existsSync(STRATEGIES_DIR)) {
    await mkdir(STRATEGIES_DIR, { recursive: true })
  }
}

/**
 * 获取策略文件路径
 */
function getStrategyFilePath(strategyId: StrategyId): string {
  return join(STRATEGIES_DIR, `${strategyId}.json`)
}

/**
 * 策略数据存储类
 */
export class StrategyStore {
  /**
   * 创建新策略
   */
  async createStrategy(input: CreateStrategyInput): Promise<Strategy> {
    await ensureDataDir()

    const now = new Date().toISOString()
    const strategyId = await this.generateId()

    const strategy: Strategy = {
      id: strategyId,
      name: input.name,
      description: input.description,
      version: 1,
      createdAt: now,
      updatedAt: now,
      isActive: false,
      marketData: input.marketData,
      indicators: input.indicators,
      statistics: input.statistics,
      aiPrompt: input.aiPrompt,
      riskManagement: input.riskManagement,
      executionConfig: input.executionConfig,
      versionHistory: [],
      // 初始化运行数据
      performance: {
        strategyId,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0,
        totalProfit: 0,
        totalLoss: 0,
        netProfit: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        averageProfitPerTrade: 0,
        averageLossPerTrade: 0,
        largestWin: 0,
        largestLoss: 0,
        averageHoldTime: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        updatedAt: now
      },
      tradeRecords: [],
      sessions: [],
      currentSessionId: undefined
    }

    // 创建初始版本快照（排除versionHistory避免循环引用）
    const snapshot = JSON.parse(JSON.stringify({ ...strategy, versionHistory: [] }))
    strategy.versionHistory.push({
      version: 1,
      updatedAt: now,
      changes: '初始版本创建',
      snapshot
    })

    // 保存策略文件
    const filePath = getStrategyFilePath(strategyId)
    await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

    logger.info('StrategyStore', `策略已创建: ${strategy.name} (${strategyId})`)
    return strategy
  }

  /**
   * 获取单个策略
   */
  async getStrategy(strategyId: StrategyId): Promise<Strategy | null> {
    try {
      const filePath = getStrategyFilePath(strategyId)

      if (!existsSync(filePath)) {
        return null
      }

      const data = await readFile(filePath, 'utf-8')
      const strategy = JSON.parse(data)
      
      // 防御性代码：确保必需字段存在
      const now = new Date().toISOString()
      
      if (!strategy.performance) {
        strategy.performance = {
          strategyId: strategy.id,
          totalTrades: 0,
          totalWins: 0,
          totalLosses: 0,
          winRate: 0,
          totalProfit: 0,
          totalLoss: 0,
          netProfit: 0,
          profitFactor: 0,
          maxDrawdown: 0,
          averageProfitPerTrade: 0,
          averageLossPerTrade: 0,
          largestWin: 0,
          largestLoss: 0,
          averageHoldTime: 0,
          consecutiveWins: 0,
          consecutiveLosses: 0,
          maxConsecutiveWins: 0,
          maxConsecutiveLosses: 0,
          updatedAt: now
        }
      }
      
      if (!strategy.tradeRecords || !Array.isArray(strategy.tradeRecords)) {
        strategy.tradeRecords = []
      }
      
      if (!strategy.sessions || !Array.isArray(strategy.sessions)) {
        strategy.sessions = []
      }
      
      if (strategy.currentSessionId === undefined) {
        strategy.currentSessionId = null
      }
      
      return strategy
    } catch (error: any) {
      logger.error('StrategyStore', `获取策略失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 获取所有策略
   */
  async getAllStrategies(): Promise<Strategy[]> {
    try {
      await ensureDataDir()

      const { readdir } = await import('fs/promises')
      const files = await readdir(STRATEGIES_DIR)

      const strategies: Strategy[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          const strategyId = file.replace('.json', '')
          const strategy = await this.getStrategy(strategyId)
          if (strategy) {
            strategies.push(strategy)
          }
        }
      }

      return strategies
    } catch (error: any) {
      logger.error('StrategyStore', `获取所有策略失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取所有激活的策略
   */
  async getActiveStrategies(): Promise<Strategy[]> {
    const allStrategies = await this.getAllStrategies()
    return allStrategies.filter(s => s.isActive)
  }

  /**
   * 更新策略（普通更新，不创建新版本）
   */
  async updateStrategyWithoutVersion(
    strategyId: StrategyId,
    updates: UpdateStrategyInput
  ): Promise<Strategy | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      const now = new Date().toISOString()

      // 应用更新
      if (updates.name !== undefined) strategy.name = updates.name
      if (updates.description !== undefined) strategy.description = updates.description
      if (updates.marketData !== undefined) strategy.marketData = updates.marketData
      if (updates.indicators !== undefined) strategy.indicators = updates.indicators
      if (updates.statistics !== undefined) strategy.statistics = updates.statistics
      if (updates.aiPrompt !== undefined) strategy.aiPrompt = updates.aiPrompt
      if (updates.riskManagement !== undefined) strategy.riskManagement = updates.riskManagement
      if (updates.executionConfig !== undefined) strategy.executionConfig = updates.executionConfig

      // 只更新 updatedAt，不修改 version
      strategy.updatedAt = now

      // 保存更新后的策略
      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `策略已更新（无版本）: ${strategy.name}`)
      return strategy
    } catch (error: any) {
      logger.error('StrategyStore', `更新策略失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 更新策略（自动创建新版本）
   */
  async updateStrategy(
    strategyId: StrategyId,
    updates: UpdateStrategyInput,
    changes: string
  ): Promise<Strategy | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      const now = new Date().toISOString()
      const newVersion = strategy.version + 1

      // 保存旧版本快照（排除 versionHistory 避免循环引用）
      const oldSnapshot = JSON.parse(JSON.stringify({ ...strategy, versionHistory: [] }))

      // 应用更新
      if (updates.name !== undefined) strategy.name = updates.name
      if (updates.description !== undefined) strategy.description = updates.description
      if (updates.marketData !== undefined) strategy.marketData = updates.marketData
      if (updates.indicators !== undefined) strategy.indicators = updates.indicators
      if (updates.statistics !== undefined) strategy.statistics = updates.statistics
      if (updates.aiPrompt !== undefined) strategy.aiPrompt = updates.aiPrompt
      if (updates.riskManagement !== undefined) strategy.riskManagement = updates.riskManagement
      if (updates.executionConfig !== undefined) strategy.executionConfig = updates.executionConfig

      // 更新元数据
      strategy.version = newVersion
      strategy.updatedAt = now

      // 添加版本历史
      strategy.versionHistory.push({
        version: newVersion,
        updatedAt: now,
        changes,
        snapshot: oldSnapshot
      })

      // 保存更新后的策略
      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `策略已更新: ${strategy.name} (v${newVersion})`)
      return strategy
    } catch (error: any) {
      logger.error('StrategyStore', `更新策略失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 回滚策略到指定版本
   */
  async rollbackStrategy(
    strategyId: StrategyId,
    targetVersion: number
  ): Promise<Strategy | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      // 查找目标版本快照
      const targetVersionHistory = strategy.versionHistory.find(v => v.version === targetVersion)
      if (!targetVersionHistory) {
        logger.warn('StrategyStore', `版本不存在: ${strategyId} v${targetVersion}`)
        return null
      }

      const now = new Date().toISOString()
      const newVersion = strategy.version + 1

      // 保存当前版本快照
      const currentSnapshot = JSON.parse(JSON.stringify(strategy))

      // 恢复到目标版本的配置（保留版本历史）
      const rolledBackStrategy: Strategy = {
        ...targetVersionHistory.snapshot,
        id: strategyId,
        version: newVersion,
        updatedAt: now,
        versionHistory: [
          ...strategy.versionHistory,
          {
            version: newVersion,
            updatedAt: now,
            changes: `回滚到 v${targetVersion}`,
            snapshot: currentSnapshot
          }
        ]
      }

      // 保存回滚后的策略
      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(rolledBackStrategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `策略已回滚: ${strategy.name} (v${targetVersion} -> v${newVersion})`)
      return rolledBackStrategy
    } catch (error: any) {
      logger.error('StrategyStore', `回滚策略失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 删除策略（软删除 - 移动到归档目录）
   */
  async deleteStrategy(strategyId: StrategyId): Promise<boolean> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return false
      }

      const archiveDir = join(STRATEGIES_DIR, 'archive')
      if (!existsSync(archiveDir)) {
        await mkdir(archiveDir, { recursive: true })
      }

      const filePath = getStrategyFilePath(strategyId)
      const archivePath = join(archiveDir, `${strategyId}.json`)

      // 移动文件到归档目录
      const { rename } = await import('fs/promises')
      await rename(filePath, archivePath)

      logger.info('StrategyStore', `策略已归档: ${strategy.name} (${strategyId})`)
      return true
    } catch (error: any) {
      logger.error('StrategyStore', `删除策略失败 ${strategyId}: ${error.message}`)
      return false
    }
  }

  /**
   * 激活/停用策略
   */
  async toggleStrategy(strategyId: StrategyId, active: boolean): Promise<Strategy | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      strategy.isActive = active
      strategy.updatedAt = new Date().toISOString()

      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `策略已${active ? '激活' : '停用'}: ${strategy.name}`)
      return strategy
    } catch (error: any) {
      logger.error('StrategyStore', `切换策略状态失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 获取策略版本历史
   */
  async getVersionHistory(strategyId: StrategyId): Promise<any[] | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      return strategy.versionHistory.map(v => ({
        version: v.version,
        updatedAt: v.updatedAt,
        changes: v.changes
      }))
    } catch (error: any) {
      logger.error('StrategyStore', `获取版本历史失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 获取指定版本的完整快照
   */
  async getVersionSnapshot(
    strategyId: StrategyId,
    version: number
  ): Promise<Strategy | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      const versionHistory = strategy.versionHistory.find(v => v.version === version)
      if (!versionHistory) {
        logger.warn('StrategyStore', `版本不存在: ${strategyId} v${version}`)
        return null
      }

      return versionHistory.snapshot
    } catch (error: any) {
      logger.error('StrategyStore', `获取版本快照失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 获取下一个可用的策略序号
   */
  private async getNextStrategyNumber(): Promise<number> {
    try {
      await ensureDataDir()
      const { readdir } = await import('fs/promises')
      const files = await readdir(STRATEGIES_DIR)
      
      let maxNumber = 0
      
      // 遍历所有文件，查找最大的序号
      for (const file of files) {
        // 匹配新格式：strategy_001.json
        const newFormatMatch = file.match(/^strategy_(\d+)\.json$/)
        if (newFormatMatch && newFormatMatch[1]) {
          const num = parseInt(newFormatMatch[1], 10)
          if (!isNaN(num) && num > maxNumber) {
            maxNumber = num
          }
          continue
        }
        
        // 匹配旧格式：strategy_mo015o9z_6vn3m5.json，按创建时间顺序推断序号
        // 旧格式统一按现有数量递增，避免冲突
        if (file.startsWith('strategy_') && file.endsWith('.json')) {
          maxNumber++
        }
      }
      
      // 归档目录也需要检查，避免重复
      const archiveDir = join(STRATEGIES_DIR, 'archive')
      if (existsSync(archiveDir)) {
        const archiveFiles = await readdir(archiveDir)
        for (const file of archiveFiles) {
          const newFormatMatch = file.match(/^strategy_(\d+)\.json$/)
          if (newFormatMatch && newFormatMatch[1]) {
            const num = parseInt(newFormatMatch[1], 10)
            if (!isNaN(num) && num > maxNumber) {
              maxNumber = num
            }
          }
        }
      }
      
      return maxNumber + 1
    } catch (error) {
      // 如果读取失败，默认从1开始
      return 1
    }
  }

  /**
   * ==================== 策略运行数据管理 ====================
   */

  /**
   * 添加交易记录
   */
  async addTradeRecord(strategyId: StrategyId, record: Omit<import('../../../types/strategy').TradeRecord, 'id' | 'strategyId' | 'strategyVersion'>): Promise<string | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return null
      }

      const recordId = `trade_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
      const newRecord: import('../../../types/strategy').TradeRecord = {
        id: recordId,
        strategyId,
        strategyVersion: strategy.version,
        ...record
      }

      strategy.tradeRecords.push(newRecord)
      strategy.updatedAt = new Date().toISOString()

      // 如果是平仓单，自动更新性能统计
      if (record.status === 'closed' && record.profitLoss !== undefined) {
        await this.recalculatePerformance(strategy)
      }


      // 保存更新
      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `交易记录已添加: ${record.symbol} ${record.direction} ${record.action} (${recordId})`)
      return recordId
    } catch (error: any) {
      logger.error('StrategyStore', `添加交易记录失败 ${strategyId}: ${error.message}`)
      return null
    }
  }

  /**
   * 更新交易记录（平仓时调用）
   */
  async updateTradeRecord(strategyId: StrategyId, recordId: string, updates: Partial<import('../../../types/strategy').TradeRecord>): Promise<boolean> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        logger.warn('StrategyStore', `策略不存在: ${strategyId}`)
        return false
      }

      const recordIndex = strategy.tradeRecords.findIndex(r => r.id === recordId)
      if (recordIndex === -1) {
        logger.warn('StrategyStore', `交易记录不存在: ${recordId}`)
        return false
      }

      // 更新记录（禁止修改不可变字段）
      const { id, strategyId: _, strategyVersion: __, ...safeUpdates } = updates
      strategy.tradeRecords[recordIndex] = {
        ...strategy.tradeRecords[recordIndex],
        ...safeUpdates
      } as import('../../../types/strategy').TradeRecord
      strategy.updatedAt = new Date().toISOString()

      // 如果是平仓操作，重新计算性能
      if (updates.status === 'closed' && updates.profitLoss !== undefined) {
        await this.recalculatePerformance(strategy)
      }

      // 保存更新
      const filePath = getStrategyFilePath(strategyId)
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')

      logger.info('StrategyStore', `交易记录已更新: ${recordId}`)
      return true
    } catch (error: any) {
      logger.error('StrategyStore', `更新交易记录失败 ${recordId}: ${error.message}`)
      return false
    }
  }

  /**
   * 重新计算策略性能统计
   */
  private async recalculatePerformance(strategy: Strategy): Promise<void> {
    const closedTrades = strategy.tradeRecords.filter(t => t.status === 'closed')
    const totalTrades = closedTrades.length

    if (totalTrades === 0) {
      strategy.performance = {
        strategyId: strategy.id,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0,
        totalProfit: 0,
        totalLoss: 0,
        netProfit: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        averageProfitPerTrade: 0,
        averageLossPerTrade: 0,
        largestWin: 0,
        largestLoss: 0,
        averageHoldTime: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        updatedAt: new Date().toISOString()
      }
      return
    }

    // 计算基础统计
    const winningTrades = closedTrades.filter(t => (t.profitLoss || 0) > 0)
    const losingTrades = closedTrades.filter(t => (t.profitLoss || 0) <= 0)
    const totalWins = winningTrades.length
    const totalLosses = losingTrades.length

    const totalProfit = winningTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0))
    const netProfit = totalProfit - totalLoss

    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity

    // 计算最大盈利/亏损
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profitLoss || 0)) : 0
    const largestLoss = losingTrades.length > 0 ? Math.max(...losingTrades.map(t => Math.abs(t.profitLoss || 0))) : 0

    // 平均盈亏
    const averageProfitPerTrade = totalWins > 0 ? totalProfit / totalWins : 0
    const averageLossPerTrade = totalLosses > 0 ? totalLoss / totalLosses : 0

    // 平均持仓时间
    const totalHoldTime = closedTrades.reduce((sum, t) => {
      if (t.openTime && t.closeTime) {
        const open = new Date(t.openTime).getTime()
        const close = new Date(t.closeTime).getTime()
        return sum + (close - open) / (1000 * 60) // 转换为分钟
      }
      return sum
    }, 0)
    const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0

    // 计算连续盈亏
    let consecutiveWins = 0
    let consecutiveLosses = 0
    let maxConsecutiveWins = 0
    let maxConsecutiveLosses = 0

    // 按时间排序交易
    const sortedTrades = [...closedTrades].sort((a, b) => 
      new Date(a.closeTime || a.openTime).getTime() - new Date(b.closeTime || b.openTime).getTime()
    )

    for (const trade of sortedTrades) {
      const profit = trade.profitLoss || 0
      if (profit > 0) {
        consecutiveWins++
        consecutiveLosses = 0
        maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins)
      } else {
        consecutiveLosses++
        consecutiveWins = 0
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
      }
    }

    // 计算最大回撤（简化版，可后续优化）
    let peak = 0
    let maxDrawdown = 0
    let cumulativeProfit = 0
    for (const trade of sortedTrades) {
      cumulativeProfit += trade.profitLoss || 0
      if (cumulativeProfit > peak) {
        peak = cumulativeProfit
      }
      const drawdown = peak > 0 ? ((peak - cumulativeProfit) / peak) * 100 : 0
      maxDrawdown = Math.max(maxDrawdown, drawdown)
    }

    // 更新性能数据
    strategy.performance = {
      strategyId: strategy.id,
      totalTrades,
      totalWins,
      totalLosses,
      winRate,
      totalProfit,
      totalLoss,
      netProfit,
      profitFactor,
      maxDrawdown,
      averageProfitPerTrade,
      averageLossPerTrade,
      largestWin,
      largestLoss,
      averageHoldTime,
      consecutiveWins,
      consecutiveLosses,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 从全局交易历史文件读取记录
   */
  private async getGlobalTradeRecords(strategyId: StrategyId): Promise<import('../../../types/strategy').TradeRecord[]> {
    try {
      if (!existsSync(TRADE_HISTORY_FILE)) {
        return []
      }

      const data = await readFile(TRADE_HISTORY_FILE, 'utf-8')
      const globalRecords = JSON.parse(data) as any[]

      // 转换全局记录格式为策略存储格式
      return globalRecords
        .filter(record => record.strategyId === strategyId)
        .map(record => ({
          id: record.id,
          strategyId: record.strategyId,
          strategyVersion: 1, // 全局记录没有版本信息，默认1
          symbol: record.symbol,
          direction: (record.direction?.toLowerCase() || 'long') as 'long' | 'short',
          action: 'close' as const,
          entryPrice: record.entryPrice,
          exitPrice: record.exitPrice,
          quantity: record.quantity,
          leverage: record.leverage,
          marginMode: 'cross' as const, // 默认逐仓
          positionMode: 'one-way' as const, // 默认单向持仓
          profitLoss: record.pnl,
          profitLossPercentage: record.pnlPercentage,
          openTime: new Date(record.openTime).toISOString(),
          closeTime: new Date(record.closeTime).toISOString(),
          status: 'closed' as const,
          reason: record.reason
        }))
    } catch (error: any) {
      logger.error('StrategyStore', `读取全局交易历史失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取策略交易记录
   */
  async getTradeRecords(strategyId: StrategyId, limit?: number, symbol?: string): Promise<import('../../../types/strategy').TradeRecord[]> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        return []
      }

      // 从策略文件和全局文件同时读取记录
      const strategyRecords = [...strategy.tradeRecords]
      const globalRecords = await this.getGlobalTradeRecords(strategyId)

      // 合并并去重（按id）
      const recordMap = new Map<string, import('../../../types/strategy').TradeRecord>()
      for (const record of strategyRecords) {
        recordMap.set(record.id, record)
      }
      for (const record of globalRecords) {
        recordMap.set(record.id, record)
      }

      let records = Array.from(recordMap.values()).sort((a, b) => 
        new Date(b.openTime).getTime() - new Date(a.openTime).getTime()
      )

      if (symbol) {
        records = records.filter(r => r.symbol === symbol)
      }

      if (limit) {
        records = records.slice(0, limit)
      }

      return records
    } catch (error: any) {
      logger.error('StrategyStore', `获取交易记录失败 ${strategyId}: ${error.message}`)
      return []
    }
  }

  /**
   * 基于交易记录计算性能统计
   */
  private calculatePerformanceFromRecords(
    strategyId: StrategyId,
    records: import('../../../types/strategy').TradeRecord[]
  ): import('../../../types/strategy').StrategyPerformance {
    const closedTrades = records.filter(t => t.status === 'closed')
    const totalTrades = closedTrades.length

    if (totalTrades === 0) {
      return {
        strategyId,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0,
        totalProfit: 0,
        totalLoss: 0,
        netProfit: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        averageProfitPerTrade: 0,
        averageLossPerTrade: 0,
        largestWin: 0,
        largestLoss: 0,
        averageHoldTime: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        updatedAt: new Date().toISOString()
      }
    }

    // 计算基础统计
    const winningTrades = closedTrades.filter(t => (t.profitLoss || 0) > 0)
    const losingTrades = closedTrades.filter(t => (t.profitLoss || 0) <= 0)
    const totalWins = winningTrades.length
    const totalLosses = losingTrades.length

    const totalProfit = winningTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0))
    const netProfit = totalProfit - totalLoss

    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity

    // 计算最大盈利/亏损
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profitLoss || 0)) : 0
    const largestLoss = losingTrades.length > 0 ? Math.max(...losingTrades.map(t => Math.abs(t.profitLoss || 0))) : 0

    // 平均盈亏
    const averageProfitPerTrade = totalWins > 0 ? totalProfit / totalWins : 0
    const averageLossPerTrade = totalLosses > 0 ? totalLoss / totalLosses : 0

    // 平均持仓时间
    const totalHoldTime = closedTrades.reduce((sum, t) => {
      if (t.openTime && t.closeTime) {
        const open = new Date(t.openTime).getTime()
        const close = new Date(t.closeTime).getTime()
        return sum + (close - open) / (1000 * 60) // 转换为分钟
      }
      return sum
    }, 0)
    const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0

    // 计算连续盈亏
    let consecutiveWins = 0
    let consecutiveLosses = 0
    let maxConsecutiveWins = 0
    let maxConsecutiveLosses = 0

    // 按时间排序交易
    const sortedTrades = [...closedTrades].sort((a, b) => 
      new Date(a.closeTime || a.openTime).getTime() - new Date(b.closeTime || b.openTime).getTime()
    )

    for (const trade of sortedTrades) {
      const profit = trade.profitLoss || 0
      if (profit > 0) {
        consecutiveWins++
        consecutiveLosses = 0
        maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins)
      } else {
        consecutiveLosses++
        consecutiveWins = 0
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
      }
    }

    // 计算最大回撤（简化版）
    let peak = 0
    let maxDrawdown = 0
    let cumulativeProfit = 0
    for (const trade of sortedTrades) {
      cumulativeProfit += trade.profitLoss || 0
      if (cumulativeProfit > peak) {
        peak = cumulativeProfit
      }
      const drawdown = peak > 0 ? ((peak - cumulativeProfit) / peak) * 100 : 0
      maxDrawdown = Math.max(maxDrawdown, drawdown)
    }

    return {
      strategyId,
      totalTrades,
      totalWins,
      totalLosses,
      winRate,
      totalProfit,
      totalLoss,
      netProfit,
      profitFactor,
      maxDrawdown,
      averageProfitPerTrade,
      averageLossPerTrade,
      largestWin,
      largestLoss,
      averageHoldTime,
      consecutiveWins,
      consecutiveLosses,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 获取策略性能统计
   */
  async getPerformance(strategyId: StrategyId): Promise<import('../../../types/strategy').StrategyPerformance | null> {
    try {
      const strategy = await this.getStrategy(strategyId)
      if (!strategy) {
        return null
      }

      // 获取合并后的交易记录
      const allRecords = await this.getTradeRecords(strategyId)
      
      // 基于合并后的记录重新计算性能统计
      return this.calculatePerformanceFromRecords(strategyId, allRecords)
    } catch (error: any) {
      logger.error('StrategyStore', `获取性能统计失败 ${strategyId}: ${error.message}`)
      return null
    }
  }


  /**
   * 生成唯一 ID（序号式命名）
   */
  private async generateId(): Promise<StrategyId> {
    const nextNumber = await this.getNextStrategyNumber()
    // 格式化为3位数字，不足补0，例如：001, 002, 010, 100
    const formattedNumber = nextNumber.toString().padStart(3, '0')
    return `strategy_${formattedNumber}`
  }
}

// 导出单例
export const strategyStore = new StrategyStore()
