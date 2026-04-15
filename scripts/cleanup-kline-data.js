#!/usr/bin/env node

/**
 * K线数据清理工具
 * 用于将现有的K线数据文件从22000条截断为11000条
 * 使用方法: node scripts/cleanup-kline-data.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置
const MAX_BARS = 11000
const DATA_DIR = path.join(process.cwd(), 'data', 'kline-simple')

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`数据目录不存在: ${DATA_DIR}`)
    process.exit(1)
  }
}

// 获取所有K线数据文件
function getKLineFiles() {
  try {
    const files = fs.readdirSync(DATA_DIR)
    return files.filter(file => file.endsWith('.json'))
  } catch (error) {
    console.error('读取数据目录失败:', error.message)
    return []
  }
}

// 清理单个文件
function cleanupFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName)
  
  try {
    // 读取文件内容
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const fileData = JSON.parse(fileContent)
    
    const originalCount = fileData.data.length
    const originalMax = fileData.meta.max
    
    // 如果数据条数不超过MAX_BARS，跳过
    if (originalCount <= MAX_BARS && originalMax <= MAX_BARS) {
      console.log(`✓ ${fileName}: 已有 ${originalCount} 条数据，无需清理`)
      return { cleaned: false, originalCount, newCount: originalCount }
    }
    
    // 截断数据为最新的MAX_BARS条
    const truncatedData = fileData.data.slice(-MAX_BARS)
    
    // 更新元数据
    fileData.data = truncatedData
    fileData.meta.count = truncatedData.length
    fileData.meta.max = MAX_BARS
    fileData.meta.first = truncatedData[0]?.t || 0
    fileData.meta.last = truncatedData[truncatedData.length - 1]?.t || 0
    fileData.meta.updated = Math.floor(Date.now() / 1000)
    
    // 写回文件
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8')
    
    console.log(`✓ ${fileName}: 从 ${originalCount} 条清理到 ${truncatedData.length} 条`)
    
    return { 
      cleaned: true, 
      originalCount, 
      newCount: truncatedData.length,
      removed: originalCount - truncatedData.length
    }
    
  } catch (error) {
    console.error(`✗ ${fileName}: 清理失败 - ${error.message}`)
    return { cleaned: false, error: error.message }
  }
}

// 主函数
async function main() {
  console.log('🔧 K线数据清理工具')
  console.log(`目标: 将所有K线数据文件限制为最多 ${MAX_BARS} 条数据`)
  console.log(`数据目录: ${DATA_DIR}`)
  console.log('=' * 50)
  
  // 检查数据目录
  ensureDataDir()
  
  // 获取所有文件
  const files = getKLineFiles()
  
  if (files.length === 0) {
    console.log('未找到K线数据文件')
    return
  }
  
  console.log(`找到 ${files.length} 个K线数据文件`)
  console.log('开始清理...')
  console.log('')
  
  let totalCleaned = 0
  let totalOriginalBars = 0
  let totalNewBars = 0
  let totalRemoved = 0
  
  // 清理每个文件
  for (const file of files) {
    const result = cleanupFile(file)
    
    if (result.cleaned) {
      totalCleaned++
      totalOriginalBars += result.originalCount
      totalNewBars += result.newCount
      totalRemoved += result.removed
    }
  }
  
  console.log('')
  console.log('=' * 50)
  console.log('清理完成!')
  console.log(`总计: ${files.length} 个文件`)
  console.log(`已清理: ${totalCleaned} 个文件`)
  console.log(`原始数据总量: ${totalOriginalBars} 条`)
  console.log(`新数据总量: ${totalNewBars} 条`)
  console.log(`移除数据总量: ${totalRemoved} 条`)
  console.log(`节省空间: ${((totalRemoved / totalOriginalBars) * 100).toFixed(2)}%`)
  
  if (totalCleaned > 0) {
    console.log('')
    console.log('💡 提示:')
    console.log('1. 下次K线同步时，系统会自动限制为11000条数据')
    console.log('2. 如果需要恢复原始数据，请从备份中恢复')
  }
}

// 执行主函数
main().catch(error => {
  console.error('清理过程中发生错误:', error)
  process.exit(1)
})