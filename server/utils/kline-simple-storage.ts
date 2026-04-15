import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { 
  KLineSingleFile, 
  SimpleKLineData, 
  KLineData,
  KLineTimeframe 
} from '../../types/kline-simple'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 获取数据目录路径
function getDataDir(): string {
  // 优先使用环境变量配置的目录
  if (process.env.KLINE_DATA_DIR) {
    return process.env.KLINE_DATA_DIR
  }
  
  // 其次尝试使用项目根目录下的 data/kline-simple
  const projectDataDir = path.join(process.cwd(), 'data', 'kline-simple')
  
  // 如果项目目录不可用，使用基于当前文件位置的相对路径
  try {
    // 检查项目目录是否可写
    fs.accessSync(path.join(process.cwd(), 'package.json'), fs.constants.R_OK)
    return projectDataDir
  } catch {
    // 如果无法访问项目根目录，使用相对路径
    return path.join(__dirname, '../../data/kline-simple')
  }
}

const DATA_DIR = getDataDir()

// 确保数据目录存在
function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      console.log(`已创建数据目录: ${DATA_DIR}`)
    }
  } catch (error: any) {
    console.error(`无法创建数据目录 ${DATA_DIR}:`, error.message)
    console.error('请检查目录权限或设置 KLINE_DATA_DIR 环境变量指定可写目录')
    throw error
  }
}

// 获取文件名（symbol-timeframe.json）
function getFileName(symbol: string, timeframe: KLineTimeframe): string {
  const normalizedSymbol = symbol.replace('/', '')
  return `${normalizedSymbol}-${timeframe}.json`
}

// 获取文件路径
function getFilePath(symbol: string, timeframe: KLineTimeframe): string {
  ensureDataDir()
  const fileName = getFileName(symbol, timeframe)
  return path.join(DATA_DIR, fileName)
}

// 读取K线数据文件（简单版本）
export function readSimpleKLineFile(
  symbol: string, 
  timeframe: KLineTimeframe
): KLineSingleFile | null {
  try {
    const filePath = getFilePath(symbol, timeframe)
    
    if (!fs.existsSync(filePath)) {
      return null
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(fileContent) as KLineSingleFile
  } catch (error) {
    console.error(`读取K线文件失败: ${symbol}/${timeframe}`, error)
    return null
  }
}

// 写入K线数据文件（简单版本）
export function writeSimpleKLineFile(
  symbol: string, 
  timeframe: KLineTimeframe, 
  data: KLineData[],
  maxBars: number = 11000
): boolean {
  try {
    const normalizedSymbol = symbol.replace('/', '')
    
    // 按时间戳排序
    const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp)
    
    // 去重（基于时间戳）
    const uniqueData: KLineData[] = []
    const seenTimestamps = new Set<number>()
    
    for (const item of sortedData) {
      if (!seenTimestamps.has(item.timestamp)) {
        seenTimestamps.add(item.timestamp)
        uniqueData.push(item)
      }
    }
    
    // 限制最多maxBars条数据
    const limitedData = uniqueData.slice(-maxBars)
    
    // 转换为简化格式
    const simpleData: SimpleKLineData[] = limitedData.map(item => ({
      t: item.timestamp,
      o: item.open,
      h: item.high,
      l: item.low,
      c: item.close,
      v: item.volume
    }))
    
    // 更新元数据
    const meta = {
      first: limitedData[0]?.timestamp || 0,
      last: limitedData[limitedData.length - 1]?.timestamp || 0,
      count: limitedData.length,
      max: maxBars,
      updated: Math.floor(Date.now() / 1000)
    }
    
    const fileData: KLineSingleFile = {
      symbol: normalizedSymbol,
      timeframe,
      data: simpleData,
      meta
    }
    
    const filePath = getFilePath(symbol, timeframe)
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8')
    
    return true
  } catch (error) {
    console.error(`写入K线文件失败: ${symbol}/${timeframe}`, error)
    return false
  }
}

// 追加K线数据（自动去重和限制）
export function appendSimpleKLineData(
  symbol: string, 
  timeframe: KLineTimeframe, 
  newData: KLineData[]
): boolean {
  try {
    // 读取现有数据
    const existingFile = readSimpleKLineFile(symbol, timeframe)
    let existingData: KLineData[] = []
    
    if (existingFile) {
      // 转换回完整格式
      existingData = existingFile.data.map(item => ({
        timestamp: item.t,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: item.v
      }))
    }
    
    // 合并数据
    const allData = [...existingData, ...newData]
    
    // 写入文件（会自动去重和限制）
    return writeSimpleKLineFile(symbol, timeframe, allData)
  } catch (error) {
    console.error(`追加K线数据失败: ${symbol}/${timeframe}`, error)
    return false
  }
}

