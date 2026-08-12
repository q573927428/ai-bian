// ==================== 多策略持仓监控模块 ====================

import type { PositionInfo } from '../position-manager/PositionManager'
import { PositionManager } from '../position-manager/PositionManager'
import { BinanceService } from '../../utils/binance'
import { StrategyPositionCloser } from './StrategyPositionCloser'
import { logger } from '../../utils/logger'
import type { Strategy } from '../../../types/strategy'
import type { BotConfig, Position } from '../../../types'
import { checkTP1Condition, checkTP2Condition, isPositionTimeout, convertStrategyRiskConfig } from '../../utils/risk'
import { IndicatorsHub } from '../indicators/IndicatorsHub'
import { priceCacheService } from '../market-data/PriceCacheService'

/**
 * 多策略持仓监控模块
 * 负责监控所有持仓的止盈、止损、移动止损、超时平仓等条件
 */
export class StrategyPositionMonitor {
  private binance: BinanceService
  private positionManager: PositionManager
  private positionCloser: StrategyPositionCloser
  private config: BotConfig
  private strategyStore: any // 策略存储，获取策略配置

  private monitorTimer: NodeJS.Timeout | null = null
  private isMonitoring = false

  // 移动止损激活状态: positionKey(strategyId:symbol:openTime) -> boolean
  private trailingStopActivated: Map<string, boolean> = new Map()
  private monitorCount: number = 0

  /**
   * 生成仓位唯一键，避免同 symbol 不同仓位之间状态污染
   */
  private getPositionKey(position: PositionInfo): string {
    return `${position.strategyId}:${position.symbol}:${position.openTime}`
  }

  /**
   * 清理已不存在仓位的移动止损激活状态
   */
  private cleanupTrailingStopState(positions: PositionInfo[]): void {
    const activeKeys = new Set(positions.map(p => this.getPositionKey(p)))
    for (const key of this.trailingStopActivated.keys()) {
      if (!activeKeys.has(key)) {
        this.trailingStopActivated.delete(key)
      }
    }
  }

  constructor(
    binance: BinanceService,
    positionManager: PositionManager,
    positionCloser: StrategyPositionCloser,
    config: BotConfig,
    strategyStore: any
  ) {
    this.binance = binance
    this.positionManager = positionManager
    this.positionCloser = positionCloser
    this.config = config
    this.strategyStore = strategyStore
  }

  private getMonitorInterval(): number {
    const intervalSeconds = Number(this.config.monitorInterval)
    const safeSeconds = Number.isFinite(intervalSeconds) && intervalSeconds >= 30 ? intervalSeconds : 30
    return safeSeconds * 1000
  }

