// ==================== AI预筛短路机制 ====================

import { logger } from './logger'

/**
 * 预筛配置
 */
export interface PreScreenConfig {
  // ADX阈值（趋势强度）
  minAdx?: number // 默认 15
  maxAdx?: number // 默认 60
  
  // ATR阈值（波动率）
  minAtrPercent?: number // 默认 0.001 (0.1%)
  maxAtrPercent?: number // 默认 0.05 (5%)
  
  // 成交量阈值
  minVolumeRatio?: number // 默认 0.5 (至少是前一根K线的50%)
  
  // 启用/禁用特定筛选项
  enableAdx?: boolean
  enableAtr?: boolean
  enableVolume?: boolean
}

/**
 * 预筛输入数据
 */
export interface PreScreenInput {
  symbol: string
  strategyId: string
  
  // ADX相关
  adx?: number
  
  // ATR相关
  atr?: number
  currentPrice?: number
  
  // 成交量相关
  currentVolume?: number
  prevVolume?: number
}

/**
 * 预筛结果
 */
export interface PreScreenResult {
  passed: boolean
  reason?: string
  checks: {
    adx?: { passed: boolean; value?: number; threshold?: string }
    atr?: { passed: boolean; value?: number; threshold?: string }
    volume?: { passed: boolean; value?: number; threshold?: string }
  }
}

/**
 * 默认预筛配置（兜底，与 storage.ts 中的 getDefaultBotConfig 保持一致）
 */
export const PRESCREEN_DEFAULTS: Required<PreScreenConfig> = {
  minAdx: 15,
  maxAdx: 60,
  minAtrPercent: 0.001,
  maxAtrPercent: 0.05,
  minVolumeRatio: 0.5,
  enableAdx: true,
  enableAtr: true,
  enableVolume: true
}

/**
 * AI预筛器
 *
 * 在调用AI前进行轻量级本地规则筛选，减少不必要的AI调用。
 * 配置从 BotConfig.preScreenConfig 加载，不再硬编码。
 */
export class AIPreScreener {
  private config: PreScreenConfig = { ...PRESCREEN_DEFAULTS }
  private stats = {
    totalChecks: 0,
    passedChecks: 0,
    skippedChecks: 0,
    reasons: new Map<string, number>()
  }

  /**
   * 从 BotConfig.preScreenConfig 初始化/更新预筛配置
   * @param preScreenConfig BotConfig 中的 preScreenConfig 字段
   */
  initFromBotConfig(preScreenConfig?: PreScreenConfig): void {
    this.config = { ...PRESCREEN_DEFAULTS, ...preScreenConfig }
    logger.info('AIPreScreener', 'AI预筛配置已加载', {
      minAdx: this.config.minAdx,
      maxAdx: this.config.maxAdx,
      minAtrPercent: this.config.minAtrPercent,
      maxAtrPercent: this.config.maxAtrPercent,
      minVolumeRatio: this.config.minVolumeRatio,
      enableAdx: this.config.enableAdx,
      enableAtr: this.config.enableAtr,
      enableVolume: this.config.enableVolume
    })
  }

  /**
   * 执行预筛
   */
  screen(input: PreScreenInput): PreScreenResult {
    this.stats.totalChecks++

    const checks: PreScreenResult['checks'] = {}
    let passed = true
    let failReason: string | undefined

    // ADX检查
    if (this.config.enableAdx && input.adx !== undefined) {
      const adxCheck = this.checkAdx(input.adx)
      checks.adx = adxCheck
      if (!adxCheck.passed) {
        passed = false
        failReason = `ADX不满足: ${input.adx.toFixed(2)} 不在 [${this.config.minAdx}, ${this.config.maxAdx}] 范围内`
      }
    }

    // ATR检查
    if (passed && this.config.enableAtr && input.atr !== undefined && input.currentPrice !== undefined) {
      const atrCheck = this.checkAtr(input.atr, input.currentPrice)
      checks.atr = atrCheck
      if (!atrCheck.passed) {
        passed = false
        failReason = `ATR不满足: ${(input.atr / input.currentPrice * 100).toFixed(3)}% 不在 [${(this.config.minAtrPercent! * 100).toFixed(2)}%, ${(this.config.maxAtrPercent! * 100).toFixed(2)}%] 范围内`
      }
    }

    // 成交量检查
    if (passed && this.config.enableVolume && input.currentVolume !== undefined && input.prevVolume !== undefined) {
      const volumeCheck = this.checkVolume(input.currentVolume, input.prevVolume)
      checks.volume = volumeCheck
      if (!volumeCheck.passed) {
        passed = false
        failReason = `成交量不满足: 当前 ${input.currentVolume.toFixed(2)} / 前一根 ${input.prevVolume.toFixed(2)} = ${(input.currentVolume / input.prevVolume * 100).toFixed(1)}% < ${(this.config.minVolumeRatio! * 100)}%`
      }
    }

    // 更新统计
    if (passed) {
      this.stats.passedChecks++
    } else {
      this.stats.skippedChecks++
      if (failReason) {
        const key = failReason.split(':')[0]!
        this.stats.reasons.set(key, (this.stats.reasons.get(key) || 0) + 1)
      }
    }

    // 记录日志
    if (!passed) {
      logger.info('扫描结果', `${input.symbol} 预筛跳过: ${failReason} [${input.strategyId}]`)
    }

    return {
      passed,
      reason: failReason,
      checks
    }
  }

  /**
   * ADX检查
   */
  private checkAdx(adx: number): { passed: boolean; value: number; threshold: string } {
    const minAdx = this.config.minAdx!
    const maxAdx = this.config.maxAdx!
    const passed = adx >= minAdx && adx <= maxAdx
    return {
      passed,
      value: adx,
      threshold: `[${minAdx}, ${maxAdx}]`
    }
  }

  /**
   * ATR检查
   */
  private checkAtr(atr: number, currentPrice: number): { passed: boolean; value: number; threshold: string } {
    const atrPercent = atr / currentPrice
    const minAtrPercent = this.config.minAtrPercent!
    const maxAtrPercent = this.config.maxAtrPercent!
    const passed = atrPercent >= minAtrPercent && atrPercent <= maxAtrPercent
    return {
      passed,
      value: atrPercent,
      threshold: `[${(minAtrPercent * 100).toFixed(2)}%, ${(maxAtrPercent * 100).toFixed(2)}%]`
    }
  }

  /**
   * 成交量检查
   */
  private checkVolume(currentVolume: number, prevVolume: number): { passed: boolean; value: number; threshold: string } {
    const ratio = prevVolume > 0 ? currentVolume / prevVolume : 0
    const minVolumeRatio = this.config.minVolumeRatio!
    const passed = ratio >= minVolumeRatio
    return {
      passed,
      value: ratio,
      threshold: `>= ${(minVolumeRatio * 100)}%`
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      passRate: this.stats.totalChecks > 0
        ? (this.stats.passedChecks / this.stats.totalChecks * 100).toFixed(1) + '%'
        : '0%',
      skipRate: this.stats.totalChecks > 0
        ? (this.stats.skippedChecks / this.stats.totalChecks * 100).toFixed(1) + '%'
        : '0%',
      reasonStats: Object.fromEntries(this.stats.reasons)
    }
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      passedChecks: 0,
      skippedChecks: 0,
      reasons: new Map()
    }
  }
}

// 单例实例
export const aiPreScreener = new AIPreScreener()