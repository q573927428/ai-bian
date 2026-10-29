// ==================== 宏观自选市场元数据与来源隔离测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { localMacroMarket, macroStorageSymbol } from '../types/macro-market.ts'

test('默认宏观市场保留收益率单位和 Yahoo 交易日历身份', () => {
  const yieldMarket = localMacroMarket('YAHOO:^TNX')
  assert.equal(yieldMarket.id, 'tnx')
  assert.equal(yieldMarket.yield, true)
  assert.equal(yieldMarket.source, 'yahoo')
  assert.equal(macroStorageSymbol(yieldMarket), 'YAHOO:^TNX')
  assert.equal(localMacroMarket('BTCUSDT').id, 'btc')
})

test('自选合约生成独立身份，不接受任意路径、URL或未知 Yahoo 标的', () => {
  const market = localMacroMarket('1000PEPEUSDT')
  assert.equal(market.id, 'local:1000PEPEUSDT')
  assert.equal(macroStorageSymbol(market), '1000PEPEUSDT')
  assert.equal(market.tradingView, 'BINANCE:1000PEPEUSDT.P')
  for (const symbol of ['../BTCUSDT', 'https://example.com', 'YAHOO:UNKNOWN', '']) {
    assert.equal(localMacroMarket(symbol), undefined)
  }
})
