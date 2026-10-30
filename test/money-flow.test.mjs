// ==================== 主动资金流计算与旧库迁移回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { calculateMoneyFlow, formatMoneyFlowPrompt, MONEY_FLOW_WINDOW_BARS } from '../server/utils/money-flow.ts'
import { initKLineDb, closeKLineDb, appendSimpleKLineData, updateLastKLine, getSimpleKLineAsOHLCV, hasMissingMoneyFlow, getKLineFileMTime, writeSimpleKLineFile, readSimpleKLineFile } from '../server/utils/kline-simple-storage.ts'

/** 构造连续窗口，末根位于当前分钟，覆盖未收盘口径。 */
function bars() {
  const start = Math.floor(Date.now() / 60_000) * 60_000 - 4 * 60_000
  return Array.from({ length: 5 }, (_, i) => ({ timestamp: start + i * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 65 }))
}

test('提示词保留周期、买卖方向、未收盘状态及缺失语义', () => {
  const flow = calculateMoneyFlow(bars(), 60_000)
  assert.equal(flow.windowBars, MONEY_FLOW_WINDOW_BARS)
  assert.match(formatMoneyFlowPrompt({ ...flow, windowBars: 10 }, '1m'), /近10根累计净流入/)
  const text = formatMoneyFlowPrompt(flow, '1m')
  assert.match(text, /主动资金流（1分钟，含未收盘K线）：\n本根净流入：\+30.00 USDT（\+30.00%）/)
  assert.match(text, /近5根累计净流入：\+150.00 USDT（\+30.00%）/)
  assert.match(text, /结合价格、成交量和OI判断趋势进一步分析/)
  const missing = formatMoneyFlowPrompt(calculateMoneyFlow([], 60_000), '15m')
  assert.match(missing, /本根净流入：暂无数据（暂无数据）/)
  assert.match(missing, /近5根累计净流入：暂无数据（暂无数据）/)
  assert.match(formatMoneyFlowPrompt({ ...flow, netInflow: -1200000, includesUnclosed: false }, '1h'), /1小时，仅含已收盘K线）：\n本根净流入：-120.00万 USDT/)
})

test('含当前未收盘，累计金额及加权比例正确，零额不产生比例', () => {
  const input = bars()
  input[4].quoteVolume = 1000
  input[4].takerBuyQuoteVolume = 400
  const result = calculateMoneyFlow(input, 60_000)
  assert.equal(result.netInflowPercent, -20)
  assert.equal(result.cumulativeNetInflow, -80)
  assert.equal(result.cumulativeNetInflowPercent, -80 / 1400 * 100)
  assert.equal(result.includesUnclosed, true)
  const zero = bars().map(bar => ({ ...bar, quoteVolume: 0, takerBuyQuoteVolume: 0 }))
  assert.equal(calculateMoneyFlow(zero, 60_000).cumulativeNetInflow, 0)
  assert.equal(calculateMoneyFlow(zero, 60_000).netInflowPercent, null)
  assert.equal(calculateMoneyFlow(zero, 60_000).cumulativeNetInflowPercent, null)
})

test('历史缺失、非法金额、窗口不足或断档不能伪装成零净流入', () => {
  for (const change of [bar => { delete bar.quoteVolume }, bar => { bar.takerBuyQuoteVolume = NaN }, bar => { bar.takerBuyQuoteVolume = 101 }, bar => { bar.timestamp += 1000 }]) {
    const input = bars()
    change(input[1])
    assert.equal(calculateMoneyFlow(input, 60_000).cumulativeNetInflow, null)
  }
  assert.equal(calculateMoneyFlow(bars().slice(1), 60_000).complete, false)
  assert.equal(calculateMoneyFlow([], 60_000).netInflowPercent, null)
})

test('旧库迁移保持缺失状态，追加、全量写入、末根更新均保留资金字段', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'money-flow-'))
  const previous = process.env.KLINE_DATA_DIR
  process.env.KLINE_DATA_DIR = directory
  try {
    const db = new DatabaseSync(path.join(directory, 'kline.db'))
    db.exec(`CREATE TABLE kline_data (symbol TEXT, timeframe TEXT, timestamp INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(symbol,timeframe,timestamp));
      INSERT INTO kline_data VALUES ('BTCUSDT','5m',1,1,1,1,1,1)`)
    db.close()
    await initKLineDb()
    assert.equal(hasMissingMoneyFlow('BTCUSDT', '5m'), true)
    assert.equal(getSimpleKLineAsOHLCV('BTCUSDT', '5m')[0].quoteVolume, undefined)
    const data = bars().map(bar => ({ ...bar, timestamp: bar.timestamp / 1000 }))
    assert.equal(writeSimpleKLineFile('BTCUSDT', '5m', data), true)
    assert.equal(hasMissingMoneyFlow('BTCUSDT', '5m'), false)
    assert.equal(readSimpleKLineFile('BTCUSDT', '5m').data.at(-1).bq, 65)
    const version = getKLineFileMTime('BTCUSDT', '5m')
    const latest = { ...data.at(-1), takerBuyQuoteVolume: 80 }
    assert.equal(updateLastKLine('BTCUSDT', '5m', latest), true)
    assert.equal(getSimpleKLineAsOHLCV('BTCUSDT', '5m').at(-1).takerBuyQuoteVolume, 80)
    assert.notEqual(getKLineFileMTime('BTCUSDT', '5m'), version)
    assert.equal(appendSimpleKLineData('BTCUSDT', '5m', [{ ...latest, timestamp: latest.timestamp + 300 }]), true)
    assert.equal(getSimpleKLineAsOHLCV('BTCUSDT', '5m', 1)[0].quoteVolume, 100)
  } finally {
    await closeKLineDb()
    if (previous === undefined) delete process.env.KLINE_DATA_DIR
    else process.env.KLINE_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