  /**
   * 启动监控
   */
  start(options: { immediate?: boolean; initialDelayMs?: number } = {}): void {
    if (this.monitorTimer) {
      logger.warn('持仓监控', '监控已在运行')
      return
    }

    const immediate = options.immediate ?? true
    const initialDelayMs = Math.max(0, Number(options.initialDelayMs ?? 0))
    const runMonitor = async () => {
      // 网络变慢时上一轮可能尚未结束；跳过重入，避免相同请求成倍进入限流队列。
      if (this.isMonitoring) {
        logger.warn('持仓监控', '上一轮监控尚未完成，跳过本轮')
        return
      }

      this.isMonitoring = true
      try {
        await this.monitorPositions()
      } catch (error: any) {
        logger.error('持仓监控', '监控循环异常:', error.message)
      } finally {
        this.isMonitoring = false
      }
    }
    const startInterval = () => {
      if (immediate) {
        runMonitor()
      }

      this.monitorTimer = setInterval(runMonitor, this.getMonitorInterval())
    }

    if (initialDelayMs > 0) {
      this.monitorTimer = setTimeout(() => {
        this.monitorTimer = null
        startInterval()
      }, initialDelayMs)
    } else {
      startInterval()
    }

    // logger.success('持仓监控', '持仓监控已启动')
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = null
      logger.info('持仓监控', '持仓监控已停止')
    }
  }

  /**
   * 监控所有持仓
   */
  private async monitorPositions(): Promise<void> {
    const positions = this.positionManager.getAllPositions()

    if (positions.length === 0) {
      this.monitorCount = 0
      this.trailingStopActivated.clear()
      return
    }

    // 清理陈旧的移动止损激活状态，避免跨仓位污染
    this.cleanupTrailingStopState(positions)

    const exchangePositions = await this.fetchExchangePositionsSnapshot()
    if (!exchangePositions) return
    const currentPrices = await this.fetchCurrentPrices(positions)

    // 每隔一次输出日志（频率为监控间隔的两倍），并复用本轮价格快照。
    const logEvery = 2
    if (this.monitorCount % logEvery === 0) {
      this.logAllPositionsDetails(positions, currentPrices)
    }
    // 计数只在 0~logEvery-1 之间循环，避免理论上的溢出
    this.monitorCount = (this.monitorCount + 1) % logEvery

    for (const position of positions) {
      try {
        await this.monitorSinglePosition(position, exchangePositions, currentPrices.get(position.symbol))
      } catch (error: any) {
        logger.error('持仓监控', `监控 ${position.symbol} 失败: ${error.message}`)
      }
    }
  }

  /**
   * 获取本轮价格快照，同一交易对只请求一次并供日志与风控共同使用
   */
  private async fetchCurrentPrices(positions: PositionInfo[]): Promise<Map<string, number>> {
    const symbols = Array.from(new Set(positions.map(position => position.symbol)))
    const priceEntries = await Promise.all(symbols.map(async symbol => {
      try {
        const price = await priceCacheService.getPrice(this.binance, symbol)
        return [symbol, price] as const
      } catch (error: any) {
        logger.error('持仓监控', `获取 ${symbol} 当前价失败: ${error.message}`)
        return null
      }
    }))

    return new Map(priceEntries.filter((entry): entry is readonly [string, number] => entry !== null))
  }

  /**
   * 批量获取交易所持仓；失败时跳过本轮，避免退化成每个仓位一次账户请求
   */
  private async fetchExchangePositionsSnapshot(): Promise<Position[] | null> {
    try {
      return await this.binance.fetchPositions()
    } catch (error: any) {
      // 陈旧账户快照可能误判刚开仓的仓位；本轮失败时等待下一轮恢复更稳妥。
      logger.error('持仓监控', `批量获取交易所持仓失败，跳过本轮: ${error.message}`)
      return null
    }
  }

  /**
   * 记录所有持仓详细信息
   */
  private logAllPositionsDetails(positions: PositionInfo[], currentPrices: Map<string, number>): void {
    for (const position of positions) {
      const currentPrice = currentPrices.get(position.symbol)
      if (currentPrice === undefined) continue
        
      // 计算盈亏
      const priceDiff = position.direction === 'long'
        ? currentPrice - position.entryPrice
        : position.entryPrice - currentPrice
        
      const pnl = priceDiff * position.quantity
      const pnlPercentage = (priceDiff / position.entryPrice) * 100 * position.leverage

      // 移动止损状态保存在完整 Position 中；兼容旧仓位只保存顶层字段的情况。
      const trailingStopCount = position.position?.trailingStopData?.trailingStopCount ?? 0
      const currentStopLoss = position.stopLoss ?? position.position?.stopLoss
      const initialStopLoss = position.initialStopLoss ?? position.position?.initialStopLoss
      // 只有止损价实际移动过，才在常规持仓日志中追加移动止损信息。
      const trailingStopText = trailingStopCount > 0
        ? `移动:${trailingStopCount}次 ` +
          `移损:${currentStopLoss !== undefined ? currentStopLoss.toFixed(4) : '--'} ` +
          `初损:${initialStopLoss !== undefined ? initialStopLoss.toFixed(4) : '--'} `
        : ''
        
      const directionText = position.direction === 'long' ? '做多' : '做空'
        
      logger.info('持仓监控',
        `${position.symbol.padEnd(12)} ` +
        `${directionText.padEnd(6)} ` +
        `入场价:${position.entryPrice.toFixed(2).padStart(10)} ` +
        `当前价:${currentPrice.toFixed(2).padStart(10)} ` +
        `盈亏:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}USDT ` +
        `${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(2)}% ` +
        trailingStopText +
        `[${position.strategyId}]`
      )
    }
  }

  /**
   * 监控单个持仓
   */
  private async monitorSinglePosition(
    position: PositionInfo,
    exchangePositions: Position[],
    currentPrice?: number
  ): Promise<void> {
    const symbol = position.symbol
    
    // 1. 首先检查持仓一致性，防止本地状态与交易所不一致
    const isConsistent = await this.positionCloser.checkPositionConsistency(symbol, exchangePositions)
    if (!isConsistent) {
      logger.info('持仓监控', `${symbol} 持仓已不一致，跳过本次监控`)
      return
    }

    if (currentPrice === undefined) {
      logger.warn('持仓监控', `${symbol} 缺少本轮价格，跳过价格风控检查`)
      return
    }

    // 更新仓位最高价/最低价
    this.updatePositionExtremes(position, currentPrice)

    // 获取策略配置
    const strategy = await this.strategyStore.getStrategy(position.strategyId)
    if (!strategy) {
      logger.warn('持仓监控', `未找到策略配置: ${position.strategyId}`)
      return
    }

    // 1. 检查止盈条件
    if (await this.checkTakeProfit(position, strategy, currentPrice)) {
      return
    }

    // 2. 检查移动止损
    if (strategy.riskManagement.trailingStop.enabled) {
      if (await this.checkTrailingStop(position, strategy, currentPrice)) {
        return
      }
    }

    // 3. 检查超时平仓
    if (await this.checkTimeout(position, strategy, currentPrice)) {
      return
    }
  }

  /**
   * 更新仓位的最高价/最低价和浮盈浮亏
   */
  private updatePositionExtremes(position: PositionInfo, currentPrice: number): void {
    const updates: Partial<PositionInfo> = {}
    const logParts: string[] = []

    // 计算当前浮盈浮亏
    const priceDiff = position.direction === 'long' 
      ? currentPrice - position.entryPrice 
      : position.entryPrice - currentPrice
    const floatingPnl = priceDiff * position.quantity
    const floatingPnlPercent = (priceDiff / position.entryPrice) * 100 * position.leverage

    // 更新最高价
    if (currentPrice > (position.highestPrice || position.entryPrice)) {
      const previousHighest = position.highestPrice || position.entryPrice
      updates.highestPrice = currentPrice
      logParts.push(`最高价:${previousHighest.toFixed(4)}→${currentPrice.toFixed(4)}`)
    }

    // 更新最低价
    if (currentPrice < (position.lowestPrice || position.entryPrice)) {
      const previousLowest = position.lowestPrice || position.entryPrice
      updates.lowestPrice = currentPrice
      logParts.push(`最低价:${previousLowest.toFixed(4)}→${currentPrice.toFixed(4)}`)
    }

    // 更新最大浮盈
    if (floatingPnl > (position.maxFloatingProfit || 0)) {
      updates.maxFloatingProfit = floatingPnl
      updates.maxFloatingProfitPercent = floatingPnlPercent
      logParts.push(`最大浮盈:${floatingPnl.toFixed(4)}USDT(${floatingPnlPercent.toFixed(2)}%)`)
    }

    // 更新最大浮亏
    if (floatingPnl < (position.maxFloatingLoss || 0)) {
      updates.maxFloatingLoss = floatingPnl
      updates.maxFloatingLossPercent = floatingPnlPercent
      logParts.push(`最大浮亏:${floatingPnl.toFixed(4)}USDT(${floatingPnlPercent.toFixed(2)}%)`)
    }

    // // 有更新时记录日志
    // if (logParts.length > 0) {
    //   logger.info('持仓追踪', `${position.symbol} ${logParts.join(' | ')}`)
    // }

    if (Object.keys(updates).length > 0) {
      this.positionManager.updatePosition(position.symbol, updates)
    }
  }

  /**
   * 检查止盈条件
   */
  private async checkTakeProfit(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    try {
      // 构建用于止盈检查的 Position 对象
      const posForCheck = this.buildPositionForCheck(position)

      // 从策略配置转换到止盈配置
      const { takeProfit } = convertStrategyRiskConfig(strategy.riskManagement)

      // 从 IndicatorsHub 获取指标（从策略 timeframes 中选择 entry 周期）
      const strategyTimeframes = strategy.marketData?.timeframes || ['15m']
      // 从策略 indicators 中提取最小 EMA 周期
      const emaConfig = strategy.indicators?.find((ind: any) => ind.type === 'EMA' && ind.enabled)
      const emaPeriods: number[] = emaConfig?.params?.periods || []
      const minEmaPeriod = emaPeriods.length > 0 ? Math.min(...emaPeriods) : 50
      const indicatorsHub = IndicatorsHub.getInstance(this.binance, this.config)
      const indicators = await indicatorsHub.getIndicatorsForRiskManagement(position.symbol, strategyTimeframes, minEmaPeriod)

      // 检查 TP2 条件
      const tp2Result = checkTP2Condition(posForCheck, currentPrice, indicators, takeProfit)
      if (tp2Result.shouldClose) {
        logger.warn('止盈', `${position.symbol} ${tp2Result.reason}`)
        await this.positionCloser.closePosition(position.symbol, tp2Result.reason, currentPrice)
        return true
      }

      // 检查 TP1 条件
      const tp1Result = checkTP1Condition(posForCheck, currentPrice, indicators, takeProfit)
      if (tp1Result.shouldClose) {
        logger.warn('止盈', `${position.symbol} ${tp1Result.reason}`)
        await this.positionCloser.closePosition(position.symbol, tp1Result.reason, currentPrice)
        return true
      }

      return false
    } catch (error: any) {
      logger.error('止盈', `${position.symbol} 检查止盈条件失败: ${error.message}`)
      return false
    }
  }

  /**
   * 检查移动止损
   */
  private async checkTrailingStop(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    try {
      const trailingStopConfig = strategy.riskManagement.trailingStop
      const entryPrice = position.entryPrice
      const positionKey = this.getPositionKey(position)
      
      // 优先使用 position.position.stopLoss，如果没有则用 position.stopLoss
      const stopLoss = position.position?.stopLoss ?? position.stopLoss ?? 0

      // 如果没有止损价，无法进行移动止损
      if (stopLoss === 0) {
        logger.warn('移动止损', `${position.symbol} 缺少止损价格，无法检查移动止损`)
        return false
      }

      // 计算盈亏比
      const risk = Math.abs(entryPrice - stopLoss)
      const currentProfit = position.direction === 'long'
        ? currentPrice - entryPrice
        : entryPrice - currentPrice

      const profitRatio = currentProfit / risk

      // 检查是否激活移动止损
      const isActivated = this.trailingStopActivated.get(positionKey) || false
      if (!isActivated && profitRatio >= trailingStopConfig.activationRatio) {
        this.trailingStopActivated.set(positionKey, true)
        logger.info('移动止损', `${position.symbol} 移动止损已激活，盈亏比: ${profitRatio.toFixed(2)} [${position.strategyId}]`)
        return false
      }

      // 已激活，检查是否需要移动止损
      if (isActivated) {
        const highestPrice = position.highestPrice || entryPrice
        const lowestPrice = position.lowestPrice || entryPrice

        // 计算新的止损价
        let newStopLoss: number
        if (position.direction === 'long') {
          newStopLoss = highestPrice * (1 - trailingStopConfig.trailDistance / 100)
        } else {
          newStopLoss = lowestPrice * (1 + trailingStopConfig.trailDistance / 100)
        }

        // 检查是否需要更新止损单（至少移动minMoveDistance）
        const minMove = entryPrice * trailingStopConfig.minMoveDistance / 100
        const stopLossDiff = Math.abs(newStopLoss - stopLoss)

        if (stopLossDiff >= minMove) {
          try {
            // 获取止损订单ID，优先从 position.position 获取，否则从 position 获取
            const stopLossOrderId = position.position?.stopLossOrderId ?? position.stopLossOrderId
            
            // 取消旧止损单
            if (stopLossOrderId) {
              await this.binance.cancelOrder(
                stopLossOrderId,
                position.symbol,
                { trigger: true }
              )
            }

            // 设置新止损单
            const side = position.direction === 'long' ? 'sell' : 'buy'
            const stopOrder = await this.binance.stopLossOrder(
              position.symbol,
              side,
              position.quantity,
              newStopLoss
            )

            // 获取当前移动止损次数
            const currentCount = position.position?.trailingStopData?.trailingStopCount ?? 0
            const newCount = currentCount + 1

            // 更新仓位信息 - 同时更新 position 字段和顶层字段
            const positionUpdate: any = {
              stopLoss: newStopLoss,
              stopLossOrderId: stopOrder.orderId
            }
            
            // 如果已有 position 对象，也更新它
            if (position.position) {
              positionUpdate.position = {
                ...position.position,
                stopLoss: newStopLoss,
                stopLossOrderId: stopOrder.orderId,
                trailingStopData: {
                  trailingStopCount: newCount,
                  lastTrailedPrice: newStopLoss,
                  lastTrailedTime: Date.now()
                }
              }
            } else {
              // 如果没有 position 对象，创建一个包含 trailingStopData 的
              positionUpdate.position = {
                symbol: position.symbol,
                direction: position.direction === 'long' ? 'LONG' : 'SHORT',
                entryPrice: position.entryPrice,
                quantity: position.quantity,
                leverage: position.leverage,
                stopLoss: newStopLoss,
                initialStopLoss: position.initialStopLoss || position.stopLoss || 0,
                takeProfit1: position.takeProfit1 || 0,
                takeProfit2: position.takeProfit2 || 0,
                openTime: position.openTime,
                highestPrice: position.highestPrice,
                lowestPrice: position.lowestPrice,
                orderId: position.orderId,
                stopLossOrderId: stopOrder.orderId,
                trailingStopData: {
                  trailingStopCount: newCount,
                  lastTrailedPrice: newStopLoss,
                  lastTrailedTime: Date.now()
                }
              }
            }
            
            this.positionManager.updatePosition(position.symbol, positionUpdate)

            logger.info('移动止损', `${position.symbol} 止损已更新到: ${newStopLoss} (第${newCount}次移动)`)
          } catch (error: any) {
            logger.error('移动止损', `${position.symbol} 更新止损失败: ${error.message}`)
          }
        }

        // 检查是否触发止损
        const stopHit = position.direction === 'long'
          ? currentPrice <= newStopLoss
          : currentPrice >= newStopLoss

        if (stopHit) {
          logger.info('移动止损', `${position.symbol} 触发移动止损，价格: ${currentPrice}`)
          await this.positionCloser.closePosition(position.symbol, '移动止损', currentPrice)
          this.trailingStopActivated.delete(positionKey)
          return true
        }
      }

      return false
    } catch (error: any) {
      logger.error('移动止损', `${position.symbol} 检查移动止损失败: ${error.message}`)
      return false
    }
  }

  /**
   * 检查超时平仓
   */
  private async checkTimeout(position: PositionInfo, strategy: Strategy, currentPrice: number): Promise<boolean> {
    try {
      // 构建用于超时检查的 Position 对象
      const posForCheck = this.buildPositionForCheck(position)

      // 获取超时配置（从策略配置或全局配置）
      const maxHoldTimeMinutes = strategy.riskManagement?.maxHoldTimeMinutes || 1440
      
      // 从 IndicatorsHub 获取指标（从策略 timeframes 中选择 entry 周期）
      const strategyTimeframes = strategy.marketData?.timeframes || ['15m']
      const indicatorsHub = IndicatorsHub.getInstance(this.binance, this.config)
      const indicators = await indicatorsHub.getIndicatorsForRiskManagement(position.symbol, strategyTimeframes)
      
      // 使用ADX斜率判断趋势走弱（负斜率表示ADX下降）
      const isADXDecreasing = indicators.adxSlope < 0
      
      // 检查持仓超时（ADX走弱时触发）
      const isTimeout = isPositionTimeout(posForCheck, maxHoldTimeMinutes, isADXDecreasing)
      if (isTimeout) {
        logger.warn('超时平仓', `${position.symbol} 持仓超时且ADX走弱 (ADX斜率: ${indicators.adxSlope.toFixed(2)})`)
        await this.positionCloser.closePosition(position.symbol, '持仓超时', currentPrice)
        return true
      }

      return false
    } catch (error: any) {
      logger.error('超时平仓', `${position.symbol} 检查超时条件失败: ${error.message}`)
      return false
    }
  }

  /**
   * 从 PositionInfo 构建 Position 对象用于检查
   */
  private buildPositionForCheck(info: PositionInfo): Position {
    // 如果已有完整的 position 数据，优先使用
    if (info.position) {
      return info.position
    }
    // 否则从 PositionInfo 构建
    return {
      symbol: info.symbol,
      direction: info.direction === 'long' ? 'LONG' : 'SHORT',
      entryPrice: info.entryPrice,
      quantity: info.quantity,
      leverage: info.leverage,
      stopLoss: info.stopLoss || 0,
      initialStopLoss: info.initialStopLoss || info.stopLoss || 0,
      takeProfit1: info.takeProfit1 || 0,
      takeProfit2: info.takeProfit2 || 0,
      openTime: info.openTime,
      highestPrice: info.highestPrice,
      lowestPrice: info.lowestPrice,
      orderId: info.orderId,
      stopLossOrderId: info.stopLossOrderId
    }
  }

  /**
   * 重置移动止损状态
   */
  resetTrailingStop(symbol: string): void {
    for (const key of this.trailingStopActivated.keys()) {
      if (key.includes(`:${symbol}:`)) {
        this.trailingStopActivated.delete(key)
      }
    }
  }
}
