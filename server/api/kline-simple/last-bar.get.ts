import { getSimpleKLineData } from '../../utils/kline-simple-storage'
import type { KLineTimeframe } from '../../../types/kline-simple'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { symbol, timeframe } = query

  if (!symbol || !timeframe) {
    return { success: false, message: '缺少必需参数: symbol 和 timeframe' }
  }

  const validTimeframes = ['5m', '15m', '1h', '4h', '1d', '1w']
  if (!validTimeframes.includes(timeframe as string)) {
    return { success: false, message: `无效的timeframe: ${timeframe}` }
  }

  try {
    // 获取最后1条K线数据
    const klineData = getSimpleKLineData(symbol as string, timeframe as KLineTimeframe, { limit: 1 })

    if (klineData.length === 0) {
      return { success: false, message: '没有K线数据' }
    }

    return {
      success: true,
      data: klineData[0]
    }
  } catch (error: any) {
    console.error(`获取最后一根K线失败: ${symbol}/${timeframe}`, error)
    return { success: false, message: `获取失败: ${error.message}` }
  }
})
