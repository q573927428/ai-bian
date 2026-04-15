/**
 * K线图表格式化工具函数
 */

/**
 * 格式化时间戳为可读字符串
 * @param timestamp 时间戳（秒）
 * @returns 格式化后的时间字符串
 */
export function formatTime(timestamp: number): string {
  if (!timestamp) return '--'
  
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 格式化价格
 * @param price 价格
 * @param isDOGESymbol 是否为DOGE交易对（需要更多小数位）
 * @returns 格式化后的价格字符串
 */
export function formatPrice(price: number, isDOGESymbol: boolean = false): string {
  if (!price) return '--'
  const precision = isDOGESymbol ? 3 : 2
  return price.toFixed(precision)
}

/**
 * 格式化成交量
 * @param volume 成交量
 * @returns 格式化后的成交量字符串
 */
export function formatVolume(volume: number): string {
  if (!volume) return '--'
  if (volume >= 1000000) {
    return (volume / 1000000).toFixed(2) + 'M'
  } else if (volume >= 1000) {
    return (volume / 1000).toFixed(2) + 'K'
  }
  return volume.toFixed(2)
}

/**
 * 格式化百分比
 * @param percent 百分比
 * @returns 格式化后的百分比字符串
 */
export function formatPercent(percent: number): string {
  if (!percent) return '--'
  return (percent > 0 ? '+' : '') + percent.toFixed(2) + '%'
}

/**
 * 获取时间段的秒数
 * @param timeframe 时间段字符串
 * @returns 对应的秒数
 */
export function getTimeframeSeconds(timeframe: string): number {
  switch (timeframe) {
    case '15m': return 15 * 60
    case '1h': return 60 * 60
    case '4h': return 4 * 60 * 60
    case '1d': return 24 * 60 * 60
    case '1w': return 7 * 24 * 60 * 60
    default: return 60 * 60
  }
}

/**
 * 将时间戳对齐到K线时间
 * @param timestamp 时间戳（毫秒）
 * @param timeframe 时间段
 * @returns 对齐后的时间戳（秒）
 */
export function alignToKlineTime(timestamp: number, timeframe: string): number {
  const timeframeSeconds = getTimeframeSeconds(timeframe)
  return Math.floor(timestamp / 1000 / timeframeSeconds) * timeframeSeconds
}