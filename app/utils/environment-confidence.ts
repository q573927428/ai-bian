// ==================== 多周期趋势结构与环境置信度共享规则 ====================
import type { MarketBreadthSnapshot } from '../../types/market-breadth'

export const TREND_PERIODS = ['5m', '15m', '1h', '4h', '1d'] as const
export type TrendPeriod = typeof TREND_PERIODS[number]
export type TrendStrength = '增强' | '持平' | '减弱'
export type DirectionalTrend = `${'多头' | '空头'}${TrendStrength}` | '中性' | '--'
// 保留旧标签类型以读取历史档案，新生成的周期结果统一使用细分标签。
export type PeriodTrend = DirectionalTrend | '方向分歧'
  | `${'多头' | '空头'}双${TrendStrength}`
  | `${'多头' | '空头'}DI${TrendStrength}、MACD${TrendStrength}`
export type PeriodSignals = Partial<Record<TrendPeriod, PeriodTrend>>

/** 按实际主周期选择同向加分参考周期；日线策略不调整。 */
export const ADJACENT_PERIODS: Record<TrendPeriod, readonly TrendPeriod[]> = {
  '5m': ['15m', '1h'], '15m': ['1h'], '1h': ['4h'], '4h': ['1d'], '1d': []
}

/** 整组参考周期均同向才奖励20点结构分，折算最终置信度最多6分；不满足不扣分。 */
export function adjacentPeriodBonus(periods: PeriodSignals, mainTimeframe: TrendPeriod | undefined, side: number): number {
  const reference = mainTimeframe ? ADJACENT_PERIODS[mainTimeframe] : undefined
  if (!reference?.length) return 0
  const prefix = side > 0 ? '多头' : '空头'
  return reference.every(period => periods[period]?.startsWith(prefix)) ? 20 : 0
}

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
  /** 五周期支持分中实际计入的同向奖励，上限20；旧档案允许缺失。 */
  adjacentBonus?: number
  coverage: number
}

/** 本次请求固定快照，包含双方向评分，防止 AI 自由调整分数。 */
export interface EnvironmentContext {
  version: 'environment-v1' | 'environment-v2'
  /** 计算该置信度时使用的策略或看板主周期；历史档案允许缺失。 */
  mainTimeframe?: TrendPeriod
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
export function diTrend(spread: unknown, gapChange: unknown): DirectionalTrend {
  if (!finite(spread) || !finite(gapChange)) return '--'
  if (spread === 0) return '中性'
  return `${spread > 0 ? '多头' : '空头'}${gapChange > 0 ? '增强' : gapChange < 0 ? '减弱' : '持平'}`
}

/** DI 与 MACD 同向时保留两者各自强弱；数值相等为持平，不引入额外容差。 */
export function combinePeriodTrend(trend: DirectionalTrend, current: unknown, previous: unknown): PeriodTrend {
  if (trend === '--' || !finite(current) || !finite(previous)) return '--'
  if (current === 0 || trend === '中性') return '中性'
  const direction = current > 0 ? '多头' : '空头'
  if (!trend.startsWith(direction)) return '方向分歧'
  const di = trend.slice(2) as TrendStrength
  const macd: TrendStrength = current === previous ? '持平'
    : (current - previous) * Math.sign(current) > 0 ? '增强' : '减弱'
  return di === macd ? `${direction}双${di}` : `${direction}DI${di}、MACD${macd}`
}

/** 只有两个指标都增强才是强确认；混合标签不能因末尾“增强”被误判。 */
export function isDoubleStrengthening(trend?: PeriodTrend): boolean {
  return trend === '多头双增强' || trend === '空头双增强'
    || trend === '多头增强' || trend === '空头增强'
}

/** 单周期方向支持分：两个指标各按100/80/60取均值，反向取互补分。 */
export function periodSupport(trend: PeriodTrend, side: number): number | null {
  if (trend === '--') return null
  if (trend === '中性' || trend === '方向分歧') return 50
  const points: Record<TrendStrength, number> = { 增强: 100, 持平: 80, 减弱: 60 }
  const state = trend.slice(2)
  const parts = /^DI(增强|持平|减弱)、MACD(增强|持平|减弱)$/.exec(state)
  // 旧版“减弱”压缩了混合状态；兼容读取仍保留其原80分，不推断不存在的明细。
  const score = parts ? (points[parts[1] as TrendStrength] + points[parts[2] as TrendStrength]) / 2
    : state.startsWith('双') ? points[state.slice(1) as TrendStrength]
    : state === '减弱' ? 80 : points[state as TrendStrength]
  return trend.startsWith(side > 0 ? '多头' : '空头') ? score : 100 - score
}

/** 组合原始 ADX/DI 与 MACD 字段，供服务端和前端共用。 */
export function periodTrend(adx: Record<string, unknown>, macd: Record<string, unknown>): PeriodTrend {
  return combinePeriodTrend(diTrend(adx.diSpread, adx.diGapChange), macd.histogram, macd.previousHistogram)
}

/** 大周期背景、中间承接和短线触发沿用看板原有分类，缺失不伪装为中性。 */
export function classifyTrendStructure(signals: PeriodSignals): TrendStructure {
  const dir = (period: TrendPeriod) => signals[period]?.startsWith('多头') ? '多' : signals[period]?.startsWith('空头') ? '空' : '中'
  const strength = (period: TrendPeriod) => isDoubleStrengthening(signals[period])
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
    return periodSupport(signals[period]!, side)!
  }
  // 短线合计30%、1h承接30%、大周期背景40%，避免只按同向周期数量判断。
  const weights = [10, 20, 30, 20, 20]
  return TREND_PERIODS.reduce((sum, period, index) => sum + support(period) * weights[index]! / 100, 0)
}

/** 固定40/30/30权重；任何关键维度缺失均不可用，不靠剩余维度补分。 */
export function assessEnvironment(
  periods: PeriodSignals, breadth: MarketBreadthSnapshot | undefined, symbol: string,
  side: number, now = Date.now(), mainTimeframe?: TrendPeriod
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
  const baseStructure = structureSupport(periods, side)
  // 奖励放进原有结构分，沿用30%权重；结构分封顶100，缺失不能靠奖励补齐。
  const adjacentBonus = baseStructure === null ? 0 : Math.min(100 - baseStructure, adjacentPeriodBonus(periods, mainTimeframe, side))
  const structure = baseStructure === null ? null : baseStructure + adjacentBonus
  const available = market !== null && structure !== null && relativeStrength !== null
  const coverage = breadth && breadth.selectedCount > 0
    ? Math.round(windows.reduce((sum, window, index) => sum + breadth.periods[window].validCount / breadth.selectedCount * weights[index]!, 0)) : 0
  return {
    available, confidence: available ? Math.round(market! * 0.4 + structure! * 0.3 + relativeStrength! * 0.3) : null,
    market, structure, relativeStrength, adjacentBonus, coverage
  }
}

/** 同一份事实预先计算多空两方向，AI只能选用策略确定方向对应的固定结果。 */
export function buildEnvironmentContext(periods: PeriodSignals, breadth: MarketBreadthSnapshot | undefined, symbol: string, mainTimeframe?: TrendPeriod): EnvironmentContext {
  const now = Date.now()
  return {
    version: 'environment-v2', mainTimeframe, periods, structure: classifyTrendStructure(periods),
    long: assessEnvironment(periods, breadth, symbol, 1, now, mainTimeframe),
    short: assessEnvironment(periods, breadth, symbol, -1, now, mainTimeframe)
  }
}
