// ==================== 策略 DSL 迁移脚本 ====================

import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const STRATEGIES_DIR = join(process.cwd(), 'data', 'strategies')

/**
 * 迁移单个策略文件 - DSL 直接使用原始策略文本
 */
async function migrateStrategyFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8')
    const strategy = JSON.parse(content)

    // 检查是否需要更新 dsl（如果 dsl 存在但不是原始文本）
    const needsUpdate = !strategy.aiPrompt?.dsl || 
                       strategy.aiPrompt.dsl !== strategy.aiPrompt?.userPrompt

    if (!needsUpdate) {
      console.log(`跳过: ${strategy.id} (dsl 已是最新)`)
      return false
    }

    // DSL 直接使用原始策略文本
    if (strategy.aiPrompt?.userPrompt) {
      strategy.aiPrompt.dsl = strategy.aiPrompt.userPrompt
      strategy.updatedAt = new Date().toISOString()
      
      // 保存更新后的策略
      await writeFile(filePath, JSON.stringify(strategy, null, 2), 'utf-8')
      console.log(`已迁移: ${strategy.id}`)
      return true
    }

    return false
  } catch (error) {
    console.error(`迁移失败: ${filePath}`, error.message)
    return false
  }
}

/**
 * 主迁移函数
 */
async function migrateAllStrategies() {
  console.log('开始迁移策略 DSL...')
  console.log(`策略目录: ${STRATEGIES_DIR}`)

  if (!existsSync(STRATEGIES_DIR)) {
    console.log('策略目录不存在，无需迁移')
    return
  }

  const files = await readdir(STRATEGIES_DIR)
  const strategyFiles = files.filter(f => f.endsWith('.json') && !f.includes('archive'))

  console.log(`发现 ${strategyFiles.length} 个策略文件`)

  let migratedCount = 0
  for (const file of strategyFiles) {
    const filePath = join(STRATEGIES_DIR, file)
    const migrated = await migrateStrategyFile(filePath)
    if (migrated) {
      migratedCount++
    }
  }

  console.log(`\n迁移完成: ${migratedCount}/${strategyFiles.length} 个策略已更新`)
}

// 执行迁移
migrateAllStrategies().catch(error => {
  console.error('迁移失败:', error)
  process.exit(1)
})
