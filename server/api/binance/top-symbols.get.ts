import { binanceApiGateway } from '../../utils/binance-api-gateway'
import { getBotConfig } from '../../utils/storage'

interface TopSymbol {
  symbol: string
  volume: number          // 成交额 (USDT)
  price: number           // 当前价格
  priceChangePercent: number // 24小时涨跌幅 (%)
  openInterest: number    // 持仓量 (张数)
  openInterestValue: number // 持仓额 (USDT)
  fundingRate: number     // 资金费率 (%)
  klineCount4h: number    // 4H K线可用根数
  onboardDate: number     // 上线时间戳 (ms)
}

/** 4H K线的毫秒数 */
const KLINE_4H_MS = 4 * 60 * 60 * 1000
/** 返回的热门交易对数量上限 */
const TOP_SYMBOLS_LIMIT = 20

export default defineEventHandler(async () => {
  // 0. 从 bot-config.json 读取 requiredCandles 作为最少需要的4H K线根数
  const botConfig = await getBotConfig()
  const minKlineCount = botConfig.indicatorsConfig?.requiredCandles || 500

  // 1. 获取所有合约的 exchangeInfo（含上线时间）
  let onboardMap = new Map<string, number>()
  try {
    const exchangeInfo: any = await binanceApiGateway.fetchJson<any>(
      'marketData',
      'exchangeInfo',
      'https://fapi.binance.com/fapi/v1/exchangeInfo'
    )
    const now = Date.now()
    for (const s of (exchangeInfo.symbols || [])) {
      if (s.contractType === 'PERPETUAL' && s.symbol.endsWith('USDT') && !s.symbol.endsWith('USDCUSDT')) {
        const onboardDate = s.onboardDate ? Number(s.onboardDate) : 0
        onboardMap.set(s.symbol, onboardDate)
      }
    }
  } catch {
    // 忽略 exchangeInfo 获取错误，后续不进行上线时间过滤
  }

  // 2. 调用币安 24hr Ticker 获取所有合约数据（权重 40）
  const tickers = await binanceApiGateway.fetchJson<any[]>(
    'marketData',
    'ticker24hr:all',
    'https://fapi.binance.com/fapi/v1/ticker/24hr'
  )

  // 3. 筛选 USDT 永续合约，按成交额排序，取前 TOP_SYMBOLS_LIMIT 个
  const symbols = tickers
    .filter((t: any) => onboardMap.has(t.symbol)) // 只保留 exchangeInfo 中存在的永久合约
    .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
    .slice(0, TOP_SYMBOLS_LIMIT)
    .map((t: any) => {
      const onboardDate = onboardMap.get(t.symbol) || 0
      const klineCount4h = onboardDate > 0
        ? Math.floor((Date.now() - onboardDate) / KLINE_4H_MS)
        : 0
      return {
        symbol: t.symbol,
        volume: parseFloat(t.quoteVolume || '0'),
        price: parseFloat(t.lastPrice || '0'),
        priceChangePercent: parseFloat(t.priceChangePercent || '0'),
        openInterest: 0,
        openInterestValue: 0,
        fundingRate: 0,
        klineCount4h,
        onboardDate,
      }
    })
    // 先按成交额排序后再过滤上线时间不足的，确保展示尽可能多的热门币种
    .filter(item => item.klineCount4h >= minKlineCount || onboardMap.size === 0)

  // 3a. 全量获取 premiumIndex（权重 10），一次性获取所有资金费率
  let fundingMap = new Map<string, number>()
  try {
    const allPremium: any[] = await binanceApiGateway.fetchJson<any[]>(
      'marketData',
      'premiumIndex:all',
      'https://fapi.binance.com/fapi/v1/premiumIndex'
    )
    for (const item of allPremium) {
      fundingMap.set(item.symbol, parseFloat(item.lastFundingRate || '0') * 100)
    }
  } catch {
    // 忽略全量资金费率错误
  }

  // 3b. 并发获取持仓张数（权重 1 × N）
  const oiPromises = symbols.map(async (item) => {
    let openInterest = 0
    try {
      const oiRes = await binanceApiGateway.fetchJson<any>(
        'marketData',
        `openInterest:${item.symbol}`,
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${item.symbol}`
      )
      openInterest = parseFloat(oiRes.openInterest || '0')
    } catch {
      // 忽略单个交易对持仓量错误
    }
    return {
      symbol: item.symbol,
      openInterest,
      openInterestValue: openInterest * item.price,
    }
  })

  const oiResults = await Promise.all(oiPromises)
  const oiMap = new Map<string, { openInterest: number; openInterestValue: number }>(
    oiResults.map(r => [r.symbol, { openInterest: r.openInterest, openInterestValue: r.openInterestValue }])
  )

  // 4. 组装最终结果
  const result: TopSymbol[] = symbols.map(item => {
    const oi = oiMap.get(item.symbol)
    return {
      ...item,
      openInterest: oi?.openInterest || 0,
      openInterestValue: oi?.openInterestValue || 0,
      fundingRate: fundingMap.get(item.symbol) || 0,
    }
  })

  return { success: true, data: result }
})