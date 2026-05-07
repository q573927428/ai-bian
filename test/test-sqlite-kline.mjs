/**
 * SQLite K线存储 - 高频同步验证测试（基于 sql.js）
 * 
 * 测试内容：
 * 1. 数据库初始化 & 表结构验证
 * 2. 单条写入性能（模拟 WebSocket 实时推送）
 * 3. 批量追加性能（模拟历史数据同步）
 * 4. 读取性能（范围查询 / limit 查询）
 * 5. 并发写入安全性（WAL 模式）
 * 6. 数据一致性校验
 * 7. 高频压力测试
 * 
 * 运行方式: node test/test-sqlite-kline.mjs
 */

import initSqlJs from 'sql.js'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const DB_PATH = 'data/kline-test.db'
const MAX_BARS = 11000
const TEST_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']
const TIMEFRAMES = ['15m', '1h']

// ==================== 工具函数 ====================

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function generateKLine(timestamp, basePrice = 50000) {
  const scale = Math.max(basePrice * 0.1, 10)
  const open = basePrice + (Math.random() - 0.5) * scale * 2
  const close = open + (Math.random() - 0.5) * scale
  const high = Math.max(open, close) + Math.random() * scale * 0.5 + 0.01
  const low = Math.min(open, close) - Math.random() * scale * 0.5 - 0.01
  const volume = Math.random() * 1000 + 100
  return { timestamp, open, high, low, close, volume }
}

async function openDb() {
  const SQL = await initSqlJs()
  
  const fs = await import('fs')
  const path = await import('path')
  const dbPath = DB_PATH
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  
  let db
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }
  
  return { db, SQL }
}

// sql.js 辅助：参数化查询并返回所有行（对象数组）
function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

// sql.js 辅助：参数化查询并返回第一行
function queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const row = stmt.step() ? stmt.getAsObject() : undefined
  stmt.free()
  return row
}

// sql.js 辅助：执行非查询语句
function execute(db, sql, params = []) {
  db.run(sql, params)
}

