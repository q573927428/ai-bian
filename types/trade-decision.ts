// ==================== 实际开仓的 AI 决策档案 ====================
import type { AIAnalysis } from './index'

/** 一次真实 AI 请求的冻结副本；只随内部信号传递，准备开仓时才落盘。 */
export interface TradeDecision {
  schemaVersion: 1
  analysisId: string
  requestedAt: number
  completedAt: number
  strategyId: string
  symbol: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  provider: string
  model: string
  /** 实际交给服务端 API 的非敏感请求参数，不保存连接配置或认证信息。 */
  parameters: Record<string, unknown>
  rawResponse: string
  analysis: AIAnalysis
}
