// ==================== 每日熔断状态与跨日重置 ====================

import type { BotState, StrategyDailyLossBreaker, StrategyDailyRiskState } from '../../../types'
import { logger } from '../../utils/logger'

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/** 与每日开仓次数使用相同的北京时间自然日，不受服务器所在时区影响。 */
export function getRiskDayKey(timestamp: number): string {
  const parts = dayFormatter.formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** 初始化单个策略的当日统计，不能把其他策略的盈亏带入本策略的限额判断。 */
export function getStrategyDailyRiskState(state: BotState, strategyId: string): StrategyDailyRiskState {
  state.strategyDailyRisk ??= {}
  return state.strategyDailyRisk[strategyId] ??= {
    dailyPnL: 0,
    circuitBreaker: { isTriggered: false, reason: '', timestamp: 0, dailyLoss: 0 }
  }
}

/** 每日亏损上限以 USDT 固定金额计，旧配置缺失或非法时使用 10 USDT。 */
export function getStrategyDailyLossLimit(maxDailyLoss: unknown): number {
  return typeof maxDailyLoss === 'number' && Number.isFinite(maxDailyLoss) && maxDailyLoss > 0
    ? maxDailyLoss
    : 10
}

/**
 * 按策略的 maxDailyLoss 固定金额评估当日净亏损，不受账户余额波动影响。
 * 已触发的门禁持续到次日，不因后续盈利提前解除。
 */
export function checkStrategyDailyLoss(
  state: BotState,
  strategyId: string,
  maxDailyLoss: unknown,
  now = Date.now()
): StrategyDailyLossBreaker {
  resetDailyRiskState(state, now)
  const risk = getStrategyDailyRiskState(state, strategyId)
  const previousBreaker = risk.circuitBreaker
  const limit = getStrategyDailyLossLimit(maxDailyLoss)
  // 盈利不消耗亏损额度；只累计本策略当日已经平仓的净盈亏。
  const dailyLoss = Math.max(0, -risk.dailyPnL)
  const breaker: StrategyDailyLossBreaker = {
    isTriggered: dailyLoss >= limit,
    reason: '',
    timestamp: now,
    dailyLoss
  }
  if (previousBreaker.isTriggered) {
    breaker.isTriggered = true
    breaker.reason = previousBreaker.reason
    breaker.timestamp = previousBreaker.timestamp
  } else if (breaker.isTriggered) {
    breaker.reason = `策略 ${strategyId} 当日净亏损达到 ${dailyLoss.toFixed(2)} USDT（上限 ${limit} USDT），今日禁止继续开仓`
    logger.warn('策略每日亏损限制', breaker.reason)
  }
  risk.circuitBreaker = breaker
  return breaker
}

/**
 * 同步切换每日风控窗口，返回是否发生跨日重置。
 * 开仓门禁和平仓结算共用此方法，避免并发检查重复清空新一天已经产生的统计。
 */
export function resetDailyRiskState(state: BotState, now = Date.now()): boolean {
  const today = getRiskDayKey(now)

  if (!state.riskDayKey) {
    // 缺少日期时仅依据各策略门禁的时间推断统计日，没有时间记录则视为当日。
    const referenceTime = Math.max(
      0,
      ...Object.values(state.strategyDailyRisk ?? {}).map(risk => risk.circuitBreaker.timestamp || 0)
    )
    state.riskDayKey = referenceTime > 0 ? getRiskDayKey(referenceTime) : today
  }

  // 时钟短暂回拨时也不能再次清空同一天的风险统计。
  if (state.riskDayKey >= today) return false

  state.riskDayKey = today
  state.strategyDailyRisk = {}
  // 只解除开仓门禁；策略是否运行由引擎的实例状态管理，不能自动启动手动停止的策略。
  logger.info('每日风控重置', `北京时间 ${today}，已重置各策略的每日亏损门禁和盈亏统计`)
  return true
}
