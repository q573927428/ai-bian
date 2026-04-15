import type { Position } from '../../../../types'
import { BinanceService } from '../../../utils/binance'
import { logger } from '../../../utils/logger'

/**
 * 等待并确认持仓建立
 */
export async function waitAndConfirmPosition(
  binance: BinanceService,
  symbol: string,
  maxRetries: number = 3,
  delayMs: number = 500
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info('持仓确认', `第${attempt}次尝试确认持仓...`)
      
      // 等待一段时间让订单成交
      await new Promise(resolve => setTimeout(resolve, delayMs))
      
      // 查询交易所实际持仓
      const positions = await binance.fetchPositions(symbol)
      const realPosition = positions.find(p => Math.abs(Number(p.quantity || 0)) > 0)
      
      if (realPosition) {
        logger.success('持仓确认', `检测到实际持仓建立`, {
          symbol: realPosition.symbol,
          direction: realPosition.direction,
          quantity: realPosition.quantity,
          entryPrice: realPosition.entryPrice,
        })
        return true
      } else {
        logger.warn('持仓确认', `第${attempt}次尝试未检测到持仓`)
        
        // 如果是最后一次尝试，返回false
        if (attempt === maxRetries) {
          logger.error('持仓确认', `经过${maxRetries}次尝试仍未检测到持仓`)
          return false
        }
      }
    } catch (error: any) {
      logger.warn('持仓确认', `第${attempt}次尝试查询持仓失败: ${error.message}`)
      
      // 如果是最后一次尝试，抛出错误
      if (attempt === maxRetries) {
        throw new Error(`持仓确认失败: ${error.message}`)
      }
    }
  }
  
  return false
}
