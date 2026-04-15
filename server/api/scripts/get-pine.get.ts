import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  try {
    // 检查文件是否存在
    const filePath = join(process.cwd(), 'test', 'trade-history.pine')
    
    if (!existsSync(filePath)) {
      return {
        success: false,
        message: 'Pine脚本文件不存在',
        error: `找不到文件: ${filePath}`,
        suggestion: '请先使用"生成Pine脚本"功能创建文件'
      }
    }

    // 读取文件内容
    const content = readFileSync(filePath, 'utf-8')
    
    // 获取文件信息
    const stats = statSync(filePath)
    
    return {
      success: true,
      message: '获取Pine脚本成功',
      content: content,
      fileInfo: {
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        created: stats.ctime
      }
    }

  } catch (error: any) {
    console.error('读取Pine脚本文件错误:', error)
    return {
      success: false,
      message: '读取Pine脚本时发生错误',
      error: error.message || String(error)
    }
  }
})
