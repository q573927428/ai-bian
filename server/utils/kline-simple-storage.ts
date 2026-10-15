// ==================== K线 node:sqlite 存储模块 ====================

/**
 * K线数据 SQLite 存储模块
 *
 * 使用 Node.js 内置 node:sqlite 直接访问磁盘数据库。
 * 运行环境必须支持 node:sqlite，不再提供内存数据库回退路径。
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import type { 
  KLineSingleFile, 
  SimpleKLineData, 
  KLineData,
  KLineTimeframe 
} from '../../types/kline-simple'
import type { OHLCV } from '../../types'

// ==================== 数据库单例 ====================

let db: DatabaseSync | null = null
let dbReady = false
let dbInitPromise: Promise<void> | null = null
// 进程内记录最近一次成功写入时间，避免为新鲜度诊断改动现有数据库结构。
const klineWriteTimes = new Map<string, number>()

const MAX_BARS = 495

function getDbPath(): string {
  if (process.env.KLINE_DATA_DIR) {
    return path.join(process.env.KLINE_DATA_DIR, 'kline.db')
  }
  return path.join(process.cwd(), 'data', 'kline.db')
}

/**
 * 初始化数据库（异步，必须在任何操作之前调用）
 */
export async function initKLineDb(): Promise<void> {
  if (dbReady) return
  if (dbInitPromise) return dbInitPromise

  dbInitPromise = (async () => {
    try {
      const dbPath = getDbPath()
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      db = await initNodeSqliteBackend(dbPath)

      // 创建表结构
      db.exec(`
        CREATE TABLE IF NOT EXISTS kline_data (
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL,
          PRIMARY KEY (symbol, timeframe, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_kline_lookup 
          ON kline_data(symbol, timeframe, timestamp DESC);

      `)

      dbReady = true
      console.log('✅ K线数据库初始化完成，驱动: node:sqlite')
    } catch (error) {
      if (db) {
        try {
          db.close()
        } catch {
          // 初始化失败后的关闭异常不应覆盖原始错误。
        }
      }
      db = null
      console.error('❌ K线数据库初始化失败:', error)
      dbInitPromise = null
      throw error
    }
  })()

  return dbInitPromise
}

/**
 * 初始化 Node.js 内置 SQLite 后端。
 */
async function initNodeSqliteBackend(dbPath: string): Promise<DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(dbPath)

  try {
    // 使用单文件 rollback journal，避免部署和备份时遗漏 WAL 文件。
    database.exec('PRAGMA journal_mode = DELETE')
    database.exec('PRAGMA synchronous = NORMAL')
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec('PRAGMA temp_store = MEMORY')
    database.exec('PRAGMA cache_size = -16000')
  } catch (error) {
    database.close()
    throw error
  }

  console.log(`✅ 使用 node:sqlite 磁盘数据库: ${dbPath}`)
  return database
}

/**
 * 获取数据库实例（同步，调用前必须确保 initKLineDb() 已完成）
 */
function getDb(): DatabaseSync {
  if (!db || !dbReady) {
    throw new Error('K线数据库未初始化，请先调用 initKLineDb()')
  }
  return db
}

/**
 * 兼容原有调用接口。node:sqlite 的事务会直接持久化，无需额外保存。
 */
export async function saveDb(): Promise<void> {
  return
}

/**
 * 兼容原有强制保存接口。node:sqlite 下无需执行额外操作。
 */
export async function flushDb(): Promise<void> {
  await saveDb()
}

/**
 * 关闭数据库连接
 */
export async function closeKLineDb(): Promise<void> {
  if (db) {
    db.close()
    db = null
    dbReady = false
    dbInitPromise = null
  }
}

// ==================== 查询辅助函数 ====================

/**
 * 执行参数化查询并返回所有行（对象数组）
 */
function queryAll<T = Record<string, unknown>>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[]
}

/**
 * 执行参数化查询并返回第一行
 */
