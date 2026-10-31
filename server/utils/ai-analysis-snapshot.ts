// ==================== AI 分析量化复算快照 ====================
import type { AIAnalysis, TechnicalIndicators } from '../../types'
import type { AIPromptConfig, Strategy } from '../../types/strategy'
import { hashAIRules } from './ai-rules-store.ts'
import { getCandleVolume } from './candle-volume.ts'

/** 捕获实际发送的规则与输入；白名单排除 AI 连接配置、密钥和运行统计。 */
export function createStrategySnapshot(strategy: Strategy | null | undefined, promptConfig: AIPromptConfig): NonNullable<AIAnalysis['strategySnapshot']> {
  // 在请求发出前深拷贝，避免等待 AI 时策略被修改而污染历史规则。
  return JSON.parse(JSON.stringify({
    schemaVersion: 5,
    capturedAt: Date.now(),
    version: strategy?.version,
    updatedAt: strategy?.updatedAt,
    rulesHash: hashAIRules(promptConfig.userPrompt),
    riskManagement: strategy?.riskManagement,
    minConfidence: strategy?.minConfidence,
    minFinalScore: strategy?.minFinalScore,
    entryThresholdMode: strategy?.entryThresholdMode,
    maxRiskLevel: strategy?.maxRiskLevel
  }))
}

/** 使用提示词相同的成交量口径；缺失及非有限值保存为 null，避免被当成零。 */
export function createQuantitativeSnapshot(indicators: TechnicalIndicators, volume: number, candleProgress: number) {
  const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  const candleVolume = getCandleVolume(indicators, volume, candleProgress)
  const currentVolume = finite(candleVolume.currentCandleVolume)
  const progress = finite(candleVolume.progress)
  const estimatedVolume = currentVolume === null || progress === null ? null : finite(candleVolume.estimatedVolume)
  const ema = finite(indicators.volumeEmaAverage)
  const ratio = estimatedVolume !== null && ema !== null && ema > 0 ? finite(estimatedVolume / ema) : null
  return {
    pdi: finite(indicators.pdi), mdi: finite(indicators.mdi),
    previousPdi: finite(indicators.previousPdi), previousMdi: finite(indicators.previousMdi),
    diSpread: finite(indicators.diSpread), diGapChange: finite(indicators.diGapChange),
    atr: finite(indicators.atr),
    // 保留实际传入 AI 的 ER 数值、缺失状态及来源时间，不能在复盘时重算覆盖。
    er: indicators.enabledIndicators?.er ? indicators.er?.map(snapshot => ({ ...snapshot })) : undefined,
    candleTimestamp: finite(indicators.lastCandle?.timestamp),
    candleProgress: finite(candleProgress),
    snapshotTimestamp: finite(indicators.snapshotTimestamp),
    volumeTimeframe: indicators.volumeTimeframe,
    volumeCandleTimestamp: finite(indicators.volumeCandleTimestamp ?? indicators.lastCandle?.timestamp),
    volumeCandleProgress: progress,
    currentCandleVolume: currentVolume,
    estimatedVolume,
    volumeEmaAverage: ema,
    volumeEmaPeriod: finite(indicators.volumeEmaPeriod),
    // 百分数可由倍数乘100得到，避免在每条历史里重复保存。
    estimatedVolumeEmaRatio: ratio
  }
}
