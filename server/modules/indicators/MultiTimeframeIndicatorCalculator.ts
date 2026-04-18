// ==================== 多周期指标计算器 ====================

import type { Timeframe, TimeframeWithRole, AIInput, TimeframeData } from '../../../types/strategy'
import type { OHLCV, BotConfig } from '../../../types'
import { BinanceService } from '../../utils/binance'
import { IndicatorsHub } from './IndicatorsHub'
import { logger } from '../../utils/logger'

// 周期优先级排序（从大到小）
const timeframeOrder: Record<Timeframe, number> = {
  '1d': 5,
  '4h': 4,
  '1h': 3,
  '15m': 2,
  '5m': 1
}

/**
 * 多周期指标计算器
 *
 * 功能：
 * 1. 根据用户选择的周期数组自动分配角色
 * 2. 从IndicatorsHub获取多个周期的指标数据
 * 3. 生成AI输入格式的数据
 */
export class MultiTimeframeIndicatorCalculator {
  private binance: BinanceService
  private indicatorsHub: IndicatorsHub
  private config: BotConfig

  constructor(
    binance: BinanceService,
    indicatorsHub: IndicatorsHub,
    config: BotConfig
  ) {
    this.binance = binance
    this.indicatorsHub = indicatorsHub
    this.config = config
    // logger.info('MultiTimeframeIndicatorCalculator', '多周期指标计算器已初始化')
  }

  /**
   * 分配周期角色
   * @param tfs 周期数组
   * @returns 带角色的周期配置
   */
  assignRoles(tfs: Timeframe[]): TimeframeWithRole[] {
    const sorted = [...tfs].sort((a, b) => timeframeOrder[b] - timeframeOrder[a])

    if (sorted.length === 1) {
      return [{ tf: sorted[0] as Timeframe, role: 'entry' }]
    }

    if (sorted.length === 2) {
      return [
        { tf: sorted[0] as Timeframe, role: 'trend' },
        { tf: sorted[1] as Timeframe, role: 'entry' }
      ]
    }

    return [
      { tf: sorted[0] as Timeframe, role: 'trend' },
      { tf: sorted[1] as Timeframe, role: 'confirm' },
      { tf: sorted[2] as Timeframe, role: 'entry' }
    ]
  }

  /**
   * 计算多个周期的指标并生成AI输入
   * @param symbol 交易对
   * @param timeframes 周期数组
   * @returns AI输入数据
   */
  async calculateIndicators(
    symbol: string,
    timeframes: Timeframe[]
  ): Promise<AIInput> {
    try {
      // 1. 获取当前价格
      const currentPrice = await this.binance.fetchPrice(symbol)

      // 2. 验证周期数量（最多3个）
      const validTimeframes = timeframes.slice(0, 3)
      if (validTimeframes.length === 0) {
        throw new Error('至少需要选择一个周期')
      }

      // 3. 分配角色
      const roles = this.assignRoles(validTimeframes)
      logger.info('MultiTimeframeIndicatorCalculator', `${symbol} 周期角色分配: ${JSON.stringify(roles)}`)

      // 4. 获取每个周期的指标数据
      const timeframeDataArray: TimeframeData[] = []

      for (const { tf } of roles) {
        const timeframeData = await this.getSingleTimeframeData(symbol, tf)
        timeframeDataArray.push(timeframeData)
      }

      // 5. 构建AI输入
      const aiInput: AIInput = {
        symbol: symbol.replace('/', ''),
        price: currentPrice,
        timeframes: timeframeDataArray
      }

      logger.info('MultiTimeframeIndicatorCalculator', `${symbol} AI输入已生成: ${JSON.stringify(aiInput)}`)
      return aiInput
    } catch (error: any) {
      logger.error('MultiTimeframeIndicatorCalculator', `${symbol} 计算多周期指标失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取单个周期的指标数据
   * @param symbol 交易对
   * @param timeframe 周期
   * @returns 周期指标数据
   */
  private async getSingleTimeframeData(
    symbol: string,
    timeframe: Timeframe
  ): Promise<TimeframeData> {
    const timeframeData: TimeframeData = {
      timeframe
    }

    try {
      // 获取EMA指标
      try {
        const emaData = await this.indicatorsHub.getEMAByPeriods(symbol, timeframe, [14, 60, 120])
        const emaList = Array.isArray(emaData.values.emaList) ? emaData.values.emaList : []
        if (emaList.length > 0) {
          const fast = emaList[0]?.value ?? 0
          const medium = emaList[1]?.value ?? fast
          const slow = emaList[2]?.value ?? emaList[emaList.length - 1]?.value ?? fast
          timeframeData.ema = {
            fast,
            medium,
            slow
          }
        }
      } catch (error) {
        logger.info('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} EMA获取失败`)
      }

      // 获取RSI指标
      try {
        const rsiData = await this.indicatorsHub.getIndicators(symbol, timeframe, 'RSI')
        if (rsiData.values.rsi !== undefined) {
          timeframeData.rsi = rsiData.values.rsi
        }
      } catch (error) {
        logger.info('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} RSI获取失败`)
      }

      // 获取ADX指标
      try {
        const adxData = await this.indicatorsHub.getIndicators(symbol, timeframe, 'ADX')
        if (adxData.values.adxMain !== undefined) {
          timeframeData.adx = adxData.values.adxMain
        }
        if (adxData.values.adxSlope !== undefined) {
          timeframeData.adxSlope = adxData.values.adxSlope
        }
      } catch (error) {
        logger.info('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} ADX获取失败`)
      }

      // 获取ATR指标
      try {
        const atrData = await this.indicatorsHub.getIndicators(symbol, timeframe, 'ATR')
        if (atrData.values.atr !== undefined) {
          timeframeData.atr = atrData.values.atr
        }
      } catch (error) {
        logger.info('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} ATR获取失败`)
      }

      // 获取OI数据
      try {
        const oiData = this.indicatorsHub.getOI(symbol)
        if (oiData) {
          timeframeData.oi = {
            value: oiData.value,
            changePercent: 0, // 暂时设置为0，后续可以添加变化率计算
            trend: 'flat'
          }
        }
      } catch (error) {
        logger.info('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} OI获取失败`)
      }
    } catch (error: any) {
      logger.warn('MultiTimeframeIndicatorCalculator', `${symbol} ${timeframe} 获取部分指标失败: ${error.message}`)
    }

    return timeframeData
  }
}