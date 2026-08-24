// ==================== K线资金流与 OI 历史字段回补脚本 ====================
// 用法：
//   node scripts/backfill-oi-for-kline-window.mjs                 # 预览
//   node scripts/backfill-oi-for-kline-window.mjs --write         # 写入（自动备份数据库）
//   node scripts/backfill-oi-for-kline-window.mjs --write --symbol BTCUSDT --timeframe 4h

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DB_PATH = path.resolve(process.env.KLINE_DATA_DIR || 'data', 'kline.db')
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d', '1w']
const THRESHOLDS = {
  '5m': [3, 0.4], '15m': [4, 0.5], '1h': [5, 0.6], '4h': [7, 0.8], '1d': [10, 1.2], '1w': [12, 1.2]
}
const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 }
const OI_REQUEST_DELAY_MS = 100 // 低于 Binance 1000 次/5 分钟的平均速率

function arg(name) {
  const equal = process.argv.find(value => value.startsWith(`${name}=`))
  if (equal) return equal.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'kline-oi-backfill/1.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.json()
}

function normalizeSymbol(symbol) { return symbol.replace('/', '') }

function ensureColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(kline_data)').all().map(row => row.name))
  const additions = [
    ['quote_volume', 'REAL'], ['taker_buy_quote_volume', 'REAL'], ['active_buy_amount', 'REAL'],
    ['active_sell_amount', 'REAL'], ['active_delta', 'REAL'], ['active_delta_ratio', 'REAL'],
    ['oi_value', 'REAL'], ['oi_change', 'REAL'], ['oi_change_percent', 'REAL'], ['oi_provisional', 'INTEGER'], ['state', 'TEXT']
  ]
  for (const [name, type] of additions) if (!columns.has(name)) db.exec(`ALTER TABLE kline_data ADD COLUMN ${name} ${type}`)
}

