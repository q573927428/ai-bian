import type { LogEntry } from '../../types'
import dayjs from 'dayjs'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// 内存日志存储（最多保留1000条）
const logBuffer: LogEntry[] = []
const MAX_BUFFER_SIZE = 1000

/**
 * 日志工具类
 */
export class Logger {
  private static instance: Logger
  private logsDir: string

  private constructor() {
    this.logsDir = join(process.cwd(), 'logs')
    this.ensureLogDir()
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  private async ensureLogDir() {
    if (!existsSync(this.logsDir)) {
      await mkdir(this.logsDir, { recursive: true })
    }
  }

  private createLogEntry(
    level: LogEntry['level'],
    category: string,
    message: string,
    data?: any
  ): LogEntry {
    return {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }
  }

  private addToBuffer(entry: LogEntry) {
    logBuffer.push(entry)
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      logBuffer.shift()
    }
  }

  private async writeToFile(entry: LogEntry) {
    try {
      const date = dayjs(entry.timestamp).format('YYYY-MM-DD')
      const logFile = join(this.logsDir, `${date}.log`)
      const logLine = `[${dayjs(entry.timestamp).format('HH:mm:ss')}] [${entry.level}] [${entry.category}] ${entry.message}${entry.data ? ' | ' + JSON.stringify(entry.data) : ''}\n`
      
      await writeFile(logFile, logLine, { flag: 'a' })
    } catch (error) {
      console.error('写入日志文件失败:', error)
    }
  }

  private log(entry: LogEntry) {
    // 控制台输出
    const timestamp = dayjs(entry.timestamp).format('YYYY-MM-DD HH:mm:ss')
    const prefix = `[${timestamp}] [${entry.level}] [${entry.category}]`
    
    switch (entry.level) {
      case 'ERROR':
        console.error(prefix, entry.message, entry.data || '')
        break
      case 'WARN':
        console.warn(prefix, entry.message, entry.data || '')
        break
      case 'SUCCESS':
        console.log(prefix, '✅', entry.message, entry.data || '')
        break
      default:
        console.log(prefix, entry.message, entry.data || '')
    }

    // 添加到缓冲区
    this.addToBuffer(entry)

    // 异步写入文件
    this.writeToFile(entry)
  }

  info(category: string, message: string, data?: any) {
    const entry = this.createLogEntry('INFO', category, message, data)
    this.log(entry)
  }

  warn(category: string, message: string, data?: any) {
    const entry = this.createLogEntry('WARN', category, message, data)
    this.log(entry)
  }

  error(category: string, message: string, data?: any) {
    const entry = this.createLogEntry('ERROR', category, message, data)
    this.log(entry)
  }

  success(category: string, message: string, data?: any) {
    const entry = this.createLogEntry('SUCCESS', category, message, data)
    this.log(entry)
  }

  getRecentLogs(limit: number = 300): LogEntry[] {
    return logBuffer.slice(-limit)
  }

  clearBuffer() {
    logBuffer.length = 0
  }
}

// 导出单例
export const logger = Logger.getInstance()
