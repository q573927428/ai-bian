// ==================== OI 变化口径迁移脚本 ====================
// 用途：将已有 SQLite K 线中的 OI 派生字段迁移为“当前 OI 对比上一根有效 OI”。
// 默认只预览变更数量；添加 --write 后写入数据库并在写入前创建备份。

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DB_PATH = path.resolve(process.env.KLINE_DATA_DIR || 'data', 'kline.db')
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d', '1w']
const THRESHOLDS = {
  '5m': [3, 0.4], '15m': [4, 0.5], '1h': [5, 0.6],
  '4h': [7, 0.8], '1d': [10, 1.2], '1w': [12, 1.2]
}

function arg(name) {
  const equal = process.argv.find(value => value.startsWith(`${name}=`))
  if (equal) return equal.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** 按当前在线分类器的口径，重算资金流 EMA、OI 变化和联合状态。 */
function classify(rows, timeframe) {
  const [flowThreshold, oiThreshold] = THRESHOLDS[timeframe]
  const ratios = []
  let ema
  return rows.map((row, index) => {
    const ratio = Number.isFinite(row.active_delta_ratio) ? row.active_delta_ratio * 100 : undefined
    if (ratio !== undefined) {
      ratios.push(ratio)
      if (ratios.length === 12) ema = ratios.reduce((sum, value) => sum + value, 0) / 12
      else if (ratios.length > 12 && ema !== undefined) ema = ratio * (2 / 13) + ema * (11 / 13)
    }

    // 缺失 OI 不参与比较；向前查找最近一个有效快照，避免历史缺口把变化伪装成 0。
    let previousOI
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const value = rows[previousIndex]?.oi_value
      if (Number.isFinite(value) && value > 0) {
        previousOI = value
        break
      }
    }
    const oiChange = previousOI !== undefined && Number.isFinite(row.oi_value) && row.oi_value > 0 ? row.oi_value - previousOI : undefined
    const oiChangePercent = oiChange !== undefined && previousOI > 0 ? oiChange / previousOI * 100 : undefined
    const flowDeviation = ratio !== undefined && ema !== undefined ? ratio - ema : undefined
    const flowDirection = flowDeviation === undefined || ratios.length < 12 ? 'unavailable' : flowDeviation >= flowThreshold ? 'positive' : flowDeviation <= -flowThreshold ? 'negative' : 'neutral'
    const oiDirection = oiChangePercent === undefined ? 'unavailable' : oiChangePercent >= oiThreshold ? 'positive' : oiChangePercent <= -oiThreshold ? 'negative' : 'neutral'
    let state = 'neutral'
    if (flowDirection === 'unavailable' || oiDirection === 'unavailable') state = 'unavailable'
    else if (flowDirection === 'positive' && oiDirection === 'positive') state = 'long-build'
    else if (flowDirection === 'negative' && oiDirection === 'positive') state = 'short-build'
    else if (flowDirection === 'positive' && oiDirection === 'negative') state = 'short-cover'
    else if (flowDirection === 'negative' && oiDirection === 'negative') state = 'long-liquidation'
    return { ...row, oi_change: oiChange ?? null, oi_change_percent: oiChangePercent ?? null, state }
  })
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`K线数据库不存在: ${DB_PATH}`)
  const symbolFilter = arg('--symbol')?.replace('/', '')
  const timeframeFilter = arg('--timeframe')
  if (timeframeFilter && !TIMEFRAMES.includes(timeframeFilter)) throw new Error(`不支持的周期: ${timeframeFilter}`)
  const write = process.argv.includes('--write')
  const db = new DatabaseSync(DB_PATH)
  // 应用可能同时持有读连接；给 SQLite 留出短暂等待时间，避免迁移因瞬时锁竞争中断。
  db.exec('PRAGMA busy_timeout = 10000')
  const groups = db.prepare('SELECT DISTINCT symbol, timeframe FROM kline_data ORDER BY symbol, timeframe').all()
    .filter(group => (!symbolFilter || group.symbol === symbolFilter) && (!timeframeFilter || group.timeframe === timeframeFilter))

  if (write) fs.copyFileSync(DB_PATH, `${DB_PATH}.backup-oi-previous-${Date.now()}`)
  let updated = 0
  for (const group of groups) {
    const rows = db.prepare('SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC').all(group.symbol, group.timeframe)
    const classified = classify(rows, group.timeframe)
    if (write) {
      db.exec('BEGIN')
      try {
        const statement = db.prepare('UPDATE kline_data SET oi_change = ?, oi_change_percent = ?, state = ? WHERE symbol = ? AND timeframe = ? AND timestamp = ?')
        for (const row of classified) statement.run(row.oi_change, row.oi_change_percent, row.state, group.symbol, group.timeframe, row.timestamp)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    updated += classified.length
    console.log(`${write ? '[WRITE]' : '[PREVIEW]'} ${group.symbol}/${group.timeframe}: ${classified.length} 根`)
  }
  console.log(`${write ? '已迁移' : '可迁移'} ${updated} 根K线。${write ? '数据库已生成备份。' : '添加 --write 执行写入。'}`)
  db.close()
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
