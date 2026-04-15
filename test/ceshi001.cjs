require('dotenv').config()
const ccxt = require('ccxt')

async function main() {
  const exchange = new ccxt.binanceusdm({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'future',
    },
  })

  const symbol = 'BTC/USDT'

  const openOrders = await exchange.fetchOpenOrders(
    symbol,
    undefined,
    undefined,
    { trigger: true } //查询取消条件委托单 需要加上{ trigger: true }
  )

  console.log('当前未成交订单数量:', openOrders.length)

  for (const o of openOrders) {
    console.log({
      id: o.id,
      type: o.type,
      side: o.side,
      price: o.price,
      stopPrice: o.stopPrice,
      status: o.status,
    })
  }
  const symbolUSDT = 'BTC/USDT'
  const stopLossOrderId = '898743527688'
  const stopOrder = await exchange.fetchOrder(stopLossOrderId, symbolUSDT , { trigger: true }) //查询取消条件委托单 需要加上{ trigger: true }
  console.log(stopOrder);
  
}

main().catch(err => {
  console.error('执行失败:', err.message)
})
