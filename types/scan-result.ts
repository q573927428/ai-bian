// ==================== 历史扫描结果类型 ====================

/**
 * 单条策略扫描结果
 *
 * 用于把日志中的扫描时间、策略判断和完整详情映射到对应 K 线。
 */
export interface StrategyScanResult {
  timestamp: number
  klineTime: number
  strategyId: string
  timeframe: string
  symbol: string
  level: string
  summary: string
  detail: string
  skipped: boolean
  direction: 'LONG' | 'SHORT' | 'IDLE' | null
  price: number | null
  confidence: number | null
  minConfidence: number | null
  score: number | null
  riskLevel: string | null
}

/**
 * 历史扫描结果 API 响应
 */
export interface ScanResultApiResponse {
  success: boolean
  message?: string
  data?: {
    symbol: string
    timeframe: string
    strategyId: string
    results: StrategyScanResult[]
    count: number
  }
}
