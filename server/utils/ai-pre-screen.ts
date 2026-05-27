// ==================== AI预筛短路机制 ====================

import { logger } from './logger'

/**
 * 预筛配置
 */
export interface PreScreenConfig {
  // ADX阈值（趋势强度）
  minAdx?: number // 默认 15
  maxAdx?: number // 默认 60

  // ADX斜率阈值（趋势方向）
  minAdxSlope?: number // 默认 0 (ADX斜率 > 0)

  // ATR阈值（波动率）
  minAtrPercent?: number // 默认 0.0038 (0.38%)
  maxAtrPercent?: number // 默认 0.05 (5%)

  // 成交量预估模式：基于K线完成进度预估整根K线成交量后与历史均值比较
  // 解决未收盘K线成交量偏低的问题
  minEstimatedVolumeRatio?: number // 默认 0.3 (预估成交量至少是历史均值的30%)

  // K线完成进度阈值：低于此进度时跳过成交量检查（数据太少不可靠）
  minCandleProgressForVolume?: number // 默认 0.1 (10%)

  // 启用/禁用特定筛选项
  enableAdx?: boolean
  enableAdxSlope?: boolean
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
  adxSlope?: number // ADX斜率（当前ADX - 前一根ADX）
  adxPeriod?: number // ADX计算周期，默认14
  adxTimeframe?: string // ADX的K线周期，如 "15m"、"1h"

  // ATR相关
  atr?: number
  currentPrice?: number

  // 成交量相关
  currentVolume?: number
  prevVolume?: number
  volumeAverage?: number // 过去N根K线的平均成交量（用于预估模式）
  candleProgress?: number // 当前K线完成进度 0-1（由 StrategyEngine 实时计算，拿不到时用 BotConfig.defaultCandleProgress 兜底）
}

/**
 * 预筛结果
 */
export interface PreScreenResult {
  passed: boolean
  reason?: string
  checks: {
    adx?: { passed: boolean; value?: number; threshold?: string }
    adxSlope?: { passed: boolean; value?: number; threshold?: string }
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
  minAdxSlope: 0,
  minAtrPercent: 0.002,
  maxAtrPercent: 0.05,
  minEstimatedVolumeRatio: 0.3,
  minCandleProgressForVolume: 0.1,
  enableAdx: true,
  enableAdxSlope: true,
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
    // logger.info('AIPreScreener', 'AI预筛配置已加载', {
    //   minAdx: this.config.minAdx,
    //   maxAdx: this.config.maxAdx,
    //   minAdxSlope: this.config.minAdxSlope,
    //   minAtrPercent: this.config.minAtrPercent,
    //   maxAtrPercent: this.config.maxAtrPercent,
    //   minEstimatedVolumeRatio: this.config.minEstimatedVolumeRatio,
    //   minCandleProgressForVolume: this.config.minCandleProgressForVolume,
    //   enableAdx: this.config.enableAdx,
    //   enableAdxSlope: this.config.enableAdxSlope,
    //   enableAtr: this.config.enableAtr,
    //   enableVolume: this.config.enableVolume
    // })
  }

