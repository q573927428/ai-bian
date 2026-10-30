// ==================== 多周期趋势结构与环境置信度共享规则 ====================
import type { MarketBreadthSnapshot } from '../../types/market-breadth'

export const TREND_PERIODS = ['5m', '15m', '1h', '4h', '1d'] as const
export type TrendPeriod = typeof TREND_PERIODS[number]
export type PeriodTrend = '多头增强' | '多头减弱' | '空头增强' | '空头减弱' | '中性' | '--'
export type PeriodSignals = Partial<Record<TrendPeriod, PeriodTrend>>

/** 多周期结构标签；看板颜色、筛选和服务端提示词共用这一结果。 */
export interface TrendStructure {
  label: string
  tone: '多头' | '空头' | '反转' | '观望'
}

/** 单方向环境拆解；缺失与中性分开，coverage 不混入环境支持分。 */
export interface EnvironmentAssessment {
  available: boolean
  confidence: number | null
  market: number | null
  structure: number | null
  relativeStrength: number | null
  coverage: number
}

/** 本次请求固定快照，包含双方向评分，防止 AI 自由调整分数。 */
export interface EnvironmentContext {
  version: 'environment-v1'
  periods: PeriodSignals
  structure: TrendStructure
  long: EnvironmentAssessment
  short: EnvironmentAssessment
}

/** 将内部快照转为AI可直接引用的多空结果与分项，最终置信度仍由程序计算。 */
export function formatEnvironmentConfidence(context?: EnvironmentContext): string {
  if (!context) return '置信度结果：LONG做多、SHORT做空均暂无可用分数。'
  const describe = (value: number) => value >= 80 ? '环境明显支持' : value >= 60 ? '环境偏支持' : value >= 40 ? '环境中性或分歧' : value >= 20 ? '环境偏不利' : '环境明显反向'
  // 分项仅为展示保留两位小数，避免浮点噪声；缺失值不能伪装成零分。
  const score = (value: number | null) => finite(value) ? `${Number(value.toFixed(2))}` : '暂无可用分数'
  const direction = (name: string, assessment: EnvironmentAssessment) => assessment.available
    ? `${name}：置信度${assessment.confidence}分，${describe(assessment.confidence!)}。\n\t\t（分项：市场支持${score(assessment.market)}×40% + 五周期支持${score(assessment.structure)}×30% + 相对强弱${score(assessment.relativeStrength)}×30%）`
    : `${name}：暂无可用分数，环境数据不足。市场支持：${score(assessment.market)}；五周期方向支持：${score(assessment.structure)}；相对强弱：${score(assessment.relativeStrength)}。`
  return [
    `五周期结构：${context.structure.label}；${TREND_PERIODS.map(period => `${period} ${context.periods[period] ?? '暂无数据'}`).join('，')}。`,
    direction('LONG做多', context.long), direction('SHORT做空', context.short)
  ].join('\n')
}

/** 仅有限原始数值有效，null 和 undefined 不能隐式变成零。 */
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** DI 当前优势侧配合绝对差距变化；与是否收盘无关。 */
export function diTrend(spread: unknown, gapChange: unknown): PeriodTrend {
  if (!finite(spread) || !finite(gapChange)) return '--'
  if (spread === 0 || gapChange === 0) return '中性'
  return `${spread > 0 ? '多头' : '空头'}${gapChange > 0 ? '增强' : '减弱'}`
}

/** 复用看板语义：DI 与 MACD 同向才保留方向，未双增强统一称为减弱。 */
export function combinePeriodTrend(trend: PeriodTrend, current: unknown, previous: unknown): PeriodTrend {
  if (trend === '--' || !finite(current) || !finite(previous)) return '--'
  if (current === 0) return '中性'
  const direction = current > 0 ? '多头' : '空头'
  if (!trend.startsWith(direction)) return '中性'
  const stronger = current > 0 ? current > previous : current < previous
  return `${direction}${trend.endsWith('增强') && stronger ? '增强' : '减弱'}`
}

/** 组合原始 ADX/DI 与 MACD 字段，供服务端和前端共用。 */
export function periodTrend(adx: Record<string, unknown>, macd: Record<string, unknown>): PeriodTrend {
  return combinePeriodTrend(diTrend(adx.diSpread, adx.diGapChange), macd.histogram, macd.previousHistogram)
}

/** 大周期背景、中间承接和短线触发沿用看板原有分类，缺失不伪装为中性。 */
export function classifyTrendStructure(signals: PeriodSignals): TrendStructure {
  const dir = (period: TrendPeriod) => signals[period]?.startsWith('多头') ? '多' : signals[period]?.startsWith('空头') ? '空' : '中'
  const strength = (period: TrendPeriod) => signals[period]?.endsWith('增强')
  const bg = [dir('1d'), dir('4h')]; const mid = dir('1h'); const short = [dir('15m'), dir('5m')]
  if (TREND_PERIODS.some(period => signals[period] == null || signals[period] === '--')) return { label: '数据不足观望', tone: '观望' }
  if (bg.includes('中') && bg.some(item => item !== '中') && mid !== '中' && short[0] === mid && short[1] === mid) {
    return { label: `${mid === '多' ? '多头' : '空头'}承接观察`, tone: mid === '多' ? '多头' : '空头' }
  }
  if (bg[0] !== bg[1]) return { label: '大周期分歧', tone: '观望' }
  if (bg[0] === '中') return { label: '中性背景观望', tone: '观望' }
  const background = bg[0]; const text = background === '多' ? '多头' : '空头'
  if (mid === '中' || short.includes('中')) return { label: `${text}背景分歧`, tone: '观望' }
  if (mid === background && short[0] === background && short[1] === background) return { label: `${text}趋势延续`, tone: background === '多' ? '多头' : '空头' }
  if (mid === background && short[0] !== background && short[1] !== background) {
    return { label: `${text}${!strength('5m') && !strength('15m') ? '短线回调' : '反转观察'}`, tone: '反转' }
  }
  if (mid !== background && short[0] === mid && short[1] === mid) return { label: `${mid === '多' ? '多头' : '空头'}承接观察`, tone: mid === '多' ? '多头' : '空头' }
  return { label: `${text}背景分歧`, tone: '观望' }
}

