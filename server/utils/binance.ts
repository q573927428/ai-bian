import * as ccxt from 'ccxt'
import type { OHLCV, Order, AccountInfo, Position, CryptoBalance } from '../../types'

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
  }

  async initialize(): Promise<void> {
    if (!this.marketsLoaded) {
      // 使用公共实例加载市场信息（不需要API密钥）
      await this.publicExchange.loadMarkets()
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
      const ohlcv = await this.publicExchange.fetchOHLCV(symbol, timeframe, since, limit)
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
      const ticker = await this.publicExchange.fetchTicker(symbol)
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
      const balance = await this.privateExchange.fetchBalance()
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
      const balance = await this.privateExchange.fetchBalance()
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
      await this.privateExchange.setLeverage(leverage, symbol)
    } catch (error: any) {
      throw new Error(`设置杠杆失败: ${error.message}`)
    }
  }

  /**
   * 设置保证金模式（逐仓/全仓）（使用私有实例）
   */
  async setMarginMode(symbol: string, marginMode: 'isolated' | 'cross' = 'isolated'): Promise<void> {
    try {
      await this.privateExchange.setMarginMode(marginMode, symbol)
    } catch (error: any) {
      // 如果已经是该模式，忽略错误
      if (!error.message.includes('No need to change')) {
        throw new Error(`设置保证金模式失败: ${error.message}`)
      }
    }
  }

  /**
   * 设置持仓模式（单向/双向）（使用私有实例）
   */
  async setPositionMode(hedgeMode: boolean = false): Promise<void> {
    try {
      // Binance API: 设置持仓模式
      // hedgeMode: true = 双向持仓模式, false = 单向持仓模式
      await this.privateExchange.setPositionMode(hedgeMode)
    } catch (error: any) {
      // 如果已经是该模式，忽略错误
      if (!error.message.includes('No need to change')) {
        throw new Error(`设置持仓模式失败: ${error.message}`)
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
      const order = await this.privateExchange.createOrder(
        symbol, 
        'market', 
        side, 
        amount,
        undefined, // price
      )
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        type: 'MARKET',
        quantity: order.amount,
        price: order.price,
        status: order.status || 'unknown',
        timestamp: order.timestamp || Date.now(),
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
      const order = await this.privateExchange.createOrder(
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
      const order = await this.privateExchange.createOrder(
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
      await this.privateExchange.cancelOrder(orderId, symbol, params)
    } catch (error: any) {
      throw new Error(`取消订单失败: ${error.message}`)
    }
  }

  /**
   * 取消所有订单（使用私有实例）
   */
  async cancelAllOrders(symbol: string): Promise<void> {
    try {
      await this.privateExchange.cancelAllOrders(symbol)
    } catch (error: any) {
      throw new Error(`取消所有订单失败: ${error.message}`)
    }
  }

  /**
   * 获取当前持仓（使用私有实例）
   */
  async fetchPositions(symbol?: string): Promise<Position[]> {
    try {
      const positions = await this.privateExchange.fetchPositions(symbol ? [symbol] : undefined)
      
      return positions
        .filter((p: any) => Number(Number(p.contracts || p.info?.positionAmt || 0).toFixed(5)) !== 0)
        .map((p: any) => ({
          symbol: p.symbol,
          direction: Number(Number(p.contracts || p.info?.positionAmt || 0).toFixed(5)) > 0 ? 'LONG' : 'SHORT',
          entryPrice: Number(Number(p.entryPrice || 0).toFixed(5)),
          quantity: Number(Math.abs(Number(Number(p.contracts || p.info?.positionAmt || 0).toFixed(5))).toFixed(5)),
          leverage: Number(Number(p.leverage || 1).toFixed(5)),
          stopLoss: 0,
          initialStopLoss: 0,
          takeProfit1: 0,
          takeProfit2: 0,
          openTime: Date.now(),
        }))
    } catch (error: any) {
      throw new Error(`获取持仓失败: ${error.message}`)
    }
  }

  /**
   * 获取订单状态（使用私有实例）
   */
  async fetchOrder(orderId: string, symbol: string,  params?: { trigger?: boolean }): Promise<Order> {
    try {
      const order = await this.privateExchange.fetchOrder(orderId, symbol, params )
      
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
      const orders = await this.privateExchange.fetchOrders(symbol, since, limit)
      
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
      const order = await this.privateExchange.fetchOrder(orderId, symbol)
      
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
      const oi = await this.publicExchange.fetchOpenInterest(symbol) as any
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
      const oiHistory = await this.publicExchange.fetchOpenInterestHistory(
        symbol,
        timeframe,
        since,
        limit
      ) as any[]
      
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