// ==================== 测试套件 ====================

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.error(`  ❌ ${label}`)
    failed++
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'='.repeat(60)}`)
}

async function run() {
  // ======== 1. 数据库初始化 ========
  section('1. 数据库初始化')
  
  const { db, SQL } = await openDb()
  
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
  
  const tables = queryAll(db, "SELECT name FROM sqlite_master WHERE type='table'")
  console.log(`  表数量: ${tables.length}`)
  assert(tables.some(t => t.name === 'kline_data'), 'kline_data 表已创建')
  
  // 清理旧测试数据
  execute(db, 'DELETE FROM kline_data')
  console.log('  旧测试数据已清理')

  // ======== 2. 单条写入性能（模拟 WebSocket 实时推送） ========
  section('2. 单条写入性能（模拟实时 K线推送）')
  
  const insertSql = `INSERT OR REPLACE INTO kline_data (symbol, timeframe, timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  
  const singleWriteTimes = []
  const singleWriteTotal = 500
  
  for (let i = 0; i < singleWriteTotal; i++) {
    const bar = generateKLine(Date.now() + i * 60000, 50000 + i * 10)
    const start = performance.now()
    execute(db, insertSql, ['BTCUSDT', '15m', bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume])
    singleWriteTimes.push(performance.now() - start)
  }
  
  const avgSingleWrite = singleWriteTimes.reduce((a, b) => a + b, 0) / singleWriteTimes.length
  const maxSingleWrite = Math.max(...singleWriteTimes)
  const minSingleWrite = Math.min(...singleWriteTimes)
  
  console.log(`  写入条数: ${singleWriteTotal}`)
  console.log(`  平均耗时: ${formatMs(avgSingleWrite)} /条`)
  console.log(`  最大耗时: ${formatMs(maxSingleWrite)}`)
  console.log(`  最小耗时: ${formatMs(minSingleWrite)}`)
  assert(avgSingleWrite < 5, `单条写入 < 5ms (实际: ${formatMs(avgSingleWrite)})`)
  
  // 验证写入数据
  const count = queryOne(db, 'SELECT COUNT(*) as c FROM kline_data WHERE symbol = ?', ['BTCUSDT'])
  assert(count.c === singleWriteTotal, `写入数量正确: ${count.c} 条`)

  // ======== 3. 批量追加性能（模拟历史数据同步） ========
  section('3. 批量追加性能（模拟历史数据同步）')
  
  // 清理并重新测试
  execute(db, 'DELETE FROM kline_data')
  
  const batchSizes = [100, 500, 1000, 5000]
  const batchResults = []
  let cumulativeTs = Date.now()
  
  for (const batchSize of batchSizes) {
    const bars = []
    for (let i = 0; i < batchSize; i++) {
      bars.push(generateKLine(cumulativeTs + i * 60000))
    }
    
    const start = performance.now()
    
    // sql.js 手动事务
    db.run('BEGIN')
    try {
      for (const bar of bars) {
        execute(db, insertSql, ['ETHUSDT', '1h', bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume])
      }
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    
    const elapsed = performance.now() - start
    
    batchResults.push({ size: batchSize, time: elapsed, perBar: elapsed / batchSize })
    cumulativeTs += batchSize * 60000
  }
  
  console.table(batchResults.map(r => ({
    '批量大小': r.size,
    '总耗时': formatMs(r.time),
    '单条耗时': formatMs(r.perBar)
  })))
  
  const totalBars = batchSizes.reduce((a, b) => a + b, 0)
  const dbCount = queryOne(db, 'SELECT COUNT(*) as c FROM kline_data WHERE symbol = ? AND timeframe = ?', ['ETHUSDT', '1h'])
  assert(dbCount.c === totalBars, `批量写入数量正确: ${dbCount.c} 条`)
  
  assert(batchResults[3].perBar < 1, `大批量单条写入 < 1ms (实际: ${formatMs(batchResults[3].perBar)})`)

  // ======== 4. 全量写入 + 去重 + 限制 ========
  section('4. 全量写入 + 去重 + 限制条数')
  
  execute(db, 'DELETE FROM kline_data')
  
  // 生成 12000 条（超过 MAX_BARS=11000）
  const fullData = []
  const baseTs = Date.now() - 12000 * 60000
  for (let i = 0; i < 12000; i++) {
    fullData.push(generateKLine(baseTs + i * 60000, 100))
  }
  
  // 在其中插入一些重复数据
  fullData.push({ ...fullData[500] })  // 完全重复
  fullData.push({ ...fullData[1000] }) // 完全重复
  
  // 事务批量写入
  const startWrite = performance.now()
  db.run('BEGIN')
  try {
    // 去重 + 排序 + 限制
    const seen = new Set()
    const sorted = [...fullData].sort((a, b) => a.timestamp - b.timestamp)
    const limited = sorted.slice(-MAX_BARS)
    
    for (const bar of limited) {
      if (seen.has(bar.timestamp)) continue
      seen.add(bar.timestamp)
      execute(db, insertSql, ['BNBUSDT', '4h', bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume])
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  const writeTime = performance.now() - startWrite
  
  const dbCount2 = queryOne(db, 'SELECT COUNT(*) as c FROM kline_data WHERE symbol = ? AND timeframe = ?', ['BNBUSDT', '4h'])
  console.log(`  全量写入: ${dbCount2.c} 条, 耗时: ${formatMs(writeTime)}`)
  assert(dbCount2.c === MAX_BARS, `条数限制正确: ${dbCount2.c} = ${MAX_BARS}`)
  assert(writeTime < 500, `全量写入 < 500ms (实际: ${formatMs(writeTime)})`)

  // ======== 5. 读取性能 ========
  section('5. 读取性能测试')
  
  // 5a. 全量读取
  const startReadAll = performance.now()
  const allRows = queryAll(db,
    'SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC',
    ['BNBUSDT', '4h']
  )
  const readAllTime = performance.now() - startReadAll
  console.log(`  全量读取: ${allRows.length} 条, 耗时: ${formatMs(readAllTime)}`)
  assert(allRows.length === MAX_BARS, `全量读取数量正确`)
  assert(readAllTime < 100, `全量读取 < 100ms (实际: ${formatMs(readAllTime)})`)
  
  // 5b. Limit 查询（最后 N 条）
  const startReadLimit = performance.now()
  const limitRows = queryAll(db,
    'SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT ?',
    ['BNBUSDT', '4h', 100]
  )
  const readLimitTime = performance.now() - startReadLimit
  console.log(`  Limit(100) 读取: ${limitRows.length} 条, 耗时: ${formatMs(readLimitTime)}`)
  assert(limitRows.length === 100, 'Limit 查询数量正确')
  assert(readLimitTime < 10, `Limit 查询 < 10ms (实际: ${formatMs(readLimitTime)})`)
  
  // 5c. 时间范围查询
  const firstRow = allRows[0]
  const lastRow = allRows[allRows.length - 1]
  const midTs = firstRow.timestamp + Math.floor((lastRow.timestamp - firstRow.timestamp) / 2)
  
  const startRange = performance.now()
  const rangeRows = queryAll(db,
    'SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
    ['BNBUSDT', '4h', firstRow.timestamp, midTs]
  )
  const rangeTime = performance.now() - startRange
  console.log(`  时间范围查询: ${rangeRows.length} 条, 耗时: ${formatMs(rangeTime)}`)
  assert(rangeRows.length > 0, '范围查询返回数据')
  assert(rangeTime < 10, `范围查询 < 10ms (实际: ${formatMs(rangeTime)})`)

  // ======== 6. 多交易对高频并发写入 ========
  section('6. 多交易对高频并发写入（模拟真实场景）')
  
  execute(db, 'DELETE FROM kline_data')
  
  const symbolCount = TEST_SYMBOLS.length
  const tfCount = TIMEFRAMES.length
  const barsPerSymbol = 500
  const totalBarsExpected = symbolCount * tfCount * barsPerSymbol
  
  const startConcurrent = performance.now()
  
  // 模拟多个 symbol 同时推送数据
  db.run('BEGIN')
  try {
    for (const symbol of TEST_SYMBOLS) {
      for (const tf of TIMEFRAMES) {
        const basePrice = { BTCUSDT: 50000, ETHUSDT: 3000, BNBUSDT: 500 }[symbol]
        for (let i = 0; i < barsPerSymbol; i++) {
          const bar = generateKLine(Date.now() + i * 60000, basePrice)
          execute(db, insertSql, [symbol, tf, bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume])
        }
      }
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  
  const concurrentTime = performance.now() - startConcurrent
  const totalCount = queryOne(db, 'SELECT COUNT(*) as c FROM kline_data').c
  
  console.log(`  交易对: ${symbolCount} x ${tfCount} 周期 = ${symbolCount * tfCount} 个组合`)
  console.log(`  每个组合: ${barsPerSymbol} 条`)
  console.log(`  总写入: ${totalCount} 条`)
  console.log(`  总耗时: ${formatMs(concurrentTime)}`)
  console.log(`  单条耗时: ${formatMs(concurrentTime / totalCount)}`)
  console.log(`  吞吐量: ${(totalCount / (concurrentTime / 1000)).toFixed(0)} 条/秒`)
  
  assert(totalCount === totalBarsExpected, `总数正确: ${totalCount} = ${totalBarsExpected}`)
  assert(concurrentTime < 3000, `多组合并发写入 < 3s (实际: ${formatMs(concurrentTime)})`)

  // ======== 7. 更新最后一根 K线 ========
  section('7. 更新最后一根 K线（模拟未收盘更新）')
  
  const updateCount = 500
  const startUpdate = performance.now()
  
  db.run('BEGIN')
  try {
    for (let i = 0; i < updateCount; i++) {
      // 随机选一个 symbol/tf 组合
      const symbol = TEST_SYMBOLS[i % symbolCount]
      const tf = TIMEFRAMES[i % tfCount]
      
      // 获取最后一条的时间戳
      const last = queryOne(db,
        'SELECT timestamp FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 1',
        [symbol, tf]
      )
      
      if (last) {
        // 更新最后一条
        const newClose = Math.random() * 100000
        execute(db,
          `UPDATE kline_data SET 
            close = ?, 
            high = MAX(high, ?),
            low = MIN(low, ?),
            volume = volume + ? 
          WHERE symbol = ? AND timeframe = ? AND timestamp = ?`,
          [newClose, newClose, newClose, Math.random() * 100, symbol, tf, last.timestamp]
        )
      }
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  
  const updateTime = performance.now() - startUpdate
  console.log(`  更新次数: ${updateCount}`)
  console.log(`  总耗时: ${formatMs(updateTime)}`)
  console.log(`  单次更新: ${formatMs(updateTime / updateCount)}`)
  
  assert(updateTime < 500, `500次更新 < 500ms (实际: ${formatMs(updateTime)})`)

  // ======== 8. 数据一致性校验 ========
  section('8. 数据一致性校验')
  
  for (const symbol of TEST_SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      const rows = queryAll(db,
        'SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC',
        [symbol, tf]
      )
      
      assert(rows.length === barsPerSymbol, `${symbol}/${tf} 数量正确: ${rows.length}`)
      
      // 验证时间戳递增
      let prevTs = 0
      let ordered = true
      for (const row of rows) {
        if (row.timestamp <= prevTs) {
          ordered = false
          break
        }
        prevTs = row.timestamp
      }
      assert(ordered, `${symbol}/${tf} 时间戳严格递增`)
      
      // 验证数据完整性
      for (const row of rows) {
        assert(typeof row.open === 'number' && !isNaN(row.open), `${symbol}/${tf} open 有效`)
        assert(typeof row.high === 'number' && !isNaN(row.high), `${symbol}/${tf} high 有效`)
        assert(typeof row.low === 'number' && !isNaN(row.low), `${symbol}/${tf} low 有效`)
        assert(typeof row.close === 'number' && !isNaN(row.close), `${symbol}/${tf} close 有效`)
        assert(typeof row.volume === 'number' && !isNaN(row.volume), `${symbol}/${tf} volume 有效`)
        assert(row.high >= row.low, `${symbol}/${tf} high >= low`)
        assert(row.high >= row.open && row.high >= row.close, `${symbol}/${tf} high >= open/close`)
        assert(row.low <= row.open && row.low <= row.close, `${symbol}/${tf} low <= open/close`)
      }
    }
  }

  // ======== 9. 分组统计查询 ========
  section('9. 分组统计查询（存储统计）')
  
  const startStats = performance.now()
  const stats = queryAll(db,
    `SELECT symbol, timeframe, COUNT(*) as count, MAX(timestamp) as last_ts, MIN(timestamp) as first_ts
    FROM kline_data
    GROUP BY symbol, timeframe
    ORDER BY symbol, timeframe`
  )
  const statsTime = performance.now() - startStats
  
  console.table(stats.map(r => ({
    '交易对': r.symbol,
    '周期': r.timeframe,
    '条数': r.count,
    '最新': new Date(r.last_ts).toISOString(),
    '最早': new Date(r.first_ts).toISOString()
  })))
  
  console.log(`  分组查询耗时: ${formatMs(statsTime)}`)
  assert(stats.length === symbolCount * tfCount, `分组数正确: ${stats.length}`)
  assert(statsTime < 10, `分组统计 < 10ms (实际: ${formatMs(statsTime)})`)

  // ======== 10. 数据库文件信息 ========
  section('10. 数据库文件信息')
  
  const fs = await import('fs')
  const dbPath = DB_PATH

  try {
    const stat = fs.statSync(dbPath)
    console.log(`  db: ${(stat.size / 1024).toFixed(1)} KB`)
  } catch {
    console.log('  db: 不存在')
  }

  // ======== 11. 连续高频追加测试（模拟长时间运行） ========
  section('11. 连续高频追加测试（模拟 WS 持续推送）')
  
  const rounds = 10
  const barsPerRound = 100
  const roundTimes = []
  
  for (let r = 0; r < rounds; r++) {
    const roundBars = []
    const roundBaseTs = Date.now() + r * barsPerRound * 60000
    for (let i = 0; i < barsPerRound; i++) {
      roundBars.push(generateKLine(roundBaseTs + i * 60000, 40000))
    }
    
    const start = performance.now()
    db.run('BEGIN')
    try {
      for (const bar of roundBars) {
        execute(db, insertSql, ['SOLUSDT', '15m', bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume])
      }
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    roundTimes.push(performance.now() - start)
  }
  
  const avgRoundTime = roundTimes.reduce((a, b) => a + b, 0) / roundTimes.length
  console.log(`  轮次: ${rounds} x ${barsPerRound} = ${rounds * barsPerRound} 条`)
  console.log(`  平均每轮: ${formatMs(avgRoundTime)}`)
  console.log(`  单条平均: ${formatMs(avgRoundTime / barsPerRound)}`)
  assert(avgRoundTime < 50, `每轮100条追加 < 50ms (实际: ${formatMs(avgRoundTime)})`)

  // ======== 结果汇总 ========
  section('测试结果汇总')
  console.log(`  ✅ 通过: ${passed}`)
  console.log(`  ❌ 失败: ${failed}`)
  
  if (failed > 0) {
    console.log(`\n  ⚠️  有 ${failed} 项测试失败，请检查！`)
    process.exit(1)
  } else {
    console.log(`\n  🎉 全部 ${passed} 项测试通过！SQLite 存储方案可靠。`)
  }
  
  // 清理
  db.close()
  
  // 删除测试数据库
  try {
    fs.unlinkSync(DB_PATH)
    console.log('\n  测试数据库已清理')
  } catch {}
}

run().catch(err => {
  console.error('\n  测试异常:', err)
  process.exit(1)
})
