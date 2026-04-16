// ==================== 策略数据存储系统 ====================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { Strategy, StrategyId, CreateStrategyInput, UpdateStrategyInput } from '../../../types/strategy'
import { logger } from '../../utils/logger'

// 项目根目录（ES模块兼容）
const PROJECT_ROOT = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))
const STRATEGIES_DIR = join(PROJECT_ROOT, 'data', 'strategies')

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
      versionHistory: []
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
      return JSON.parse(data)
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

      // 保存旧版本快照
      const oldSnapshot = JSON.parse(JSON.stringify(strategy))

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