// 获取K线数据（支持过滤）
export function getSimpleKLineData(
  symbol: string, 
  timeframe: KLineTimeframe, 
  options: {
    limit?: number
    from?: number
    to?: number
  } = {}
): SimpleKLineData[] {
  const { limit, from, to } = options
  
  try {
    const fileData = readSimpleKLineFile(symbol, timeframe)
    
    if (!fileData || !fileData.data || fileData.data.length === 0) {
      return []
    }
    
    let filteredData = fileData.data
    
    // 应用时间范围过滤
    if (from !== undefined) {
      filteredData = filteredData.filter(item => item.t >= from)
    }
    if (to !== undefined) {
      filteredData = filteredData.filter(item => item.t <= to)
    }
    
    // 限制数量
    if (limit !== undefined && limit > 0) {
      filteredData = filteredData.slice(-limit)
    }
    
    return filteredData
  } catch (error) {
    console.error(`获取K线数据失败: ${symbol}/${timeframe}`, error)
    return []
  }
}

// 获取最后一条K线数据的时间戳
export function getSimpleLastKLineTimestamp(
  symbol: string, 
  timeframe: KLineTimeframe
): number | null {
  try {
    const fileData = readSimpleKLineFile(symbol, timeframe)
    
    if (fileData && fileData.data && fileData.data.length > 0) {
      const lastItem = fileData.data[fileData.data.length - 1]
      return lastItem?.t || null
    }
    
    return null
  } catch (error) {
    console.error(`获取最后K线时间戳失败: ${symbol}/${timeframe}`, error)
    return null
  }
}

// 更新最后一根K线数据（用于未收盘K线）
export function updateLastKLine(
  symbol: string,
  timeframe: KLineTimeframe,
  bar: KLineData
): boolean {
  try {
    const fileData = readSimpleKLineFile(symbol, timeframe)
    
    if (!fileData || !fileData.data || fileData.data.length === 0) {
      console.warn(`无法更新最后一根K线：文件不存在或为空 ${symbol}/${timeframe}`)
      return false
    }
    
    const lastIndex = fileData.data.length - 1
    const lastBar = fileData.data[lastIndex]
    
    if (!lastBar) {
      console.warn(`无法获取最后一根K线数据: ${symbol}/${timeframe}`)
      return false
    }
    
    // 检查时间戳是否匹配
    if (lastBar.t !== bar.timestamp) {
      console.warn(`时间戳不匹配：文件最后时间戳 ${lastBar.t}，新数据时间戳 ${bar.timestamp}`)
      return false
    }
    
    // 更新最后一根K线
    fileData.data[lastIndex] = {
      t: bar.timestamp,
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume
    }
    
    // 更新元数据
    fileData.meta.updated = Math.floor(Date.now() / 1000)
    
    // 写入文件
    const filePath = getFilePath(symbol, timeframe)
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8')
    
    // console.log(`已更新最后一根K线: ${symbol}/${timeframe} 时间戳: ${bar.timestamp}`)
    return true
  } catch (error) {
    console.error(`更新最后一根K线失败: ${symbol}/${timeframe}`, error)
    return false
  }
}

// 获取所有已存储的交易对和周期
export function getSimpleStoredSymbols(): Array<{
  symbol: string
  timeframe: KLineTimeframe
  count: number
  lastUpdated: number
}> {
  try {
    ensureDataDir()
    
    if (!fs.existsSync(DATA_DIR)) {
      return []
    }
    
    const result: Array<{
      symbol: string
      timeframe: KLineTimeframe
      count: number
      lastUpdated: number
    }> = []
    
    const files = fs.readdirSync(DATA_DIR)
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(DATA_DIR, file)
          const fileContent = fs.readFileSync(filePath, 'utf-8')
          const fileData = JSON.parse(fileContent) as KLineSingleFile
          
          result.push({
            symbol: fileData.symbol,
            timeframe: fileData.timeframe,
            count: fileData.meta.count,
            lastUpdated: fileData.meta.updated
          })
        } catch (error: any) {
          console.warn(`解析文件失败: ${file}`, error)
        }
      }
    }
    
    return result
  } catch (error: any) {
    console.error('获取已存储交易对失败', error)
    return []
  }
}

// 删除K线数据文件
export function deleteKLineFile(
  symbol: string, 
  timeframe: KLineTimeframe
): boolean {
  try {
    const filePath = getFilePath(symbol, timeframe)
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
    
    return false
  } catch (error) {
    console.error(`删除K线文件失败: ${symbol}/${timeframe}`, error)
    return false
  }
}

// 清理所有数据
export function cleanupAllData(): boolean {
  try {
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR)
      
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file)
        fs.unlinkSync(filePath)
      }
      
      return true
    }
    
    return false
  } catch (error) {
    console.error('清理所有数据失败', error)
    return false
  }
}