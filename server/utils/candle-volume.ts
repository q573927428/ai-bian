// ==================== 成交量快照与整根K线预估 ====================
import type { TechnicalIndicators } from '../../types'

/** 使用成交量自身的周期与进度，供AI提示词、信号及复算记录共用。 */
export function getCandleVolume(indicators: TechnicalIndicators, volume: number, candleProgress: number) {
  // 主周期K线只负责价格行为；独立成交量周期不能借用它的成交量或进度。
  const currentCandleVolume = indicators.volumeCurrent ?? indicators.lastCandle?.volume ?? volume
  const progress = indicators.volumeCandleProgress ?? candleProgress
  const estimatedVolume = progress > 0 ? currentCandleVolume / progress : currentCandleVolume
  return { currentCandleVolume, estimatedVolume, progress }
}
