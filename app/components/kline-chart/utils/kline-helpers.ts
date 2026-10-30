/**
 * K线图表辅助函数
 */

import { ColorType, CrosshairMode } from 'lightweight-charts'
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
 * 根据价格数据自动计算图表轴精度和最小价格变动
 * @param priceData 价格数据数组（如收盘价序列），用于判断价格量级
 * @returns { precision, minMove } 精度配置
 */
export function getPricePrecision(priceData: number[]): { precision: number; minMove: number } {
  // 计算有效价格的平均值（排除0值）
  const validPrices = priceData.filter(p => p > 0)
  if (validPrices.length === 0) {
    return { precision: 2, minMove: 0.01 }
  }
  
  // 取平均值来判断价格量级
  const avgPrice = validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length
  
  if (avgPrice >= 1000) {
    return { precision: 2, minMove: 0.01 }
  } else if (avgPrice >= 1) {
    return { precision: 3, minMove: 0.001 }
  } else if (avgPrice >= 0.001) {
    return { precision: 5, minMove: 0.00001 }
  } else {
    return { precision: 8, minMove: 0.00000001 }
  }
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
    crosshair: {
      // 价格随鼠标纵向位置移动，避免默认磁吸模式吸附到 EMA 或 K 线收盘价。
      mode: CrosshairMode.Normal
    },
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
      rightOffset: 30,
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
      textColor: theme === 'dark' ? '#C8C8C8' : '#333333'
    },
    leftPriceScale: {
      borderColor: '#CCCCCC',
      textColor: theme === 'dark' ? '#C8C8C8' : '#333333'
    }
  }
}
