import type { BotConfig, BotState } from '../../../../types'
import { PositionStatus } from '../../../../types'
import { shouldResetDailyState, checkDailyTradeLimit } from '../../../utils/risk'
import { logger } from '../../../utils/logger'
import { saveBotConfig, saveBotState, loadBotState, loadBotConfig, getDefaultConfig, getDefaultState, updateTotalStatsInState } from '../../../utils/storage'
import dayjs from 'dayjs'

/**
 * 状态管理器
 */
export class StateManager {
  private config: BotConfig
  private state: BotState

  constructor(config: BotConfig, state: BotState) {
    this.config = config
    this.state = state
  }

  /**
   * 获取配置
   */
  getConfig(): BotConfig {
    return this.config
  }

  /**
   * 获取状态
   */
  getState(): BotState {
    return this.state
  }

  /**
   * 更新配置
   */
  setConfig(config: BotConfig): void {
    this.config = config
  }

  /**
   * 更新状态
   */
  setState(state: BotState): void {
    this.state = state
  }

  /**
   * 初始化状态
   */
  async initialize(): Promise<void> {
    try {
      logger.info('系统', '正在初始化状态管理器...')

      // 加载配置和状态
      const savedConfig = await loadBotConfig()
      const savedState = await loadBotState()

      if (savedConfig) {
        this.config = savedConfig
        logger.info('系统', '已加载保存的配置')
      } else {
        await saveBotConfig(this.config)
        logger.info('系统', '已创建默认配置')
      }

      if (savedState) {
        this.state = savedState
        logger.info('系统', '已加载保存的状态')
      } else {
        await saveBotState(this.state)
        logger.info('系统', '已创建默认状态')
      }

      // 检查是否需要重置每日状态
      if (shouldResetDailyState(this.state.lastResetDate)) {
        await this.resetDailyState()
      }

      // 初始化总统计数据并更新当前状态
      const updatedState = await updateTotalStatsInState()
      if (updatedState) {
        this.state = updatedState
      }

      logger.success('系统', '状态管理器初始化完成')
    } catch (error: any) {
      logger.error('系统', '状态管理器初始化失败', error.message)
      throw error
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(newConfig: Partial<BotConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig }
    await saveBotConfig(this.config)
    
    // 重新评估 allowNewTrades 状态
    const dailyLimitPassed = checkDailyTradeLimit(this.state.todayTrades, this.config.riskConfig)
    this.state.allowNewTrades = dailyLimitPassed
    await saveBotState(this.state)

    logger.success('配置', '配置已更新')
  }

  /**
   * 重置每日状态
   */
  async resetDailyState(): Promise<void> {
    logger.info('系统', '重置每日状态')
    
    // 保存重置前的运行状态
    const wasRunning = this.state.isRunning
    
    // 重置每日交易相关状态
    this.state.todayTrades = 0
    this.state.dailyPnL = 0
    this.state.lastResetDate = dayjs().format('YYYY-MM-DD')
    this.state.allowNewTrades = true  // 重置后允许新交易
    
    // 重置熔断状态
    this.state.circuitBreaker = {
      isTriggered: false,
      reason: '',
      timestamp: Date.now(),
      dailyLoss: 0,
      consecutiveLosses: 0,
    }

    // 如果重置前机器人是停止状态（可能是因为熔断或达到每日交易限制），
    // 重置后自动恢复运行状态
    if (!wasRunning) {
      logger.info('系统', '检测到机器人之前已停止，重置后恢复运行状态')
      this.state.isRunning = true
      this.state.status = PositionStatus.MONITORING
    }

    await saveBotState(this.state)
    logger.success('系统', '每日状态重置完成')
  }
}
