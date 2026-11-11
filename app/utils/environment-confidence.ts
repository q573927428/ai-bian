// ==================== 多周期趋势结构与环境置信度共享规则 ====================
import type { BreadthAssetCategory, MarketBreadthSnapshot } from '../../types/market-breadth'
import type { TechnicalIndicators } from '../../types'
import { selectBreadthForSymbol, BREADTH_CATEGORY_LABELS } from './market-breadth.ts'

/** 社区置信度修正结果；记录原分、修正值及原因，供分析快照复算。 */
export interface CommunityConfidenceAdjustment {
  version: 'community-v1' | 'community-v2'
  baseConfidence: number | null
  adjustment: number
  finalConfidence: number | null
  reason: string
  directionalCount: number
  coveragePercent: number
  dataUpdatedAt?: number
}

export const TREND_PERIODS = ['5m', '15m', '1h', '4h', '1d'] as const
export type TrendPeriod = typeof TREND_PERIODS[number]
export type TrendStrength = '增强' | '持平' | '减弱'
export type DirectionalTrend = `${'多头' | '空头'}${TrendStrength}` | '中性' | '--'
// 保留旧标签类型以读取历史档案，新生成的周期结果统一使用细分标签。
export type PeriodTrend = DirectionalTrend | '方向分歧'
  | `${'多头' | '空头'}双${TrendStrength}`
  | `${'多头' | '空头'}DI${TrendStrength}、MACD${TrendStrength}`
export type PeriodSignals = Partial<Record<TrendPeriod, PeriodTrend>>

/** 记录滚动24h市场家数共识及扣分；与个币日线指标无关。 */
export interface MarketBreadthAdjustment {
  state: '强势普涨' | '偏多' | '方向不明确' | '偏空' | '强势普跌'
  adjustment: number
  upPercent: number
  downPercent: number
}