function queryOne<T = Record<string, unknown>>(sql: string, params: any[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined
}

/**
 * 执行非查询语句（INSERT/UPDATE/DELETE）
 */
function execute(sql: string, params: any[] = []): void {
  runSql(sql, params)
}

/**
 * 执行不返回结果的 SQL。
 */
function runSql(sql: string, params: any[] = []): void {
  const database = getDb()
  if (params.length > 0) database.prepare(sql).run(...params)
  else database.exec(sql)
}

/** 记录某交易对/周期最近一次成功写入 K 线的本地时间。 */
function markKLineUpdated(symbol: string, timeframe: KLineTimeframe): void {
  klineWriteTimes.set(`${normalizeSymbol(symbol)}_${timeframe}`, Date.now())
}

/** 获取最近一次成功写入 K 线的时间，用于判断同步是否真正停滞。 */
export function getSimpleKLineLastUpdatedAt(symbol: string, timeframe: KLineTimeframe): number | null {
  return klineWriteTimes.get(`${normalizeSymbol(symbol)}_${timeframe}`) ?? null
}

/**
 * 批量执行同一个写入语句，复用 prepared statement 降低 K 线同步开销。
 */
function executePreparedBatch(sql: string, rows: any[][]): void {
  const statement: StatementSync = getDb().prepare(sql)
  for (const params of rows) statement.run(...params)
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace('/', '')
}

// ==================== 读取函数 ====================

/**
 * 读取 K线文件（完整格式，兼容旧 API）
 */
export function readSimpleKLineFile(
  symbol: string,
  timeframe: KLineTimeframe
): KLineSingleFile | null {
  const normSymbol = normalizeSymbol(symbol)
  
  const rows = queryAll<{
    timestamp: number; open: number; high: number; low: number; close: number; volume: number
  }>(
    `SELECT timestamp, open, high, low, close, volume 
     FROM kline_data 
     WHERE symbol = ? AND timeframe = ?
     ORDER BY timestamp ASC`,
    [normSymbol, timeframe]
  )
  
  if (rows.length === 0) return null
  
  const data: SimpleKLineData[] = rows.map(r => ({
    t: r.timestamp,
    o: r.open,
    h: r.high,
    l: r.low,
    c: r.close,
    v: r.volume
  }))
  
  return {
    symbol: normSymbol,
    timeframe,
    data,
    meta: {
      first: data[0]!.t,
      last: data[data.length - 1]!.t,
      count: data.length,
      max: MAX_BARS,
      updated: getUpdatedAt(normSymbol, timeframe)
    }
  }
}

/**
 * 获取 K线数据（支持 limit/from/to 过滤）
 */
export function getSimpleKLineData(
  symbol: string,
  timeframe: KLineTimeframe,
  options: {
    limit?: number
    from?: number
    to?: number
  } = {}
): SimpleKLineData[] {
  const normSymbol = normalizeSymbol(symbol)
  const { limit, from, to } = options
  
  let sql = 'SELECT timestamp, open, high, low, close, volume FROM kline_data WHERE symbol = ? AND timeframe = ?'
  const params: (string | number)[] = [normSymbol, timeframe]
  
  if (from !== undefined) {
    sql += ' AND timestamp >= ?'
    params.push(from)
  }
  if (to !== undefined) {
    sql += ' AND timestamp <= ?'
    params.push(to)
  }
  
  if (limit !== undefined && limit > 0) {
    // 需要取最后 limit 条，先倒序取再反转
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    
    const rows = queryAll<{
      timestamp: number; open: number; high: number; low: number; close: number; volume: number
    }>(sql, params)
    
    // 反转回正序
    return rows.reverse().map(r => ({
      t: r.timestamp,
      o: r.open,
      h: r.high,
      l: r.low,
      c: r.close,
      v: r.volume
    }))
  }
  
  sql += ' ORDER BY timestamp ASC'
  
  const rows = queryAll<{
    timestamp: number; open: number; high: number; low: number; close: number; volume: number
  }>(sql, params)
  
  return rows.map(r => ({
    t: r.timestamp,
    o: r.open,
    h: r.high,
    l: r.low,
    c: r.close,
    v: r.volume
  }))
}

/**
 * 获取最后一条 K线的时间戳
 */
export function getSimpleLastKLineTimestamp(
  symbol: string,
  timeframe: KLineTimeframe
): number | null {
  const normSymbol = normalizeSymbol(symbol)
  
  const row = queryOne<{ timestamp: number }>(
    `SELECT timestamp FROM kline_data 
     WHERE symbol = ? AND timeframe = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [normSymbol, timeframe]
  )
  
  return row?.timestamp ?? null
}

/**
 * 获取所有已存储的交易对和周期信息
 */
export function getSimpleStoredSymbols(): Array<{
  symbol: string
  timeframe: KLineTimeframe
  count: number
  lastUpdated: number
}> {
  const rows = queryAll<{
    symbol: string; timeframe: string; count: number; last_ts: number
  }>(
    `SELECT symbol, timeframe, COUNT(*) as count, MAX(timestamp) as last_ts
     FROM kline_data
     GROUP BY symbol, timeframe
     ORDER BY symbol, timeframe`
  )
  
  return rows.map(r => ({
    symbol: r.symbol,
    timeframe: r.timeframe as KLineTimeframe,
    count: r.count,
    lastUpdated: r.last_ts
  }))
}

/**
 * 获取指定交易对/周期的 K线数量
 */
export function getSimpleKLineCount(
  symbol: string,
  timeframe: KLineTimeframe
): number {
  const normSymbol = normalizeSymbol(symbol)

  const row = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM kline_data
     WHERE symbol = ? AND timeframe = ?`,
    [normSymbol, timeframe]
  )

  return row?.count ?? 0
}

/**
 * 获取 OHLCV 格式的 K线数据（供 IndicatorsHub 使用）
 */
export function getSimpleKLineAsOHLCV(
  symbol: string,
  timeframe: KLineTimeframe,
  limit?: number
): OHLCV[] {
  const simpleData = getSimpleKLineData(symbol, timeframe, { limit })
  return simpleData.map(item => ({
    timestamp: item.t * 1000,
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v
  }))
}

/**
 * 获取最后更新标识（解决 volume 更新不感知问题）
 * 
 * 返回字符串复合标识：`最大时间戳_最后一根K线volume`，
 * 只要 timestamp 或 volume 任意一个变了，返回值就不同。
 * 使用字符串拼接，永不溢出、永不碰撞。
 */
export function getKLineFileMTime(
  symbol: string,
  timeframe: KLineTimeframe
): string | null {
  const normSymbol = normalizeSymbol(symbol)
  const row = queryOne<{
    last_ts: number | null
    last_volume: number | null
  }>(
    `SELECT 
      MAX(timestamp) as last_ts,
      (SELECT volume 
       FROM kline_data 
       WHERE symbol = ? AND timeframe = ? 
       ORDER BY timestamp DESC LIMIT 1) as last_volume
     FROM kline_data
     WHERE symbol = ? AND timeframe = ?`,
    [normSymbol, timeframe, normSymbol, timeframe]
  )
  if (!row || row.last_ts === null) return null
  // 关键：字符串组合，永不重复
  return `${row.last_ts}_${row.last_volume ?? 0}`
}

/**
 * 检查是否有 K线数据
 */
export function hasKLineData(
  symbol: string,
  timeframe: KLineTimeframe
): boolean {
  const normSymbol = normalizeSymbol(symbol)
  
  const row = queryOne(
    `SELECT 1 FROM kline_data 
     WHERE symbol = ? AND timeframe = ? 
     LIMIT 1`,
    [normSymbol, timeframe]
  )
  
  return row !== undefined
}

// ==================== 写入函数 ====================

/**
 * 写入全量 K线数据（去重、排序、限制数量）
 */
export function writeSimpleKLineFile(
  symbol: string,
  timeframe: KLineTimeframe,
  data: KLineData[],
  maxBars: number = MAX_BARS
): boolean {
  const normSymbol = normalizeSymbol(symbol)
  
  // 排序
  const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp)
  
  // 去重
  const uniqueData: KLineData[] = []
  const seenTimestamps = new Set<number>()
  for (const item of sortedData) {
    if (!seenTimestamps.has(item.timestamp)) {
      seenTimestamps.add(item.timestamp)
      uniqueData.push(item)
    }
  }
  
  // 限制数量
  const limitedData = uniqueData.slice(-maxBars)
  
  try {
    // 手动事务
    runSql('BEGIN')
    
    try {
      // 删除超出范围的数据
      if (limitedData.length > 0) {
        const firstTs = limitedData[0]!.timestamp
        const lastTs = limitedData[limitedData.length - 1]!.timestamp
        
        runSql(
          `DELETE FROM kline_data 
           WHERE symbol = ? AND timeframe = ? 
           AND (timestamp < ? OR timestamp > ?)`,
          [normSymbol, timeframe, firstTs, lastTs]
        )
      } else {
        runSql(
          `DELETE FROM kline_data WHERE symbol = ? AND timeframe = ?`,
          [normSymbol, timeframe]
        )
      }
      
      // 插入所有数据
      executePreparedBatch(
        `INSERT OR REPLACE INTO kline_data (symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        limitedData.map(item => [normSymbol, timeframe, item.timestamp, item.open, item.high, item.low, item.close, item.volume])
      )

      runSql('COMMIT')
      if (limitedData.length > 0) markKLineUpdated(normSymbol, timeframe)
      return true
    } catch (innerError) {
      runSql('ROLLBACK')
      throw innerError
    }
  } catch (error) {
    console.error(`SQLite 写入失败: ${normSymbol}/${timeframe}`, error)
    return false
  }
}

/**
 * 追加 K线数据（自动去重和限制）
 */
export function appendSimpleKLineData(
  symbol: string,
  timeframe: KLineTimeframe,
  newData: KLineData[]
): boolean {
  const normSymbol = normalizeSymbol(symbol)
  
  try {
    runSql('BEGIN')
    
    try {
      // 排序新数据
      const sortedNewData = [...newData].sort((a, b) => a.timestamp - b.timestamp)
      
      // 插入新数据（INSERT OR REPLACE 自动去重）
      executePreparedBatch(
        `INSERT OR REPLACE INTO kline_data (symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sortedNewData.map(item => [normSymbol, timeframe, item.timestamp, item.open, item.high, item.low, item.close, item.volume])
      )

      // 删除超出 MAX_BARS 的旧数据
      runSql(
        `DELETE FROM kline_data 
         WHERE symbol = ? AND timeframe = ?
         AND timestamp NOT IN (
           SELECT timestamp FROM kline_data 
           WHERE symbol = ? AND timeframe = ?
           ORDER BY timestamp DESC 
           LIMIT ?
         )`,
        [normSymbol, timeframe, normSymbol, timeframe, MAX_BARS]
      )
      
      runSql('COMMIT')
      if (sortedNewData.length > 0) markKLineUpdated(normSymbol, timeframe)
      return true
    } catch (innerError) {
      runSql('ROLLBACK')
      throw innerError
    }
  } catch (error) {
    console.error(`SQLite 追加失败: ${normSymbol}/${timeframe}`, error)
    return false
  }
}

/**
 * 更新最后一根 K线（用于未收盘 K线）
 */
export function updateLastKLine(
  symbol: string,
  timeframe: KLineTimeframe,
  bar: KLineData
): boolean {
  const normSymbol = normalizeSymbol(symbol)
  
  // 先检查最后一条记录的时间戳是否匹配
  const lastRow = queryOne<{ timestamp: number }>(
    `SELECT timestamp FROM kline_data 
     WHERE symbol = ? AND timeframe = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [normSymbol, timeframe]
  )
  
  if (!lastRow) {
    console.warn(`无法更新最后一根K线：无数据 ${normSymbol}/${timeframe}`)
    return false
  }
  
  if (lastRow.timestamp !== bar.timestamp) {
    console.warn(`时间戳不匹配：DB最后时间戳 ${lastRow.timestamp}，新数据时间戳 ${bar.timestamp}`)
    return false
  }
  
  try {
      execute(
      `UPDATE kline_data 
       SET open = ?, high = ?, low = ?, close = ?, volume = ?
       WHERE symbol = ? AND timeframe = ? AND timestamp = ?`,
      [bar.open, bar.high, bar.low, bar.close, bar.volume, normSymbol, timeframe, bar.timestamp]
      )
    markKLineUpdated(normSymbol, timeframe)
    return true
  } catch (error) {
    console.error(`SQLite 更新最后一根K线失败: ${normSymbol}/${timeframe}`, error)
    return false
  }
}

/**
 * 删除指定 K线数据
 */
export function deleteKLineFile(
  symbol: string,
  timeframe: KLineTimeframe
): boolean {
  const normSymbol = normalizeSymbol(symbol)
  
  try {
    // 删除前统计记录数，以保持该接口原有的布尔返回语义。
    const before = queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM kline_data WHERE symbol = ? AND timeframe = ?`,
      [normSymbol, timeframe]
    )
    
    execute(
      `DELETE FROM kline_data WHERE symbol = ? AND timeframe = ?`,
      [normSymbol, timeframe]
    )
    
    return before != null && before.c > 0
  } catch (error) {
    console.error(`SQLite 删除失败: ${normSymbol}/${timeframe}`, error)
    return false
  }
}

