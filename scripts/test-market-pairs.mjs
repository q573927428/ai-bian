// 获取币安USDT永续合约交易对数量
async function getMarketPairs() {
  try {
    console.log('正在获取币安USDT永续合约列表...')

    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')
    const data = await response.json()

    const usdtPerpetuals = data.symbols.filter(
      (s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING'
    )

    console.log(`\n✅ 共获取到 ${usdtPerpetuals.length} 个USDT永续合约交易对\n`)

    console.log('前20个交易对:')
    usdtPerpetuals.slice(0, 20).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.symbol} (${s.baseAsset})`)
    })

    if (usdtPerpetuals.length > 20) {
      console.log(`  ... 还有 ${usdtPerpetuals.length - 20} 个交易对`)
    }

    // 统计一些信息
    const baseAssets = new Set(usdtPerpetuals.map((s) => s.baseAsset))
    console.log(`\n📊 统计信息:`)
    console.log(`  - 总交易对: ${usdtPerpetuals.length}`)
    console.log(`  - 不同币种: ${baseAssets.size}`)

    return usdtPerpetuals
  } catch (error) {
    console.error('❌ 获取失败:', error)
    throw error
  }
}

getMarketPairs()