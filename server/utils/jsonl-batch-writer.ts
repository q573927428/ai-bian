// ==================== JSONL批量写入器 ====================

import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

/**
 * 批量写入配置
 */
export interface BatchWriterConfig {
  // 批量大小（条）
  batchSize?: number
  // 刷新间隔（毫秒）
  flushInterval?: number
  // 最大文件大小（字节）
  maxFileSize?: number
  // 启用压缩（暂不实现）
  enableCompression?: boolean
}

/**
 * 写入任务
 */
interface WriteTask {
  data: any
  timestamp: number
}

const DEFAULT_CONFIG: BatchWriterConfig = {
  batchSize: 50,
  flushInterval: 3000,
  maxFileSize: 10 * 1024 * 1024 // 10MB
}

/**
 * JSONL批量写入器
 *
 * 将多条记录批量写入JSONL文件，减少磁盘IO次数
 */
export class JSONLBatchWriter {
  private config: BatchWriterConfig
  private baseDir: string
  private filePrefix: string
  
  // 缓冲区
  private buffer: WriteTask[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isFlushing = false
  
  // 当前文件信息
  private currentFilePath: string | null = null
  private currentFileSize: number = 0
  
  // 统计信息
  private stats = {
    totalRecords: 0,
    totalBatches: 0,
    totalFiles: 0,
    totalBytes: 0
  }

  constructor(
    baseDir: string,
    filePrefix: string,
    config?: BatchWriterConfig
  ) {
    this.baseDir = baseDir
    this.filePrefix = filePrefix
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    this.init()
  }

  private init(): void {
    // 确保目录存在
    fs.mkdir(this.baseDir, { recursive: true }).catch(error => {
      logger.error('JSONLBatchWriter', '创建目录失败:', error.message)
    })
    
    // 启动定时器
    this.startFlushTimer()
    
    // logger.info('JSONLBatchWriter', `JSONL批量写入器已初始化: ${this.filePrefix}, 批量大小: ${this.config.batchSize}`)
  }

  /**
   * 启动刷新定时器
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        logger.error('JSONLBatchWriter', '定时刷新失败:', error.message)
      })
    }, this.config.flushInterval)
  }

  /**
   * 添加记录到缓冲区
   */
  async write(data: any): Promise<void> {
    this.buffer.push({
      data,
      timestamp: Date.now()
    })
    
    this.stats.totalRecords++
    
    // 检查是否需要立即刷新
    if (this.buffer.length >= this.config.batchSize!) {
      await this.flush()
    }
  }

  /**
   * 批量写入多条记录
   */
  async writeBatch(dataArray: any[]): Promise<void> {
    for (const data of dataArray) {
      this.buffer.push({
        data,
        timestamp: Date.now()
      })
      this.stats.totalRecords++
    }
    
    if (this.buffer.length >= this.config.batchSize!) {
      await this.flush()
    }
  }

  /**
   * 刷新缓冲区到文件
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return
    }
    
    this.isFlushing = true
    
    try {
      const tasksToWrite = [...this.buffer]
      this.buffer = []
      
      const filePath = await this.getFilePath()
      
      // 转换为JSONL格式
      const jsonlContent = tasksToWrite
        .map(task => JSON.stringify(task.data))
        .join('\n') + '\n'
      
      // 追加写入
      await fs.appendFile(filePath, jsonlContent, 'utf-8')
      
      // 更新统计
      this.stats.totalBatches++
      this.stats.totalBytes += Buffer.byteLength(jsonlContent, 'utf-8')
      this.currentFileSize += Buffer.byteLength(jsonlContent, 'utf-8')
      
      // 检查是否需要滚动文件
      if (this.currentFileSize >= this.config.maxFileSize!) {
        this.currentFilePath = null
        this.currentFileSize = 0
        this.stats.totalFiles++
      }
      
      // logger.info('JSONLBatchWriter', `已刷新 ${tasksToWrite.length} 条记录到 ${filePath}`)
    } catch (error: any) {
      logger.error('JSONLBatchWriter', '刷新失败:', error.message)
      // 失败时将任务放回缓冲区
      // this.buffer.unshift(...tasksToWrite)
    } finally {
      this.isFlushing = false
    }
  }

  /**
   * 获取当前文件路径
   */
  private async getFilePath(): Promise<string> {
    if (this.currentFilePath && this.currentFileSize < this.config.maxFileSize!) {
      return this.currentFilePath
    }
    
    // 生成新文件名（带日期和序号）
    const date = new Date()
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    
    let fileIndex = 0
    let filePath: string
    
    do {
      const suffix = fileIndex > 0 ? `-${fileIndex}` : ''
      const fileName = `${this.filePrefix}-${dateStr}${suffix}.jsonl`
      filePath = path.join(this.baseDir, fileName)
      
      try {
        const stats = await fs.stat(filePath)
        if (stats.size < this.config.maxFileSize!) {
          this.currentFilePath = filePath
          this.currentFileSize = stats.size
          return filePath
        }
        fileIndex++
      } catch {
        // 文件不存在，创建新文件
        this.currentFilePath = filePath
        this.currentFileSize = 0
        this.stats.totalFiles++
        return filePath
      }
    } while (true)
  }

  /**
   * 强制刷新并关闭
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    
    await this.flush()
    
    logger.info('JSONLBatchWriter', 'JSONL批量写入器已关闭')
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.buffer.length,
      currentFileSize: this.currentFileSize
    }
  }
}

/**
 * AI分析结果专用写入器
 */
export class AIAnalysisWriter {
  private writer: JSONLBatchWriter
  
  constructor(baseDir: string = 'data/ai-analysis') {
    this.writer = new JSONLBatchWriter(baseDir, 'ai-analysis', {
      batchSize: 20,
      flushInterval: 2000,
      maxFileSize: 10 * 1024 * 1024
    })
  }

  async write(analysis: any): Promise<void> {
    await this.writer.write(analysis)
  }

  async flush(): Promise<void> {
    await this.writer.flush()
  }

  async close(): Promise<void> {
    await this.writer.close()
  }

  getStats() {
    return this.writer.getStats()
  }
}

// 单例实例（用于AI分析结果写入）
let aiAnalysisWriterInstance: AIAnalysisWriter | null = null

export function getAIAnalysisWriter(): AIAnalysisWriter {
  if (!aiAnalysisWriterInstance) {
    aiAnalysisWriterInstance = new AIAnalysisWriter()
  }
  return aiAnalysisWriterInstance
}