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

  // OI 变化率带符号区间（百分数，例如 -0.1 表示 -0.1%）
  minOiChangePercent?: number // 默认 0.2%
  maxOiChangePercent?: number // 默认 50%

  // 成交量预估模式：使用成交量对应周期的K线进度，与AI相同快照的EMA比较
  // 解决未收盘K线成交量偏低的问题
  minEstimatedVolumeRatio?: number // 默认 0.3 (预估成交量至少是成交量EMA的30%)

  // K线完成进度阈值：低于此进度时跳过成交量检查（数据太少不可靠）
  minCandleProgressForVolume?: number // 默认 0.1 (10%)

  // 启用/禁用特定筛选项
  enableAdx?: boolean
  enableAdxSlope?: boolean
  enableAtr?: boolean
  enableOi?: boolean
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

  // OI相关
  oiChangePercent?: number

  // 成交量相关
  currentVolume?: number
  volumeEmaAverage?: number // 与AI共用同一成交量周期和快照的EMA，包含当前K线快照值
  candleProgress?: number // 成交量对应K线在市场快照时刻的完成进度 0-1
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
    oi?: { passed: boolean; value?: number; threshold?: string }
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
  minOiChangePercent: 0.2,
  maxOiChangePercent: 50,
  minEstimatedVolumeRatio: 0.3,
  minCandleProgressForVolume: 0.1,
  enableAdx: true,
  enableAdxSlope: true,
  enableAtr: true,
  enableOi: true,
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

    // 保留 OI 变化方向，按照策略配置的带符号区间进行预筛。
    if (passed && cfg.enableOi && input.oiChangePercent !== undefined) {
      const oiCheck = this.checkOi(input.oiChangePercent, cfg)
      checks.oi = oiCheck
      if (!oiCheck.passed) {
        passed = false
        failReason = `OI不满足: 变化率 ${input.oiChangePercent.toFixed(2)}% 不在 [${cfg.minOiChangePercent}%, ${cfg.maxOiChangePercent}%] 范围内`
      }
    }

    // 成交量检查（支持预估模式，解决未收盘K线成交量偏低的问题）
    if (passed && cfg.enableVolume && input.currentVolume !== undefined) {
      const volumeCheck = this.checkVolume(
        input.currentVolume,
        cfg,
        input.volumeEmaAverage,
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
    // if (!passed) {
    //   logger.info('🔍扫描结果', `${input.symbol} 预筛跳过: ${failReason} [${input.strategyId}]`)
    // }

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
   * OI 变化率检查
   *
   * 直接使用带符号变化率判定，允许策略通过负数阈值控制可接受的 OI 降幅。
   */
  private checkOi(oiChangePercent: number, cfg: Required<PreScreenConfig>): { passed: boolean; value: number; threshold: string } {
    const minOiChangePercent = cfg.minOiChangePercent
    const maxOiChangePercent = cfg.maxOiChangePercent
    const passed = oiChangePercent >= minOiChangePercent && oiChangePercent <= maxOiChangePercent
    return {
      passed,
      value: oiChangePercent,
      threshold: `[${minOiChangePercent}%, ${maxOiChangePercent}%]`
    }
  }

  /**
   * 成交量检查（预估模式）
   *
   * 基于成交量对应周期的进度预估整根K线成交量，与AI使用的成交量EMA比较。
   * 解决未收盘K线成交量偏低的问题。
   *
   * 逻辑：
   * 1. 进度和EMA必须有效，数据缺失时拒绝，避免静默绕过量能门槛
   * 2. 若 candleProgress < minCandleProgressForVolume，跳过（数据太少不可靠）
   * 3. 否则：estimatedVolume = currentVolume / candleProgress，与 volumeEmaAverage 比较
   */
  private checkVolume(
    currentVolume: number,
    cfg: Required<PreScreenConfig>,
    volumeEmaAverage?: number,
    candleProgress?: number
  ): { passed: boolean; value: number; threshold: string; reason?: string } {
    // 不以零值或缺失数据放行；周期刚开始的有效零进度仍由下方进度门槛处理。
    if (!Number.isFinite(currentVolume) || currentVolume < 0
      || candleProgress === undefined || !Number.isFinite(candleProgress) || candleProgress < 0 || candleProgress > 1
      || volumeEmaAverage === undefined || !Number.isFinite(volumeEmaAverage) || volumeEmaAverage <= 0) {
      return {
        passed: false,
        value: 0,
        threshold: '需要有效的K线进度和成交量EMA',
        reason: '成交量数据不足: 缺少有效的K线进度或成交量EMA'
      }
    }

    const minProgress = cfg.minCandleProgressForVolume!

    // 进度太低，跳过检查（数据太少，预估不可靠）
    if (candleProgress === 0 || candleProgress < minProgress) {
      return {
        passed: true,
        value: 0,
        threshold: `跳过(进度${(candleProgress * 100).toFixed(1)}% < ${(minProgress * 100).toFixed(0)}%)`,
        reason: undefined
      }
    }

    // 预估整根K线成交量
    const estimatedVolume = currentVolume / candleProgress
    const estimatedRatio = estimatedVolume / volumeEmaAverage
    const minEstimatedRatio = cfg.minEstimatedVolumeRatio!

    const passed = estimatedRatio >= minEstimatedRatio
    return {
      passed,
      value: estimatedRatio,
      threshold: `预估成交量/成交量EMA >= ${(minEstimatedRatio * 100).toFixed(0)}%`,
      reason: passed
        ? undefined
        : `成交量预估不足: 当前${currentVolume.toFixed(2)} 进度${(candleProgress * 100).toFixed(1)}% 预估${estimatedVolume.toFixed(2)} / 成交量EMA${volumeEmaAverage.toFixed(2)} = ${(estimatedRatio * 100).toFixed(1)}% < ${(minEstimatedRatio * 100).toFixed(0)}%`
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
