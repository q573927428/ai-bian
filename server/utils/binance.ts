import * as ccxt from 'ccxt'
import type { OHLCV, Order, AccountInfo, Position, CryptoBalance, OrderExecutionSummary } from '../../types'
import { binanceApiGateway } from './binance-api-gateway'

/**
 * 脱敏错误文本中的签名和常见凭据，避免诊断日志泄露请求认证信息。
 */
function sanitizeBinanceErrorText(value: unknown): string {
  return String(value ?? '')
    .replace(/([?&](?:signature|apiKey|secret|token)=)[^&\s]+/gi, '$1***')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/**
 * 将底层网络错误链压缩为单行诊断信息。
 *
 * Node fetch 通常会在 cause 中提供 UND_ERR_CONNECT_TIMEOUT、ECONNRESET、
 * ENOTFOUND 等关键错误码；AggregateError 的子错误也需要一并记录。
 */
function formatBinanceErrorDetails(error: unknown): string {
  const queue: Array<{ label: string; value: any }> = [{ label: 'error', value: error }]
  const visited = new Set<any>()
  const details: string[] = []

  while (queue.length > 0 && details.length < 8) {
    const current = queue.shift()
    if (!current?.value || visited.has(current.value)) continue
    visited.add(current.value)

    const value = current.value
    const fields = [
      value.name && `name=${sanitizeBinanceErrorText(value.name)}`,
      value.code && `code=${sanitizeBinanceErrorText(value.code)}`,
      value.errno && `errno=${sanitizeBinanceErrorText(value.errno)}`,
      value.syscall && `syscall=${sanitizeBinanceErrorText(value.syscall)}`,
      value.hostname && `hostname=${sanitizeBinanceErrorText(value.hostname)}`,
      value.address && `address=${sanitizeBinanceErrorText(value.address)}`,
      value.port && `port=${sanitizeBinanceErrorText(value.port)}`,
      value.message && `message=${sanitizeBinanceErrorText(value.message)}`,
    ].filter(Boolean)

    details.push(`${current.label}{${fields.join(',')}}`)

    if (value.cause) {
      queue.push({ label: `${current.label}.cause`, value: value.cause })
    }
    if (Array.isArray(value.errors)) {
      value.errors.slice(0, 3).forEach((child: any, index: number) => {
        queue.push({ label: `${current.label}.errors[${index}]`, value: child })
      })
    }
  }

  return details.join(' | ') || 'error{message=unknown}'
}

/**
 * 为 CCXT 安装保留原始 cause 的 fetch 实现。
 *
 * 当前 CCXT 会把 FetchError 转换成不含 cause 的 NetworkError，导致 DNS、
 * TCP、TLS 等底层错误码丢失。这里仅保留诊断信息，不执行重试或额外请求。
 */
function enableTransportErrorDiagnostics(exchange: ccxt.binance): void {
  const exchangeWithFetch = exchange as any
  const nativeFetch = globalThis.fetch.bind(globalThis)
  const AbortError = globalThis.DOMException

  exchangeWithFetch.fetchImplementation = async (url: string, init: RequestInit) => {
    try {
      return await nativeFetch(url, init)
    } catch (error: any) {
      // 让 CCXT 继续按原有逻辑识别请求超时，不能把超时伪装成普通网络错误。
      if (AbortError && error instanceof AbortError && error.name === 'AbortError') {
        throw error
      }

      const transportError: any = new Error('Binance 底层网络请求失败', { cause: error })
      transportError.name = 'BinanceTransportError'
      transportError.code = error?.code || error?.cause?.code
      throw transportError
    }
  }
  exchangeWithFetch.AbortError = AbortError
  exchangeWithFetch.FetchError = TypeError
}

export class BinanceService {
  public publicExchange: ccxt.binance  // 公共实例，用于查询公开数据
  private privateExchange: ccxt.binance // 私有实例，用于交易操作
  private marketsLoaded: boolean = false
  
  constructor() {
    const config = useRuntimeConfig()
    
    // 公共实例：不需要API密钥，用于查询公开数据（K线、价格等）
    this.publicExchange = new ccxt.binance({
      options: {
        defaultType: 'future', // USDT永续合约
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
    })

    // 私有实例：需要API密钥，用于交易操作和账户查询
    this.privateExchange = new ccxt.binance({
      apiKey: config.binanceApiKey,
      secret: config.binanceSecret,
      options: {
        defaultType: 'future', // USDT永续合约
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
    })
    enableTransportErrorDiagnostics(this.privateExchange)
  }

  async initialize(): Promise<void> {
    if (!this.marketsLoaded) {
      // 使用公共实例加载市场信息（不需要API密钥）
      await binanceApiGateway.marketData('loadMarkets', () =>
        this.publicExchange.loadMarkets()
      )
      this.marketsLoaded = true
    }
  }

  /**
   * 获取K线数据（使用公共实例）
   * @param symbol 交易对
   * @param timeframe 时间周期
   * @param since 开始时间戳（毫秒），可选
   * @param limit 限制数量
   */
  async fetchOHLCV(symbol: string, timeframe: string, since?: number, limit = 100): Promise<OHLCV[]> {
    try {
      // 使用公共实例查询K线数据
      const ohlcv = await binanceApiGateway.marketData(`fetchOHLCV:${symbol}:${timeframe}:${since || 0}:${limit}`, () =>
        this.publicExchange.fetchOHLCV(symbol, timeframe, since, limit)
      )
      return ohlcv.map(candle => ({
        timestamp: Number(Number(candle[0] || 0).toFixed(5)),
        open: Number(Number(candle[1] || 0).toFixed(5)),
        high: Number(Number(candle[2] || 0).toFixed(5)),
        low: Number(Number(candle[3] || 0).toFixed(5)),
        close: Number(Number(candle[4] || 0).toFixed(5)),
        volume: Number(Number(candle[5] || 0).toFixed(5)),
      }))
    } catch (error: any) {
      throw new Error(`获取K线数据失败: ${error.message}`)
    }
  }

  /**
   * 获取当前价格（使用公共实例）
   */
  async fetchPrice(symbol: string): Promise<number> {
    try {
      // 使用公共实例查询价格
      const ticker = await binanceApiGateway.marketData(`fetchPrice:${symbol}`, () =>
        this.publicExchange.fetchTicker(symbol)
      )
      return Number(Number(ticker.last || 0).toFixed(5))
    } catch (error: any) {
      throw new Error(`获取价格失败: ${error.message}`)
    }
  }

  /**
   * 获取账户余额（使用私有实例）
   */
  async fetchBalance(): Promise<AccountInfo> {
    try {
      // 使用私有实例查询余额
      const balance = await binanceApiGateway.account('fetchBalance', () =>
        this.privateExchange.fetchBalance()
      )
      const usdt = balance['USDT'] || { free: 0, total: 0 }
      
      return {
        balance: Number(Number(usdt.total || 0).toFixed(5)),
        availableBalance: Number(Number(usdt.free || 0).toFixed(5)),
        totalPnL: 0,
        positions: [],
      }
    } catch (error: any) {
      throw new Error(`获取账户余额失败: ${error.message}`)
    }
  }

  /**
   * 获取加密货币余额（合约账户）（使用私有实例）
   * 返回完整的balance实例
   */
  async fetchCryptoBalances(): Promise<any> {
    try {
      // 使用私有实例获取合约账户余额
      const balance = await binanceApiGateway.account('fetchCryptoBalances', () =>
        this.privateExchange.fetchBalance()
      )
      return balance
    } catch (error: any) {
      // 如果获取余额失败，返回空对象
      console.warn(`获取加密货币余额失败: ${error.message}`)
      return {}
    }
  }

  /**
   * 设置杠杆（使用私有实例）
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      await binanceApiGateway.trade(`setLeverage:${symbol}`, () =>
        this.privateExchange.setLeverage(leverage, symbol)
      )
    } catch (error: any) {
      throw new Error(`设置杠杆失败: ${error.message}`)
    }
  }

  /**
   * 设置保证金模式（逐仓/全仓）（使用私有实例）
   */
  async setMarginMode(symbol: string, marginMode: 'isolated' | 'cross' = 'isolated'): Promise<void> {
    try {
      await binanceApiGateway.trade(`setMarginMode:${symbol}`, () =>
        this.privateExchange.setMarginMode(marginMode, symbol)
      )
    } catch (error: any) {
      // 如果已经是该模式，忽略错误
      if (!error.message.includes('No need to change')) {
        throw new Error(`设置保证金模式失败: ${error.message}`)
      }
    }
  }

  /**
   * 市价开仓（使用私有实例）
   */
  async marketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
  ): Promise<Order> {
    try {
      const order = await binanceApiGateway.trade(`marketOrder:${symbol}:${side}`, () =>
        this.privateExchange.createOrder(
          symbol, 
          'market', 
          side, 
          amount,
          undefined, // price
        )
      )
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        type: 'MARKET',
        quantity: order.amount,
        price: order.price,
        average: order.average || order.price,
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
        info: order.info,
      }
    } catch (error: any) {
      throw new Error(`市价下单失败: ${error.message}`)
    }
  }

  /**
   * 止损单（使用私有实例）
   */
  async stopLossOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    stopPrice: number,
  ): Promise<Order> {
    try {
      const order = await binanceApiGateway.trade(`stopLossOrder:${symbol}:${side}`, () =>
        this.privateExchange.createOrder(
          symbol,
          'STOP_MARKET',
          side,
          amount,
          undefined,
          { 
            stopPrice,
            reduceOnly: true,
            workingType: 'MARK_PRICE',
          }
        )
      )
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        type: 'STOP_MARKET',
        quantity: order.amount,
        stopPrice,
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
      }
    } catch (error: any) {
      throw new Error(`止损单下单失败: ${error.message}`)
    }
  }

  /**
   * 止盈单（使用私有实例）
   */
  async takeProfitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    stopPrice: number,
    isEntry: boolean = false
  ): Promise<Order> {
    try {
      const order = await binanceApiGateway.trade(`takeProfitOrder:${symbol}:${side}`, () =>
        this.privateExchange.createOrder(
          symbol,
          'take_profit_market',
          side,
          amount,
          undefined,
          { 
            stopPrice,
            reduceOnly: true
          }
        )
      )
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        type: 'TAKE_PROFIT_MARKET',
        quantity: order.amount,
        stopPrice,
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
      }
    } catch (error: any) {
      throw new Error(`止盈单下单失败: ${error.message}`)
    }
  }

  /**
   * 取消订单（使用私有实例）
   */
  async cancelOrder(orderId: string, symbol: string, params?: { trigger?: boolean }): Promise<void> {
    try {
      await binanceApiGateway.trade(`cancelOrder:${symbol}:${orderId}`, () =>
        this.privateExchange.cancelOrder(orderId, symbol, params)
      )
    } catch (error: any) {
      throw new Error(`取消订单失败: ${error.message}`)
    }
  }

  /**
   * 取消所有订单（使用私有实例）
   */
  async cancelAllOrders(symbol: string): Promise<void> {
    try {
      await binanceApiGateway.trade(`cancelAllOrders:${symbol}`, () =>
        this.privateExchange.cancelAllOrders(symbol)
      )
    } catch (error: any) {
      throw new Error(`取消所有订单失败: ${error.message}`)
    }
  }

  /**
   * 获取当前持仓（使用私有实例）
   */
  async fetchPositions(symbol?: string): Promise<Position[]> {
    try {
      const positions = await binanceApiGateway.account(`fetchPositions:${symbol || 'all'}`, () =>
        this.privateExchange.fetchPositions(symbol ? [symbol] : undefined)
      )
      
      return positions
        .filter((p: any) => Number(Number(p.contracts || p.info?.positionAmt || 0).toFixed(5)) !== 0)
        .map((p: any) => {
          // contracts 是绝对数量，必须优先使用 positionAmt/side 判断多空，否则空头会被误判为 LONG。
          const rawPositionAmt = Number(p.info?.positionAmt ?? p.positionAmt ?? 0)
          const direction = rawPositionAmt !== 0
            ? (rawPositionAmt > 0 ? 'LONG' : 'SHORT')
            : (String(p.side || '').toLowerCase() === 'short' ? 'SHORT' : 'LONG')
          return {
          // CCXT 永续合约可能返回 SYMBOL/USDT:USDT；系统内部统一使用 SYMBOL/USDT。
          symbol: String(p.symbol || '').split(':')[0] || '',
          direction,
          entryPrice: Number(Number(p.entryPrice || 0).toFixed(5)),
          quantity: Number(Math.abs(Number(Number(p.contracts || p.info?.positionAmt || 0).toFixed(5))).toFixed(5)),
          leverage: Number(Number(p.leverage || 1).toFixed(5)),
          stopLoss: 0,
          initialStopLoss: 0,
          takeProfit1: 0,
          takeProfit2: 0,
          openTime: Date.now(),
          }
        })
    } catch (error: any) {
      // 必须保留完整错误链，否则 CCXT 的 NetworkError 无法判断 DNS、TCP 或 TLS 故障。
      throw new Error(`获取持仓失败: ${formatBinanceErrorDetails(error)}`, { cause: error })
    }
  }

  /**
   * 查询指定持仓期间实际发生的资金费
   *
   * 返回值保留币安 Income History 的资金方向：正数表示收到资金费，负数表示支付资金费。
   */
  async fetchFundingFee(symbol: string, openTime: number, closeTime: number): Promise<number> {
    const ledger = await binanceApiGateway.account(`fetchFundingFee:${symbol}:${openTime}:${closeTime}`, () =>
      this.privateExchange.fetchLedger('USDT', openTime, 1000, {
        until: closeTime,
        type: 'future',
        incomeType: 'FUNDING_FEE',
      })
    )
    const marketId = this.privateExchange.market(symbol).id

    return ledger.reduce((total: number, entry: any) => {
      if (entry.info?.incomeType !== 'FUNDING_FEE') return total
      if (String(entry.info?.symbol || '') !== marketId) return total
      const amount = Math.abs(Number(entry.amount || 0))
      return total + (entry.direction === 'out' ? -amount : amount)
    }, 0)
  }

  /**
   * 查询并汇总指定订单的真实成交明细
   *
   * 币安一个订单可能拆成多笔撮合，已实现盈亏和手续费必须从 userTrades
   * 汇总，不能使用订单名义价格或统一费率推算。
   */
  async fetchOrderExecutionSummary(
    symbol: string,
    orderId: string
  ): Promise<OrderExecutionSummary | null> {
    // 币安 USD-M 接口不允许 orderId 与 startTime 同时传递；orderId 已足够精确定位成交。
    const trades = await binanceApiGateway.account(`fetchOrderTrades:${symbol}:${orderId}`, () =>
      this.privateExchange.fetchMyTrades(symbol, undefined, 1000, { orderId })
    )

    const orderTrades = trades.filter((trade: any) => {
      const tradeOrderId = trade.order || trade.info?.orderId
      return String(tradeOrderId ?? '') === String(orderId)
    })

    if (orderTrades.length === 0) {
      return null
    }

    const commissionMap = new Map<string, { amount: number; amountInUsdt: number }>()
    const assetPriceCache = new Map<string, number>()
    let executedQuantity = 0
    let quoteQuantity = 0
    let realizedPnl = 0
    let commissionInUsdt = 0
    let timestamp = 0

    for (const trade of orderTrades) {
      const quantity = Number(trade.amount || trade.info?.qty || 0)
      const price = Number(trade.price || trade.info?.price || 0)
      const quote = Number(trade.cost || trade.info?.quoteQty || price * quantity)
      const commissionAmount = Math.abs(Number(trade.fee?.cost ?? trade.info?.commission ?? 0))
      const commissionAsset = String(trade.fee?.currency || trade.info?.commissionAsset || 'USDT').toUpperCase()

      let assetPrice = 1
      if (!['USDT', 'USDC', 'FDUSD'].includes(commissionAsset)) {
        if (!assetPriceCache.has(commissionAsset)) {
          // 币安未在成交明细中提供手续费的 USDT 价值，只能按结算时市场价折算并保留原始币种数量。
          assetPriceCache.set(commissionAsset, await this.fetchPrice(`${commissionAsset}/USDT`))
        }
        assetPrice = assetPriceCache.get(commissionAsset) || 0
      }

      const amountInUsdt = commissionAmount * assetPrice
      const currentCommission = commissionMap.get(commissionAsset) || { amount: 0, amountInUsdt: 0 }
      currentCommission.amount += commissionAmount
      currentCommission.amountInUsdt += amountInUsdt
      commissionMap.set(commissionAsset, currentCommission)

      executedQuantity += quantity
      quoteQuantity += quote
      realizedPnl += Number(trade.info?.realizedPnl || 0)
      commissionInUsdt += amountInUsdt
      timestamp = Math.max(timestamp, Number(trade.timestamp || trade.info?.time || 0))
    }

    return {
      orderId: String(orderId),
      symbol,
      averagePrice: executedQuantity > 0 ? quoteQuantity / executedQuantity : 0,
      executedQuantity,
      quoteQuantity,
      realizedPnl,
      commissionInUsdt,
      commissions: Array.from(commissionMap.entries()).map(([asset, value]) => ({ asset, ...value })),
      tradeIds: orderTrades.map((trade: any) => String(trade.id || trade.info?.id || '')),
      timestamp: timestamp || Date.now(),
    }
  }

  /**
   * 等待币安成交明细可查询
   *
   * 下单接口返回和 userTrades 可见之间存在短暂延迟，因此进行有限次数重试。
   */
  async waitForOrderExecutionSummary(
    symbol: string,
    orderId: string,
    maxAttempts: number = 6
  ): Promise<OrderExecutionSummary | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const summary = await this.fetchOrderExecutionSummary(symbol, orderId)
      if (summary && summary.executedQuantity > 0) {
        return summary
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 400 * attempt))
      }
    }
    return null
  }

  /**
   * 获取订单状态（使用私有实例）
   */
  async fetchOrder(orderId: string, symbol: string,  params?: { trigger?: boolean }): Promise<Order> {
    try {
      const order = await binanceApiGateway.account(`fetchOrder:${symbol}:${orderId}`, () =>
        this.privateExchange.fetchOrder(orderId, symbol, params )
      )
      
      // 映射订单类型
      const mapOrderType = (ccxtType: string | undefined): Order['type'] => {
        if (!ccxtType) return 'MARKET'
        const type = ccxtType.toLowerCase()
        if (type.includes('market')) return 'MARKET'
        if (type.includes('limit')) return 'LIMIT'
        if (type.includes('stop_market') || type.includes('stop')) return 'STOP_MARKET'
        if (type.includes('take_profit_market') || type.includes('take_profit')) return 'TAKE_PROFIT_MARKET'
        return 'MARKET' // 默认值
      }
      
      // 处理可能为undefined的字段
      const side = order.side ? order.side.toUpperCase() as 'BUY' | 'SELL' : 'BUY'
      const orderType = mapOrderType(order.type)
      
      // 获取平均成交价（如果存在）
      const average = order.average || order.price
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side,
        type: orderType,
        quantity: order.amount,
        price: order.price,
        average,  // 添加平均成交价
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
        info: order.info,
      }
    } catch (error: any) {
      throw new Error(`获取订单状态失败: ${error.message}`)
    }
  }

  /**
   * 计算合适的下单数量（考虑精度）（使用公共实例获取市场信息）
   */
  async calculateOrderAmount(symbol: string, usdtAmount: number, price: number): Promise<number> {
    try {
      // 确保市场信息已加载
      if (!this.marketsLoaded) {
        await this.initialize()
      }
      
      // 使用公共实例获取市场信息（不需要API密钥）
      const market = this.publicExchange.market(symbol)
      const amount = Number((usdtAmount / price).toFixed(8))
      
      // 获取精度信息
      let precisionDecimals: number
      const precisionAmount = market.precision?.amount
      
      // 判断precision是小数位数还是精度值
      if (precisionAmount !== undefined && precisionAmount < 1) {
        // 如果是精度值（如0.01），转换为小数位数
        precisionDecimals = Math.abs(Math.log10(precisionAmount))
      } else {
        // 如果是小数位数（如2），直接使用
        precisionDecimals = precisionAmount || 3
      }
      
      // 获取最小交易量限制
      const minAmount = market.limits?.amount?.min || 0.001
      
      // 根据精度调整数量
      let finalAmount = Number(amount.toFixed(precisionDecimals))
      
      // 确保数量不小于最小交易量
      if (finalAmount < minAmount) {
        // 向上取整到满足最小交易量
        finalAmount = Number(Math.ceil(minAmount / Math.pow(10, -precisionDecimals)) * Math.pow(10, -precisionDecimals))
      }
      
      console.log('计算下单数量:', {
        symbol,
        usdtAmount,
        price,
        rawAmount: amount,
        precisionAmount,
        precisionDecimals,
        minAmount,
        finalAmount
      })
      
      // 二次验证：确保最终数量有效
      if (finalAmount < minAmount) {
        throw new Error(`计算的数量${finalAmount}小于最小交易量${minAmount}，可能是余额不足`)
      }
      
      return finalAmount
    } catch (error: any) {
      throw new Error(`计算下单数量失败: ${error.message}`)
    }
  }

  /**
   * 查询最近订单（使用私有实例）
   * @param symbol 交易对
   * @param since 开始时间戳（毫秒）
   * @param limit 限制数量
   */
  async fetchRecentOrders(symbol: string, since?: number, limit: number = 20): Promise<Order[]> {
    try {
      const orders = await binanceApiGateway.account(`fetchRecentOrders:${symbol}`, () =>
        this.privateExchange.fetchOrders(symbol, since, limit)
      )
      
      return orders.map((order: any) => {
        // 映射订单类型
        const mapOrderType = (ccxtType: string | undefined): Order['type'] => {
          if (!ccxtType) return 'MARKET'
          const type = ccxtType.toLowerCase()
          if (type.includes('market')) return 'MARKET'
          if (type.includes('limit')) return 'LIMIT'
          if (type.includes('stop_market') || type.includes('stop')) return 'STOP_MARKET'
          if (type.includes('take_profit_market') || type.includes('take_profit')) return 'TAKE_PROFIT_MARKET'
          return 'MARKET'
        }
        
        const side = order.side ? order.side.toUpperCase() as 'BUY' | 'SELL' : 'BUY'
        const orderType = mapOrderType(order.type)
        
        return {
          orderId: order.id,
          symbol: order.symbol,
          side,
          type: orderType,
          quantity: order.amount,
          price: order.price,
          average: order.average || order.price,
          stopPrice: order.stopPrice,
          status: order.status || 'unknown',
          timestamp: order.timestamp || Date.now(),
          info: order.info,
        }
      })
    } catch (error: any) {
      // 如果查询失败，返回空数组
      console.warn(`查询最近订单失败: ${error.message}`)
      return []
    }
  }

  /**
   * 查询特定订单的历史状态（使用私有实例）
   * @param orderId 订单ID
   * @param symbol 交易对
   */
  async fetchOrderHistory(orderId: string, symbol: string): Promise<Order | null> {
    try {
      const order = await binanceApiGateway.account(`fetchOrderHistory:${symbol}:${orderId}`, () =>
        this.privateExchange.fetchOrder(orderId, symbol)
      )
      
      // 映射订单类型
      const mapOrderType = (ccxtType: string | undefined): Order['type'] => {
        if (!ccxtType) return 'MARKET'
        const type = ccxtType.toLowerCase()
        if (type.includes('market')) return 'MARKET'
        if (type.includes('limit')) return 'LIMIT'
        if (type.includes('stop_market') || type.includes('stop')) return 'STOP_MARKET'
        if (type.includes('take_profit_market') || type.includes('take_profit')) return 'TAKE_PROFIT_MARKET'
        return 'MARKET'
      }
      
      const side = order.side ? order.side.toUpperCase() as 'BUY' | 'SELL' : 'BUY'
      const orderType = mapOrderType(order.type)
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side,
        type: orderType,
        quantity: order.amount,
        price: order.price,
        average: order.average || order.price,
        stopPrice: order.stopPrice,
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
        info: order.info,
      }
    } catch (error: any) {
      // 如果查询失败，返回null
      console.warn(`查询订单历史失败: ${error.message}`)
      return null
    }
  }

  /**
   * 获取当前持仓量（OI）
   * @param symbol 交易对
   */
  async fetchOpenInterest(symbol: string): Promise<{
    symbol: string
    openInterest: number
    timestamp: number
  }> {
    try {
      const oi = await binanceApiGateway.marketData<any>(`fetchOpenInterest:${symbol}`, () =>
        this.publicExchange.fetchOpenInterest(symbol) as any
      )
      const openInterestValue = Number(oi.openInterest || oi.contracts || oi.openInterestAmount || oi.info?.sumOpenInterest || 0)
      return {
        symbol: oi.symbol,
        openInterest: Number(openInterestValue.toFixed(5)),
        timestamp: oi.timestamp || Date.now()
      }
    } catch (error: any) {
      throw new Error(`获取持仓量失败: ${error.message}`)
    }
  }

  /**
   * 获取历史持仓量数据
   * @param symbol 交易对
   * @param timeframe 时间周期
   * @param since 开始时间戳
   * @param limit 数量限制
   */
  async fetchOpenInterestHistory(
    symbol: string,
    timeframe: string = '5m',
    since?: number,
    limit = 100
  ): Promise<Array<{
    timestamp: number
    openInterest: number
  }>> {
    try {
      const oiHistory = await binanceApiGateway.marketData<any[]>(`fetchOpenInterestHistory:${symbol}:${timeframe}:${limit}`, () =>
        this.publicExchange.fetchOpenInterestHistory(
          symbol,
          timeframe,
          since,
          limit
        )
      )
      
      const processedHistory = oiHistory.map(item => {
        const openInterestValue = Number(item.openInterest || item.contracts || item.openInterestAmount || item.info?.sumOpenInterest || 0)
        return {
          timestamp: item.timestamp || 0,
          openInterest: Number(openInterestValue.toFixed(5))
        }
      })
      
      return processedHistory
    } catch (error: any) {
      throw new Error(`获取历史持仓量失败: ${error.message}`)
    }
  }

}
