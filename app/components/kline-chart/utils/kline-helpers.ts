/**
 * K线图表辅助函数
 */

import { ColorType } from 'lightweight-charts'
import type { SimpleKLineData } from '../../../../types/kline-simple'

/**
 * 根据时间查找K线数据
 * @param klineData K线数据数组
 * @param time 时间戳（秒）
 * @returns 对应的K线数据或null
 */
export function findKlineByTime(
  klineData: SimpleKLineData[], 
  time: number
): SimpleKLineData | null {
  if (!klineData.length) return null
  
  // 使用二分查找找到最接近的时间
  let left = 0
  let right = klineData.length - 1
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midKline = klineData[mid]
    if (!midKline) return null
    
    const midTime = midKline.t
    
    if (midTime === time) {
      return midKline
    } else if (midTime < time) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  
  // 如果没有精确匹配，返回最接近的数据
  if (right >= 0 && right < klineData.length) {
    const kline = klineData[right]
    return kline || null
  }
  
  return null
}

/**
 * 计算K线的涨跌幅
 * @param kline K线数据
 * @returns 涨跌幅百分比
 */
export function calculateChangePercent(kline: SimpleKLineData): number {
  if (!kline || kline.o === 0) return 0
  return ((kline.c - kline.o) / kline.o) * 100
}

/**
 * 生成客户端ID
 * @returns 唯一的客户端ID字符串
 */
export function generateClientId(): string {
  return `kline_chart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 判断是否为DOGE交易对
 * @param symbol 交易对符号
 * @returns 是否为DOGE交易对
 */
export function isDOGESymbol(symbol: string): boolean {
  const upperSymbol = symbol.toUpperCase()
  // 支持多种格式：DOGEUSDT, DOGE/USDT, DOGE-USD, DOGE等
  return upperSymbol.includes('DOGE') && 
         !upperSymbol.includes('DOGECOIN') && // 排除包含DOGECOIN但不是DOGE的情况
         !upperSymbol.includes('DOGEFI') &&   // 排除DOGEFI等衍生品
         !upperSymbol.includes('DOGEDAO')     // 排除其他DOGE相关但不是DOGE的代币
}

/**
 * 准备K线数据用于图表显示
 * @param klineData 原始K线数据
 * @returns 格式化后的K线数据数组
 */
export function prepareCandlestickData(klineData: SimpleKLineData[]) {
  return klineData.map(item => ({
    time: item.t,
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c
  }))
}

/**
 * 准备成交量数据用于图表显示
 * @param klineData 原始K线数据
 * @returns 格式化后的成交量数据数组
 */
export function prepareVolumeData(klineData: SimpleKLineData[]) {
  return klineData.map(item => {
    const volumeValue = item.v || 0
    return {
      time: item.t,
      value: volumeValue,
      color: item.c >= item.o ? '#26a69a' : '#ef5350'
    }
  })
}

/**
 * 获取图表默认配置
 * @param theme 主题 ('light' | 'dark')
 * @returns 图表配置对象
 */
export function getChartOptions(theme: 'light' | 'dark') {
  return {
    layout: {
      background: { type: ColorType.Solid, color: theme === 'dark' ? '#131722' : '#FFFFFF' },
      textColor: theme === 'dark' ? '#D9D9D9' : '#191919'
    },
    grid: {
      vertLines: { color: theme === 'dark' ? '#2B2B43' : '#F0F3FA' },
      horzLines: { color: theme === 'dark' ? '#2B2B43' : '#F0F3FA' }
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 12,
      borderColor: '#CCCCCC',
      tickMarkFormatter: (time: number) => {
        const date = new Date(time * 1000)
        return date.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      }
    },
    localization: {
      timeFormatter: (time: number) => {
        return new Date(time * 1000).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      }
    },
    rightPriceScale: {
      borderColor: '#CCCCCC',
      textColor: '#333333'
    },
    leftPriceScale: {
      borderColor: '#CCCCCC',
      textColor: '#333333'
    }
  }
}
