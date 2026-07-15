/**
 * K线数据 SQLite 存储模块（基于 sql.js）
 * 
 * sql.js 是 SQLite 的纯 JavaScript/WASM 实现，不依赖原生模块。
 * 数据库在内存中运行，定期/变更后持久化到磁盘。
 */
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import type { 
  KLineSingleFile, 
  SimpleKLineData, 
  KLineData,
  KLineTimeframe 
} from '../../types/kline-simple'
import type { OHLCV } from '../../types'

// ==================== 数据库单例 ====================

let SQL: SqlJsStatic | null = null
let db: SqlJsDatabase | null = null
let dbReady = false
let dbInitPromise: Promise<void> | null = null
let dirty = false
let saveTimer: NodeJS.Timeout | null = null

const MAX_BARS = 2233
const SAVE_THROTTLE_MS = 60 * 60 * 1000 // 60分钟节流保存（不管写入多频繁，固定每60分钟保存一次）

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
      // 加载 sql.js WASM
      // 尝试多个可能的路径查找 WASM 文件，兼容开发和生产环境
      const possiblePaths = [
        // 开发环境：从当前文件所在 node_modules
        path.resolve(new URL('.', import.meta.url).pathname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        // 开发环境：从项目根目录
        path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        // 生产环境（Nitro 构建后）
        path.resolve(process.cwd(), '.output', 'server', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      ]
      
      let wasmPath = ''
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          wasmPath = p
          break
        }
      }
      
      if (!wasmPath) {
        throw new Error('无法找到 sql-wasm.wasm 文件，请确保 sql.js 依赖已正确安装')
      }
      
      SQL = await initSqlJs({
        locateFile: (file: string) => wasmPath
      })

      const dbPath = getDbPath()
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // 尝试从磁盘加载现有数据库
      if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath)
        db = new SQL.Database(buffer)
        console.log(`✅ 已从磁盘加载数据库: ${dbPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
      } else {
        db = new SQL.Database()
        console.log('🆕 创建新的内存数据库')
      }

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
      console.log('✅ K线数据库初始化完成')
    } catch (error) {
      console.error('❌ K线数据库初始化失败:', error)
      dbInitPromise = null
      throw error
    }
  })()

  return dbInitPromise
}

/**
 * 获取数据库实例（同步，调用前必须确保 initKLineDb() 已完成）
 */
function getDb(): SqlJsDatabase {
  if (!db || !dbReady) {
    throw new Error('K线数据库未初始化，请先调用 initKLineDb()')
  }
  return db
}

/**
 * 标记数据已变更并触发保存（节流模式）
 * 
 * 节流 vs 防抖：
 * - 防抖：持续写入会不断重置定时器，导致永不保存
 * - 节流：不管写入多频繁，固定每 SAVE_THROTTLE_MS 保存一次
 * 
 * 因为所有读取都走内存，磁盘文件仅作为持久化备份，
 * 所以即使 10 分钟才保存一次也完全安全。
 */
function markDirty(): void {
  dirty = true
  // 节流：已有定时器在跑则跳过，确保固定间隔保存
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveDb().catch(err => {
      console.error('自动保存数据库失败:', err)
    })
  }, SAVE_THROTTLE_MS)
}

/**
 * 立即保存数据库到磁盘
 */
export async function saveDb(): Promise<void> {
  const database = db
  if (!database || !dbReady) return

  try {
    const buffer = database.export()
    const dbPath = getDbPath()
    const tmpPath = dbPath + '.tmp'

    // 先写入临时文件，再原子重命名
    fs.writeFileSync(tmpPath, Buffer.from(buffer))
    fs.renameSync(tmpPath, dbPath)
    dirty = false
  } catch (error) {
    console.error('保存数据库失败:', error)
    throw error
  }
}

/**
 * 强制立即保存（跳过防抖）
 */
export async function flushDb(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveDb()
}

/**
 * 关闭数据库连接
 */
export async function closeKLineDb(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  // 关闭前先保存
  if (dirty) {
    await saveDb()
  }

  if (db) {
    db.close()
    db = null
    dbReady = false
    SQL = null
  }
}

// ==================== 查询辅助函数 ====================

/**
 * 执行参数化查询并返回所有行（对象数组）
 */
function queryAll<T = Record<string, unknown>>(sql: string, params: any[] = []): T[] {
  const database = getDb()
  const stmt = database.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T)
  }
  stmt.free()
  return rows
}

/**
 * 执行参数化查询并返回第一行
 */
function queryOne<T = Record<string, unknown>>(sql: string, params: any[] = []): T | undefined {
  const database = getDb()
  const stmt = database.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const row = stmt.step() ? stmt.getAsObject() as unknown as T : undefined
  stmt.free()
  return row
}

/**
 * 执行非查询语句（INSERT/UPDATE/DELETE）
 */
function execute(sql: string, params: any[] = []): void {
  const database = getDb()
  database.run(sql, params)
  markDirty()
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
  const database = getDb()
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
    database.run('BEGIN')
    
    try {
      // 删除超出范围的数据
      if (limitedData.length > 0) {
        const firstTs = limitedData[0]!.timestamp
        const lastTs = limitedData[limitedData.length - 1]!.timestamp
        
        database.run(
          `DELETE FROM kline_data 
           WHERE symbol = ? AND timeframe = ? 
           AND (timestamp < ? OR timestamp > ?)`,
          [normSymbol, timeframe, firstTs, lastTs]
        )
      } else {
        database.run(
          `DELETE FROM kline_data WHERE symbol = ? AND timeframe = ?`,
          [normSymbol, timeframe]
        )
      }
      
      // 插入所有数据
      const insertStmt = database.prepare(
        `INSERT OR REPLACE INTO kline_data (symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      
      for (const item of limitedData) {
        insertStmt.bind([normSymbol, timeframe, item.timestamp, item.open, item.high, item.low, item.close, item.volume])
        insertStmt.step()
        insertStmt.reset()
      }
      insertStmt.free()
      
      database.run('COMMIT')
      markDirty()
      return true
    } catch (innerError) {
      database.run('ROLLBACK')
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
  const database = getDb()
  const normSymbol = normalizeSymbol(symbol)
  
  try {
    database.run('BEGIN')
    
    try {
      // 排序新数据
      const sortedNewData = [...newData].sort((a, b) => a.timestamp - b.timestamp)
      
      // 插入新数据（INSERT OR REPLACE 自动去重）
      const insertStmt = database.prepare(
        `INSERT OR REPLACE INTO kline_data (symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      
      for (const item of sortedNewData) {
        insertStmt.bind([normSymbol, timeframe, item.timestamp, item.open, item.high, item.low, item.close, item.volume])
        insertStmt.step()
        insertStmt.reset()
      }
      insertStmt.free()
      
      // 删除超出 MAX_BARS 的旧数据
      database.run(
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
      
      database.run('COMMIT')
      markDirty()
      return true
    } catch (innerError) {
      database.run('ROLLBACK')
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
  const database = getDb()
  const normSymbol = normalizeSymbol(symbol)
  
  try {
    // sql.js 的 run 不返回 changes 信息，我们用 COUNT 来确认
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
  const database = getDb()
  
  try {
    const before = queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM kline_data`
    )
    
    database.run('DELETE FROM kline_data')
    markDirty()
    
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
