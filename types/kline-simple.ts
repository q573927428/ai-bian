// 简单K线数据类型定义

// 支持的K线周期
export type KLineTimeframe = '15m' | '1h' | '4h' | '1d' | '1w'

// K线数据条目（简化字段名）
export interface SimpleKLineData {
  t: number      // timestamp 时间戳（秒）
  o: number      // open 开盘价
  h: number      // high 最高价
  l: number      // low 最低价
  c: number      // close 收盘价
  v: number      // volume 成交量
}

// 完整的K线数据条目（用于内部处理）
export interface KLineData {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// 单文件K线数据格式
export interface KLineSingleFile {
  symbol: string
  timeframe: KLineTimeframe
  data: SimpleKLineData[]  // 最多11000条
  meta: {
    first: number      // 第一条数据时间戳
    last: number       // 最后一条数据时间戳
    count: number      // 当前数据条数
    max: number        // 最大数据条数（11000）
    updated: number    // 最后更新时间戳
  }
}

// API请求参数
export interface KLineQueryParams {
  symbol: string
  timeframe: KLineTimeframe
  limit?: number      // 限制数量
  from?: number      // 开始时间戳
  to?: number        // 结束时间戳
}

// API响应
export interface KLineApiResponse {
  success: boolean
  message?: string
  data?: {
    symbol: string
    timeframe: KLineTimeframe
    data: SimpleKLineData[]
    meta: {
      first: number
      last: number
      count: number
      max: number
      updated: number
    }
  }
}

// 周期同步配置
export interface TimeframeSyncConfig {
  timeframe: KLineTimeframe
  syncInterval: number     // 该周期的同步间隔（秒）
  enabled: boolean         // 是否启用该周期的同步
}

// 同步配置
export interface KLineSyncConfig {
  symbols: string[]
  timeframes: KLineTimeframe[]
  maxBars: number          // 最大K线数量（11000）
  syncInterval: number     // 全局同步间隔（秒）- 向后兼容
  timeframeConfigs?: TimeframeSyncConfig[] // 每个周期的独立配置
}

// 默认配置
export const DEFAULT_CONFIG: KLineSyncConfig = {
  symbols: ['BTC/USDT', 'ETH/USDT'],
  timeframes: ['15m', '1h', '4h', '1d', '1w'],
  maxBars: 11000,
  syncInterval: 600, // 按周期调度，此值不再使用，但保留用于API兼容性
  timeframeConfigs: [
    { timeframe: '15m', syncInterval: 600, enabled: true },   // ✅ 10分钟
    { timeframe: '1h',  syncInterval: 1800, enabled: true },  // ✅ 30分钟
    { timeframe: '4h',  syncInterval: 3600, enabled: true },  // ✅ 1小时
    { timeframe: '1d',  syncInterval: 14400, enabled: true },  // ✅ 2小时
    { timeframe: '1w',  syncInterval: 43200, enabled: true }  // ✅ 12小时
  ]
}

// 工具函数：转换完整数据到简化数据
export function toSimpleKLineData(data: KLineData): SimpleKLineData {
  return {
    t: data.timestamp,
    o: data.open,
    h: data.high,
    l: data.low,
    c: data.close,
    v: data.volume
  }
}

// 工具函数：转换简化数据到完整数据
export function fromSimpleKLineData(data: SimpleKLineData): KLineData {
  return {
    timestamp: data.t,
    open: data.o,
    high: data.h,
    low: data.l,
    close: data.c,
    volume: data.v
  }
}

// 工具函数：批量转换
export function toSimpleKLineDataArray(data: KLineData[]): SimpleKLineData[] {
  return data.map(toSimpleKLineData)
}

export function fromSimpleKLineDataArray(data: SimpleKLineData[]): KLineData[] {
  return data.map(fromSimpleKLineData)
}