async function fetchKlineFields(symbol, timeframe, first, last) {
  const result = new Map()
  const interval = INTERVAL_MS[timeframe]
  let cursor = first
  while (cursor <= last) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${normalizeSymbol(symbol)}&interval=${timeframe}&startTime=${cursor}&endTime=${last + interval - 1}&limit=1000`
    const rows = await fetchJson(url)
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const item of rows) {
      const timestamp = Math.floor(Number(item[0]) / 1000)
      const quoteVolume = Number(item[7])
      const takerBuyQuoteVolume = Number(item[10])
      const activeSellAmount = quoteVolume - takerBuyQuoteVolume
      if (Number.isFinite(timestamp) && Number.isFinite(quoteVolume) && Number.isFinite(takerBuyQuoteVolume)) {
        result.set(timestamp, {
          quote_volume: quoteVolume,
          taker_buy_quote_volume: takerBuyQuoteVolume,
          active_buy_amount: takerBuyQuoteVolume,
          active_sell_amount: Math.max(0, activeSellAmount),
          active_delta: takerBuyQuoteVolume - Math.max(0, activeSellAmount),
          active_delta_ratio: quoteVolume > 0 ? (takerBuyQuoteVolume - Math.max(0, activeSellAmount)) / quoteVolume : null
        })
      }
    }
    const newest = Number(rows.at(-1)?.[0])
    if (!Number.isFinite(newest) || rows.length < 1000) break
    cursor = newest + interval
    await sleep(100)
  }
  return result
}

async function fetchOI(symbol, timeframe, first, last) {
  if (timeframe === '1w') return new Map()
  const result = new Map()
  // Binance openInterestHist 只支持最近 1 个月，历史 K 线更早部分保持 OI NULL。
  const availableFrom = Date.now() - 30 * 24 * 60 * 60 * 1000
  const rangeStart = Math.max(first, availableFrom)
  let cursorEnd = Math.min(last + INTERVAL_MS[timeframe] - 1, Date.now())
  let pageCount = 0
  if (rangeStart >= cursorEnd) return result

  // OI 接口每页最多 500 条；从最新时间向前翻页，保证有限的返回窗口优先覆盖最新 K 线。
  while (cursorEnd >= rangeStart) {
    const pageStart = Math.max(rangeStart, cursorEnd - INTERVAL_MS[timeframe] * 499)
    const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${normalizeSymbol(symbol)}&period=${timeframe}&startTime=${pageStart}&endTime=${cursorEnd}&limit=500`
    const rows = await fetchJson(url)
    if (!Array.isArray(rows) || rows.length === 0) break
    pageCount += 1
    for (const item of rows) {
      const timestamp = Number(item.timestamp)
      const value = Number(item.sumOpenInterest ?? item.openInterest ?? item.contracts)
      if (Number.isFinite(timestamp) && Number.isFinite(value) && value > 0) {
        const bucketSeconds = INTERVAL_MS[timeframe] / 1000
        result.set(Math.floor(timestamp / 1000 / bucketSeconds) * bucketSeconds, value)
      }
    }
    const oldest = Number(rows[0]?.timestamp)
    if (!Number.isFinite(oldest) || rows.length < 500 || oldest <= rangeStart) break
    cursorEnd = oldest - 1
    await sleep(OI_REQUEST_DELAY_MS)
  }
  if (pageCount > 1) {
    console.log(`[OI-PAGE] ${symbol}/${timeframe}: 共 ${pageCount} 页，OI ${result.size} 根，按最新时间向前回补`)
  }
  return result
}

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
    // 与在线分类器保持一致：使用上一根有效 OI 快照作为变化基准。
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
    return { ...row, oi_change: oiChange ?? null, oi_change_percent: oiChangePercent ?? null, oi_provisional: row.oi_value == null ? null : 0, state }
  })
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`K线数据库不存在: ${DB_PATH}`)
  const db = new DatabaseSync(DB_PATH)
  ensureColumns(db)
  const symbolFilter = arg('--symbol')
  const timeframeFilter = arg('--timeframe')
  if (timeframeFilter && !TIMEFRAMES.includes(timeframeFilter)) throw new Error(`不支持的周期: ${timeframeFilter}`)
  const groups = db.prepare(`SELECT symbol, timeframe, MIN(timestamp) first_ts, MAX(timestamp) last_ts FROM kline_data GROUP BY symbol, timeframe ORDER BY symbol, timeframe`).all()
    .filter(group => (!symbolFilter || group.symbol === normalizeSymbol(symbolFilter)) && (!timeframeFilter || group.timeframe === timeframeFilter))
  const write = process.argv.includes('--write')
  if (write) fs.copyFileSync(DB_PATH, `${DB_PATH}.backup-flow-oi-${Date.now()}`)
  let updated = 0
  for (const group of groups) {
    const timeframe = group.timeframe
    const rows = db.prepare('SELECT * FROM kline_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC').all(group.symbol, timeframe)
    try {
      const klineFields = await fetchKlineFields(group.symbol, timeframe, group.first_ts * 1000, group.last_ts * 1000)
      let oiFields = new Map()
      try {
        oiFields = await fetchOI(group.symbol, timeframe, group.first_ts * 1000, group.last_ts * 1000)
      } catch (error) {
        // OI 接口失败不能阻塞资金流字段回补；该周期 OI 保留已有值或 NULL。
        console.warn(`[OI-SKIP] ${group.symbol}/${timeframe}: ${error.message}`)
      }
      const merged = rows.map(row => ({ ...row, ...(klineFields.get(row.timestamp) || {}), oi_value: oiFields.get(row.timestamp) ?? row.oi_value }))
      const classified = classify(merged, timeframe)
      if (write) {
        db.exec('BEGIN')
        try {
          const statement = db.prepare(`UPDATE kline_data SET quote_volume = ?, taker_buy_quote_volume = ?, active_buy_amount = ?, active_sell_amount = ?, active_delta = ?, active_delta_ratio = ?, oi_value = ?, oi_change = ?, oi_change_percent = ?, oi_provisional = ?, state = ? WHERE symbol = ? AND timeframe = ? AND timestamp = ?`)
          for (const row of classified) statement.run(row.quote_volume ?? null, row.taker_buy_quote_volume ?? null, row.active_buy_amount ?? null, row.active_sell_amount ?? null, row.active_delta ?? null, row.active_delta_ratio ?? null, row.oi_value ?? null, row.oi_change ?? null, row.oi_change_percent ?? null, row.oi_provisional ?? null, row.state ?? null, group.symbol, timeframe, row.timestamp)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      updated += classified.length
      console.log(`${write ? '[WRITE]' : '[PREVIEW]'} ${group.symbol}/${timeframe}: ${classified.length} 根，资金流 ${klineFields.size} 根，OI ${oiFields.size} 根${timeframe === '1w' ? '（跳过1w OI）' : ''}`)
    } catch (error) {
      console.error(`[FAILED] ${group.symbol}/${timeframe}: ${error.message}`)
    }
    await sleep(100)
  }
  console.log(`${write ? '已写入' : '可回补'} ${updated} 根K线。${write ? '数据库已生成备份。' : '添加 --write 执行写入。'}`)
  db.close()
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