/** 档位互斥：逆势扣5/8分，无方向共识多空均扣3分；持平计入分母。 */
export function marketBreadthAdjustment(stats: MarketBreadthSnapshot['periods']['24h'], side: number): MarketBreadthAdjustment | null {
  const { validCount, upCount, downCount, flatCount } = stats
  if (![validCount, upCount, downCount, flatCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || validCount === 0 || upCount + downCount + flatCount !== validCount) return null
  const upPercent = upCount / validCount * 100
  const downPercent = downCount / validCount * 100
  // 整数比较确保65%和80%边界不受浮点误差影响；每次只命中一个档位。
  const direction = upCount * 100 >= validCount * 65 ? 1 : downCount * 100 >= validCount * 65 ? -1 : 0
  const strong = Math.max(upCount, downCount) * 100 >= validCount * 80
  const state = direction > 0 ? strong ? '强势普涨' : '偏多' : direction < 0 ? strong ? '强势普跌' : '偏空' : '方向不明确'
  return { state, adjustment: direction === 0 ? -3 : direction === side ? 0 : strong ? -8 : -5, upPercent, downPercent }
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
  /** 仅兼容历史档案的相邻周期奖励，新计算不再使用。 */
  adjacentBonus?: number
  /** 24h市场家数共识的独立修正；历史档案允许缺失。 */
  marketBreadthAdjustment?: MarketBreadthAdjustment
  coverage: number
  /** 仅策略启用社区情绪时存在；confidence 为修正后的开仓门槛值。 */
  communityAdjustment?: CommunityConfidenceAdjustment
}

/** 本次请求固定快照，包含双方向评分，防止 AI 自由调整分数。 */
export interface EnvironmentContext {
  version: 'environment-v1' | 'environment-v2' | 'environment-v3' | 'environment-v4' | 'environment-v5' | 'environment-v6'
  /** 记录本次比较的资产组和已选同类样本数，便于复盘小样本与缺失问题。 */
  marketScope?: { category: BreadthAssetCategory; selectedCount: number }
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
  const community = (assessment: EnvironmentAssessment) => assessment.communityAdjustment
    ? `（社区情绪修正${assessment.communityAdjustment.adjustment > 0 ? '+' : ''}${score(assessment.communityAdjustment.adjustment)}）`
    : ''
  const breadth = (assessment: EnvironmentAssessment) => assessment.marketBreadthAdjustment
    ? `（24h市场${assessment.marketBreadthAdjustment.state}，广度修正${score(assessment.marketBreadthAdjustment.adjustment)}）`
    : ''
  const direction = (name: string, assessment: EnvironmentAssessment) => assessment.available
    ? `${name}：置信度${assessment.confidence}分，${describe(assessment.confidence!)}${breadth(assessment)}${community(assessment)}。\n\t（分项：市场支持${score(assessment.market)}×30% + 五周期支持${score(assessment.structure)}×40% + 相对强弱${score(assessment.relativeStrength)}×30%）`
    : `${name}：暂无可用分数，环境数据不足。市场支持：${score(assessment.market)}；五周期方向支持：${score(assessment.structure)}；相对强弱：${score(assessment.relativeStrength)}。`
  return [
    ...(context.marketScope ? [`市场比较范围：${BREADTH_CATEGORY_LABELS[context.marketScope.category]}，已选同类${context.marketScope.selectedCount}个交易对。`] : []),
    `五周期结构：${context.structure.label}；${TREND_PERIODS.map(period => `${period} ${context.periods[period] ?? '暂无数据'}`).join('，')}。`,
    direction('LONG做多', context.long), direction('SHORT做空', context.short)
  ].join('\n')
}

/** 按交易方向修正最多±3分；缺失环境不能补齐，关闭开关时完全沿用原结果。 */
export function applyCommunityConfidence(
  context: EnvironmentContext | undefined, indicators: Partial<TechnicalIndicators>, now = Date.now()
): EnvironmentContext | undefined {
  if (!context || !indicators.enabledIndicators?.squareHeat) return context
  const bullish = indicators.squareHeatBullishCount
  const bearish = indicators.squareHeatBearishCount
  const total = indicators.squareHeatPostCount
  const updatedAt = indicators.squareHeatDataUpdatedAt
  const validCount = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0
  const valid = validCount(bullish) && validCount(bearish)
    && validCount(total) && bullish + bearish <= total
  const count = valid ? bullish! + bearish! : 0
  // 从原始计数复算覆盖率和净情绪，避免派生字段的取整误差或异常数据放大修正。
  const coverage = valid && total! > 0 ? count / total! : 0
  let reason = '社区多空均衡'
  let delta = 0
  if (!valid || !finite(updatedAt) || updatedAt <= 0 || updatedAt > now) reason = '社区数据不可用'
  else if (now - updatedAt > 30 * 60 * 1000) reason = '社区数据已过期'
  else if (count === 0) reason = '无明确方向样本'
  else {
    // 用整数比较精确划分10%/30%/60%边界，避免浮点误差导致临界值落入错误档位。
    const difference = bullish! - bearish!
    const strength = Math.abs(difference) * 100
    const tier = strength < count * 10 ? 0 : strength < count * 30 ? 1 : strength < count * 60 ? 2 : 3
    // 小样本也可有限参与：1~2帖最多1分，3~9帖最多2分，10帖起最多3分。
    // 覆盖率仅记录，不再与样本数量重复衰减修正。
    const sampleCap = count <= 2 ? 1 : count <= 9 ? 2 : 3
    delta = Math.sign(difference) * Math.min(tier, sampleCap)
    reason = `${bullish! > bearish! ? '社区偏多' : bullish! < bearish! ? '社区偏空' : '社区多空均衡'}；方向样本${count}帖，覆盖率${(coverage * 100).toFixed(2)}%`
  }
  const adjust = (assessment: EnvironmentAssessment, side: number): EnvironmentAssessment => {
    // 使用环境三个原始分项，只在社区修正后统一取整；无效社区数据保持旧置信度。
    // 从未取整分项复算并保留广度扣分，防止启用社区情绪后覆盖市场风险修正。
    const base = assessment.available ? assessment.market! * 0.3 + assessment.structure! * 0.4 + assessment.relativeStrength! * 0.3
      + (assessment.marketBreadthAdjustment?.adjustment ?? 0) : null
    const adjustment = assessment.available ? delta * side : 0
    const confidence = base === null ? assessment.confidence : Math.round(Math.max(0, Math.min(100, base + adjustment)))
    return {
      ...assessment, confidence,
      communityAdjustment: {
        version: 'community-v2', baseConfidence: base, adjustment, finalConfidence: confidence,
        reason: assessment.available ? reason : '环境数据不足，不进行社区修正',
        directionalCount: count, coveragePercent: coverage * 100,
        dataUpdatedAt: finite(updatedAt) ? updatedAt : undefined
      }
    }
  }
  return { ...context, long: adjust(context.long, 1), short: adjust(context.short, -1) }
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

/** 按涨跌家数差连续评分；持平计入有效分母，不再使用中位数确认或分档。 */
function marketSupport(stats: MarketBreadthSnapshot['periods']['5m'], side: number): number | null {
  const { validCount, upCount, downCount, flatCount } = stats
  // 异常或缺失计数不能伪装成中性分。
  if (![validCount, upCount, downCount, flatCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || validCount === 0 || upCount + downCount + flatCount !== validCount) return null
  // 以50为中性起点保持多空对称；合法家数天然保证分数在0～100之间。
  const shortScore = 50 + 50 * (downCount - upCount) / validCount
  return side > 0 ? 100 - shortScore : shortScore
}

/** 同窗口归一化排名明细，分数与提示词共用；名次按表现从高到低，同值并列。 */
export interface RelativeStrengthRanking {
  position: number
  sampleCount: number
  tiedCount: number
  longScore: number
  shortScore: number
}

/** 按ATR归一化表现计算中秩百分位；无ATR样本排除，不与原始涨跌幅混排。 */
export function relativeStrengthRanking(stats: MarketBreadthSnapshot['periods']['5m'], symbol: string): RelativeStrengthRanking | null {
  const normalized = stats.normalizedChanges ?? {}
  const own = finite(stats.changes[symbol]) ? normalized[symbol] : null
  const sample = Object.entries(normalized).filter(([key, value]) => finite(stats.changes[key]) && finite(value)).map(([, value]) => value as number)
  if (!finite(own) || sample.length < 2) return null
  const others = sample.length - 1
  const less = sample.filter(value => value < own).length
  const equalOthers = sample.filter(value => value === own).length - 1
  const rank = 100 * (less + equalOthers / 2) / others
  return { position: sample.filter(value => value > own).length + 1, sampleCount: sample.length,
    tiedCount: equalOthers + 1, longScore: rank, shortScore: 100 - rank }
}

/** 原始排名保持不变，仅将环境评分向中性50分收缩，降低极端排名的影响。 */
function relativeRank(stats: MarketBreadthSnapshot['periods']['5m'], symbol: string, side: number): number | null {
  const ranking = relativeStrengthRanking(stats, symbol)
  // 保留原排名70%的差异，适度减弱极端排名；多空仍互补，范围为15～85，缺失不补齐。
  if (!ranking) return null
  const rawScore = side > 0 ? ranking.longScore : ranking.shortScore
  return rawScore * 0.7 + 50 * 0.3
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

/** 固定30/40/30权重；任何关键维度缺失均不可用，不靠剩余维度补分。 */
export function assessEnvironment(
  periods: PeriodSignals, snapshot: MarketBreadthSnapshot | undefined, symbol: string,
  side: number, now = Date.now(), mainTimeframe: TrendPeriod = '15m'
): EnvironmentAssessment {
  const breadth = selectBreadthForSymbol(snapshot, symbol)
  const validBreadth = breadth && now < breadth.expiresAt && breadth.computedAt <= now
  const windows = ['5m', '15m', '1h', '4h', '24h'] as const
  // 短中周期为主，滚动24h提供背景；缺失时不重新分配权重。
  const weights = [10, 20, 30, 25, 15] as const
  const marketValues = windows.map(window => validBreadth ? marketSupport(breadth.periods[window], side) : null)
  const average = (values: (number | null)[]) => values.every(finite)
    ? values.reduce<number>((sum, value, index) => sum + value! * weights[index]! / 100, 0) : null
  const market = average(marketValues)
  // 相对强弱只取交易主周期；日线对应滚动24h，缺失不借用其他窗口补分。
  const relativeWindow = mainTimeframe === '1d' ? '24h' : mainTimeframe
  const relativeStrength = validBreadth
    ? relativeRank(breadth.periods[relativeWindow], symbol.replace('/', '').trim().toUpperCase(), side) : null
  const structure = structureSupport(periods, side)
  const breadthAdjustment = validBreadth ? marketBreadthAdjustment(breadth.periods['24h'], side) : null
  const available = market !== null && structure !== null && relativeStrength !== null && breadthAdjustment !== null
  const coverage = breadth && breadth.selectedCount > 0
    ? Math.round(windows.reduce((sum, window, index) => sum + breadth.periods[window].validCount / breadth.selectedCount * weights[index]!, 0)) : 0
  return {
    available, confidence: available ? Math.round(Math.max(0, Math.min(100,
      market! * 0.3 + structure! * 0.4 + relativeStrength! * 0.3 + breadthAdjustment!.adjustment))) : null,
    market, structure, relativeStrength, marketBreadthAdjustment: breadthAdjustment ?? undefined, coverage
  }
}

/** 同一份事实预先计算多空两方向，AI只能选用策略确定方向对应的固定结果。 */
export function buildEnvironmentContext(periods: PeriodSignals, breadth: MarketBreadthSnapshot | undefined, symbol: string, mainTimeframe: TrendPeriod = '15m'): EnvironmentContext {
  const now = Date.now()
  const scoped = selectBreadthForSymbol(breadth, symbol)
  return {
    version: 'environment-v6', mainTimeframe, periods, structure: classifyTrendStructure(periods),
    marketScope: { category: scoped?.assetCategory ?? 'unknown', selectedCount: scoped?.selectedCount ?? 0 },
    long: assessEnvironment(periods, scoped, symbol, 1, now, mainTimeframe),
    short: assessEnvironment(periods, scoped, symbol, -1, now, mainTimeframe)
  }
}