/** 市场占比和中位数必须一致；所有占比都以有效样本（含持平）为分母。 */
function marketSupport(stats: MarketBreadthSnapshot['periods']['5m'], side: number): number | null {
  if (!finite(stats.validCount) || stats.validCount <= 0 || !finite(stats.medianChangePct)) return null
  const favorable = (side > 0 ? stats.upCount : stats.downCount) / stats.validCount * 100
  const adverse = (side > 0 ? stats.downCount : stats.upCount) / stats.validCount * 100
  const median = stats.medianChangePct * side
  if (median > 0 && favorable >= 65) return 100
  if (median > 0 && favorable >= 55) return 75
  if (median < 0 && adverse >= 65) return 0
  if (median < 0 && adverse >= 55) return 25
  return 50
}

/** 个币在同窗口有效市场样本中的中秩百分位；全体持平时为50，不假装领先。 */
function relativeRank(stats: MarketBreadthSnapshot['periods']['5m'], symbol: string, side: number): number | null {
  const own = stats.changes[symbol]
  const sample = Object.values(stats.changes).filter(finite)
  if (!finite(own) || sample.length < 2) return null
  const others = sample.length - 1
  const less = sample.filter(value => value < own).length
  const equalOthers = sample.filter(value => value === own).length - 1
  const rank = 100 * (less + equalOthers / 2) / others
  return side > 0 ? rank : 100 - rank
}

/** 统一按五周期方向支持度计算；回调或反转是否可入场由策略规则判断。 */
function structureSupport(signals: PeriodSignals, side: number): number | null {
  if (TREND_PERIODS.some(period => !signals[period] || signals[period] === '--')) return null
  const support = (period: TrendPeriod) => {
    const trend = signals[period]!
    if (trend === '中性') return 50
    const aligned = trend.startsWith(side > 0 ? '多头' : '空头')
    // “减弱”沿用看板的未双增强语义，仅小幅折减支持或缓和反向压力。
    const strengthening = trend.endsWith('增强')
    return aligned ? strengthening ? 100 : 80 : strengthening ? 0 : 20
  }
  // 短线合计30%、1h承接30%、大周期背景40%，避免只按同向周期数量判断。
  const weights = [10, 20, 30, 20, 20]
  return TREND_PERIODS.reduce((sum, period, index) => sum + support(period) * weights[index]! / 100, 0)
}

/** 固定40/30/30权重；任何关键维度缺失均不可用，不靠剩余维度补分。 */
export function assessEnvironment(
  periods: PeriodSignals, breadth: MarketBreadthSnapshot | undefined, symbol: string,
  side: number, now = Date.now()
): EnvironmentAssessment {
  const validBreadth = breadth && now < breadth.expiresAt && breadth.computedAt <= now
  const windows = ['5m', '15m', '1h', '4h', '24h'] as const
  // 短中周期为主，滚动24h提供背景；缺失时不重新分配权重。
  const weights = [10, 20, 30, 25, 15] as const
  const marketValues = windows.map(window => validBreadth ? marketSupport(breadth.periods[window], side) : null)
  const relativeValues = windows.map(window => validBreadth ? relativeRank(breadth.periods[window], symbol.replace('/', '').toUpperCase(), side) : null)
  const average = (values: (number | null)[]) => values.every(finite)
    ? values.reduce<number>((sum, value, index) => sum + value! * weights[index]! / 100, 0) : null
  const market = average(marketValues)
  const relativeStrength = average(relativeValues)
  const structure = structureSupport(periods, side)
  const available = market !== null && structure !== null && relativeStrength !== null
  const coverage = breadth && breadth.selectedCount > 0
    ? Math.round(windows.reduce((sum, window, index) => sum + breadth.periods[window].validCount / breadth.selectedCount * weights[index]!, 0)) : 0
  return {
    available, confidence: available ? Math.round(market! * 0.4 + structure! * 0.3 + relativeStrength! * 0.3) : null,
    market, structure, relativeStrength, coverage
  }
}

/** 同一份事实预先计算多空两方向，AI只能选用策略确定方向对应的固定结果。 */
export function buildEnvironmentContext(periods: PeriodSignals, breadth: MarketBreadthSnapshot | undefined, symbol: string): EnvironmentContext {
  const now = Date.now()
  return {
    version: 'environment-v1', periods, structure: classifyTrendStructure(periods),
    long: assessEnvironment(periods, breadth, symbol, 1, now),
    short: assessEnvironment(periods, breadth, symbol, -1, now)
  }
}