/**
 * 清理所有数据
 */
export function cleanupAllData(): boolean {
  try {
    const before = queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM kline_data`
    )
    
    runSql('DELETE FROM kline_data')
    
    return before != null && before.c > 0
  } catch (error) {
    console.error('SQLite 清理所有数据失败', error)
    return false
  }
}

// ==================== 辅助函数 ====================

/**
 * 获取指定 symbol/timeframe 的最后更新时间戳（秒）
 */
function getUpdatedAt(symbol: string, timeframe: string): number {
  const row = queryOne<{ last_ts: number | null }>(
    `SELECT MAX(timestamp) as last_ts FROM kline_data 
     WHERE symbol = ? AND timeframe = ?`,
    [symbol, timeframe]
  )
  
  return row?.last_ts ?? 0
}

/**
 * 从本地1h K线数据计算24h涨跌幅和成交量（方案B：精确滚动24h）
 * 
 * 计算逻辑：
 * - change24hPercent: 当前价格 vs 24小时前（第24根1h K线）的收盘价
 * - volume24h: 最近24根1h K线的volume之和（排除当前未收盘的K线）
 * 
 * @param symbol 交易对（如 BTC/USDT 或 BTCUSDT）
 * @returns { change24hPercent, volume24h } 或 null（数据不足时）
 */
export function getLocal24hStatsPrecise(symbol: string): {
  change24hPercent: number
  volume24h: number
} | null {
  const normSymbol = normalizeSymbol(symbol)
  
  // 获取最近25根1h K线（24小时 + 1根当前未收盘的）
  const rows = queryAll<{
    close: number; volume: number; timestamp: number
  }>(
    `SELECT close, volume, timestamp FROM kline_data 
     WHERE symbol = ? AND timeframe = '1h'
     ORDER BY timestamp DESC LIMIT 25`,
    [normSymbol]
  )
  
  if (rows.length < 2) return null
  
  // 当前价格 = 最新的收盘价（可能是未收盘K线的当前价）
  const currentPrice = rows[0]!.close
  
  // 24小时前的价格：取第24根K线的收盘价（0-indexed）
  // 如果不够24根，用最早的那根
  const prevPrice = rows.length >= 24 
    ? rows[23]!.close
    : rows[rows.length - 1]!.close
  
  // 成交量：最近24根1h K线的volume之和（包含当前未收盘的K线）
  // 取 rows[0] 到 rows[23]（共24根）
  const volumeRows = rows.slice(0, 24)
  const volume24h = volumeRows.reduce((sum, r) => sum + r.volume, 0)
  
  // 计算涨跌幅
  const change24hPercent = prevPrice > 0 
    ? Number(((currentPrice - prevPrice) / prevPrice * 100).toFixed(2))
    : 0
  
  return {
    change24hPercent,
    volume24h: Number(volume24h.toFixed(2))
  }
}