  /**
   * 执行预筛
   */
  /**
   * 执行预筛
   * @param input 预筛输入数据
   * @param overrides 策略级阈值覆盖（优先级高于全局配置）
   */
  screen(input: PreScreenInput, overrides?: PreScreenConfig): PreScreenResult {
    // 合并全局配置与策略级覆盖（用默认值填充缺失字段）
    const cfg: Required<PreScreenConfig> = overrides
      ? { ...PRESCREEN_DEFAULTS, ...this.config, ...overrides }
      : { ...PRESCREEN_DEFAULTS, ...this.config }

    this.stats.totalChecks++

    const checks: PreScreenResult['checks'] = {}
    let passed = true
    let failReason: string | undefined

    // ADX检查
    if (cfg.enableAdx && input.adx !== undefined) {
      const adxCheck = this.checkAdx(input.adx, cfg)
      checks.adx = adxCheck
      if (!adxCheck.passed) {
        const adxTimeframe = input.adxTimeframe ?? '15m'
        passed = false
        failReason = `ADX不满足(${adxTimeframe}) : ${input.adx.toFixed(1)} 不在 [${cfg.minAdx}, ${cfg.maxAdx}] 范围内`
      }
    }

    // ADX斜率检查
    if (passed && cfg.enableAdxSlope && input.adxSlope !== undefined) {
      const adxSlopeCheck = this.checkAdxSlope(input.adxSlope, cfg)
      checks.adxSlope = adxSlopeCheck
      if (!adxSlopeCheck.passed) {
        const adxTimeframe = input.adxTimeframe ?? '15m'
        passed = false
        failReason = `ADX斜率不满足(${adxTimeframe}) : ${input.adxSlope.toFixed(4)} <= ${cfg.minAdxSlope}`
      }
    }

    // ATR检查
    if (passed && cfg.enableAtr && input.atr !== undefined && input.currentPrice !== undefined) {
      const atrCheck = this.checkAtr(input.atr, input.currentPrice, cfg)
      checks.atr = atrCheck
      if (!atrCheck.passed) {
        passed = false
        failReason = `ATR不满足: ${(input.atr / input.currentPrice * 100).toFixed(3)}% 不在 [${(cfg.minAtrPercent! * 100).toFixed(2)}%, ${(cfg.maxAtrPercent! * 100).toFixed(2)}%] 范围内`
      }
    }

    // 成交量检查（支持预估模式，解决未收盘K线成交量偏低的问题）
    if (passed && cfg.enableVolume && input.currentVolume !== undefined && input.prevVolume !== undefined) {
      const volumeCheck = this.checkVolume(
        input.currentVolume,
        input.prevVolume,
        cfg,
        input.volumeAverage,
        input.candleProgress
      )
      checks.volume = volumeCheck
      if (!volumeCheck.passed) {
        passed = false
        failReason = volumeCheck.reason || `成交量不满足`
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
  private checkAdx(adx: number, cfg: Required<PreScreenConfig>): { passed: boolean; value: number; threshold: string } {
    const minAdx = cfg.minAdx!
    const maxAdx = cfg.maxAdx!
    const passed = adx >= minAdx && adx <= maxAdx
    return {
      passed,
      value: adx,
      threshold: `[${minAdx}, ${maxAdx}]`
    }
  }

  /**
   * ADX斜率检查
   */
  private checkAdxSlope(adxSlope: number, cfg: Required<PreScreenConfig>): { passed: boolean; value: number; threshold: string } {
    const minAdxSlope = cfg.minAdxSlope!
    const passed = adxSlope > minAdxSlope
    return {
      passed,
      value: adxSlope,
      threshold: `> ${minAdxSlope}`
    }
  }

  /**
   * ATR检查
   */
  private checkAtr(atr: number, currentPrice: number, cfg: Required<PreScreenConfig>): { passed: boolean; value: number; threshold: string } {
    const atrPercent = atr / currentPrice
    const minAtrPercent = cfg.minAtrPercent!
    const maxAtrPercent = cfg.maxAtrPercent!
    const passed = atrPercent >= minAtrPercent && atrPercent <= maxAtrPercent
    return {
      passed,
      value: atrPercent,
      threshold: `[${(minAtrPercent * 100).toFixed(2)}%, ${(maxAtrPercent * 100).toFixed(2)}%]`
    }
  }

  /**
   * 成交量检查（预估模式）
   *
   * 基于K线完成进度预估整根K线成交量，与历史均值比较。
   * 解决未收盘K线成交量偏低的问题。
   *
   * 逻辑：
   * 1. 必须有 candleProgress 和 volumeAverage 才能检查
   * 2. 若 candleProgress < minCandleProgressForVolume，跳过（数据太少不可靠）
   * 3. 否则：estimatedVolume = currentVolume / candleProgress，与 volumeAverage 比较
   */
  private checkVolume(
    currentVolume: number,
    _prevVolume: number,
    cfg: Required<PreScreenConfig>,
    volumeAverage?: number,
    candleProgress?: number
  ): { passed: boolean; value: number; threshold: string; reason?: string } {
    // 缺少必要数据时跳过检查
    if (candleProgress === undefined || candleProgress <= 0 || volumeAverage === undefined || volumeAverage <= 0) {
      return {
        passed: true,
        value: 0,
        threshold: '跳过(缺少进度或历史均值数据)',
        reason: undefined
      }
    }

    const minProgress = cfg.minCandleProgressForVolume!

    // 进度太低，跳过检查（数据太少，预估不可靠）
    if (candleProgress < minProgress) {
      return {
        passed: true,
        value: 0,
        threshold: `跳过(进度${(candleProgress * 100).toFixed(1)}% < ${(minProgress * 100).toFixed(0)}%)`,
        reason: undefined
      }
    }

    // 预估整根K线成交量
    const estimatedVolume = currentVolume / candleProgress
    const estimatedRatio = estimatedVolume / volumeAverage
    const minEstimatedRatio = cfg.minEstimatedVolumeRatio!

    const passed = estimatedRatio >= minEstimatedRatio
    return {
      passed,
      value: estimatedRatio,
      threshold: `预估成交量/历史均值 >= ${(minEstimatedRatio * 100).toFixed(0)}%`,
      reason: passed
        ? undefined
        : `成交量预估不足: 当前${currentVolume.toFixed(2)} 进度${(candleProgress * 100).toFixed(1)}% 预估${estimatedVolume.toFixed(2)} / 历史均值${volumeAverage.toFixed(2)} = ${(estimatedRatio * 100).toFixed(1)}% < ${(minEstimatedRatio * 100).toFixed(0)}%`
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