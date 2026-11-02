// ==================== 多周期结构、方向支持度与置信度边界测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { getCandleVolume } from '../server/utils/candle-volume.ts'
import { shortHash } from '../server/utils/stable-hash.ts'
import { TREND_PERIODS, diTrend, combinePeriodTrend, periodTrend, periodSupport, isDoubleStrengthening, classifyTrendStructure, buildEnvironmentContext, formatEnvironmentConfidence, adjacentPeriodBonus, applyCommunityConfidence } from '../app/utils/environment-confidence.ts'

const all = signal => Object.fromEntries(TREND_PERIODS.map(period => [period, signal]))

/** 固定68分环境，避免社区修正被环境分的上下限遮蔽。 */
function communityFixture(overrides = {}) {
  const assessment = { available: true, confidence: 68, market: 68, structure: 68, relativeStrength: 68, coverage: 100 }
  return {
    context: { version: 'environment-v2', periods: {}, structure: { label: '测试', tone: '观望' }, long: { ...assessment }, short: { ...assessment } },
    indicators: {
      enabledIndicators: { squareHeat: true }, squareHeatBullishCount: 30, squareHeatBearishCount: 10,
      squareHeatPostCount: 200, squareHeatDataUpdatedAt: 10000000, ...overrides
    }, now: 10000000
  }
}

test('社区情绪按多空方向修正、最多±3分，保留原分和版本且不修改输入', () => {
  const { context, indicators, now } = communityFixture()
  const result = applyCommunityConfidence(context, indicators, now)
  assert.equal(result.long.confidence, 70)
  assert.equal(result.short.confidence, 66)
  assert.equal(result.long.communityAdjustment.adjustment, 2)
  assert.equal(result.short.communityAdjustment.adjustment, -2)
  assert.equal(result.long.communityAdjustment.baseConfidence, 68)
  assert.equal(result.long.communityAdjustment.version, 'community-v2')
  assert.equal(context.long.confidence, 68)
  assert.equal(context.long.communityAdjustment, undefined)
  assert.match(formatEnvironmentConfidence(result), /LONG做多：置信度70分，环境偏支持（社区情绪修正\+2）。/)
  assert.match(formatEnvironmentConfidence(result), /SHORT做空：置信度66分，环境偏支持（社区情绪修正-2）。/)
  assert.doesNotMatch(formatEnvironmentConfidence(result), /环境原分|方向样本|覆盖率|最终置信度/)
  for (const [bullish, bearish, long, short] of [[40, 0, 71, 65], [0, 40, 65, 71], [20, 20, 68, 68]]) {
    const output = applyCommunityConfidence(context, { ...indicators, squareHeatBullishCount: bullish, squareHeatBearishCount: bearish }, now)
    assert.equal(output.long.confidence, long)
    assert.equal(output.short.confidence, short)
  }
})

test('无样本、失效和异常数据不修正，关闭开关保持原结果', () => {
  const { context, indicators, now } = communityFixture()
  for (const [overrides, reason] of [
    [{ squareHeatBullishCount: 0, squareHeatBearishCount: 0, squareHeatPostCount: 0 }, '无明确方向样本'],
    [{ squareHeatDataUpdatedAt: now - 1800001 }, '已过期'],
    [{ squareHeatDataUpdatedAt: now + 1 }, '不可用'],
    [{ squareHeatDataUpdatedAt: undefined }, '不可用'],
    [{ squareHeatBullishCount: undefined }, '不可用'],
    [{ squareHeatBullishCount: NaN }, '不可用'],
    [{ squareHeatBearishCount: -1 }, '不可用'],
    [{ squareHeatBullishCount: 10.5 }, '不可用'],
    [{ squareHeatPostCount: 39 }, '不可用']
  ]) {
    const output = applyCommunityConfidence(context, { ...indicators, ...overrides }, now)
    assert.equal(output.long.confidence, 68)
    assert.equal(output.short.confidence, 68)
    assert.equal(output.long.communityAdjustment.adjustment, 0)
    assert.match(output.long.communityAdjustment.reason, new RegExp(reason))
  }
  assert.equal(applyCommunityConfidence(context, { ...indicators, enabledIndicators: { squareHeat: false } }, now), context)
  assert.equal(applyCommunityConfidence(undefined, indicators, now), undefined)
  const boundary = applyCommunityConfidence(context, { ...indicators, squareHeatDataUpdatedAt: now - 1800000 }, now)
  assert.equal(boundary.long.confidence, 70)
})

test('情绪分档与样本上限覆盖边界、实际案例和反向修正', () => {
  const { context, indicators, now } = communityFixture()
  const cases = [
    [0, 0, 0], [1, 0, 1], [2, 0, 1], [3, 0, 2], [9, 0, 2], [10, 0, 3],
    [1, 1, 0], [10, 10, 0], [10, 9, 0],
    [11, 9, 1], [12, 8, 1], [13, 7, 2], [15, 5, 2], [16, 4, 3],
    [6, 1, 2], [9, 4, 2], [12, 9, 1], [13, 6, 2], [30, 11, 2], [22, 0, 3],
    [4, 2, 2], [7, 4, 1], [3, 1, 2], [5, 1, 2]
  ]
  for (const [bullish, bearish, expected] of cases) {
    for (const side of [1, -1]) {
      const output = applyCommunityConfidence(context, { ...indicators,
        squareHeatBullishCount: side > 0 ? bullish : bearish,
        squareHeatBearishCount: side > 0 ? bearish : bullish
      }, now)
      const delta = expected * side
      assert.equal(output.long.confidence, 68 + delta)
      assert.equal(output.short.confidence, 68 - delta)
      assert.equal(Math.abs(output.long.communityAdjustment.adjustment), expected)
    }
  }
})

test('覆盖率和热度变化不再衰减或放大修正，最终分仍统一取整', () => {
  const { context, indicators, now } = communityFixture()
  for (const total of [40, 400, 4000]) {
    const output = applyCommunityConfidence(context, { ...indicators,
      squareHeatPostCount: total, squareHeat: 9999, squareHeatChangePercent: 9999
    }, now)
    assert.equal(output.long.communityAdjustment.adjustment, 2)
    assert.equal(output.long.confidence, 70)
  }
  context.long.market = context.long.structure = context.long.relativeStrength = 68.4
  const output = applyCommunityConfidence(context, indicators, now)
  assert.equal(output.long.confidence, 70)
})

test('环境不足不能靠情绪补分，最终分上下限有效且分析器使用修正结果', async () => {
  const { context, indicators, now } = communityFixture({ squareHeatBullishCount: 40, squareHeatBearishCount: 0 })
  context.long.market = context.long.structure = context.long.relativeStrength = 100
  context.short.market = context.short.structure = context.short.relativeStrength = 0
  let output = applyCommunityConfidence(context, indicators, now)
  assert.equal(output.long.confidence, 100)
  assert.equal(output.short.confidence, 0)
  const normal = communityFixture()
  output = applyCommunityConfidence(normal.context, normal.indicators, normal.now)
  const fixture = analyzerFixture()
  const long = await fixture.call(output)
  assert.equal(long.confidence, 70)
  assert.equal(long.environmentContext.long.communityAdjustment.adjustment, 2)
  fixture.respond({ direction: 'SHORT', confidence: 100 })
  assert.equal((await fixture.call(output)).confidence, 66)
  context.long.available = false
  context.long.confidence = null
  context.long.market = null
  output = applyCommunityConfidence(context, indicators, now)
  assert.equal(output.long.available, false)
  assert.equal(output.long.confidence, null)
  assert.equal(output.long.communityAdjustment.adjustment, 0)
  fixture.respond({ direction: 'LONG' })
  assert.equal((await fixture.call(output)).direction, 'IDLE')
})

test('完整分析链路使用社区修正后的置信度，开关与反向数据隔离分析缓存', async () => {
  const { context, indicators } = communityFixture({ squareHeatDataUpdatedAt: Date.now() })
  const fixture = analyzerFixture()
  const long = await fixture.analyze(context, indicators)
  assert.ok(long)
  assert.equal(long.confidence, 70)
  assert.equal(long.environmentContext.long.communityAdjustment.finalConfidence, 70)
  assert.equal(long.environmentContext.long.communityAdjustment.adjustment, 2)
  assert.match(long.decisionSnapshot.messages[1].content, /置信度70分，环境偏支持（社区情绪修正\+2）。/)
  const contrary = await fixture.analyze(context, { ...indicators, squareHeatBullishCount: 10, squareHeatBearishCount: 30 })
  assert.equal(contrary.confidence, 66)
  assert.equal(contrary.environmentContext.long.communityAdjustment.adjustment, -2)
  const disabled = await fixture.analyze(context, { ...indicators, enabledIndicators: { squareHeat: false } })
  assert.equal(disabled.confidence, 68)
  assert.equal(disabled.indicators.communitySentiment, undefined)
  assert.equal(long.environmentContext.long.communityAdjustment.finalConfidence, 70)
})

/** 同一市场快照包含强势、弱势与持平币，避免仅有单币时伪造排名。 */
function breadth() {
  return {
    selectedCount: 10, computedAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
    periods: Object.fromEntries(['5m', '15m', '1h', '4h', '24h'].map(period => [period, {
      validCount: 10, upCount: 7, downCount: 2, flatCount: 1, missingCount: 0,
      medianChangePct: 1, changes: { BTCUSDT: 5, A: 4, B: 3, C: 2, D: 1.5, E: 1, F: 0.5, G: 0, H: -1, I: -2 }
    }]))
  }
}

test('DI/MACD同向保留细分强弱，持平、方向分歧、中性和缺失分开', () => {
  assert.equal(periodTrend({ diSpread: 1, diGapChange: 0.1 }, { histogram: 2, previousHistogram: 1 }), '多头双增强')
  assert.equal(combinePeriodTrend('多头增强', 2, 2), '多头DI增强、MACD持平')
  assert.equal(combinePeriodTrend('多头增强', -2, -1), '方向分歧')
  assert.equal(combinePeriodTrend('空头增强', -2, -1), '空头双增强')
  assert.equal(combinePeriodTrend('多头增强', undefined, 1), '--')
  assert.equal(periodTrend({ diSpread: null, diGapChange: 1 }, { histogram: 1, previousHistogram: 0 }), '--')
  assert.equal(diTrend(2, 0), '多头持平')
  assert.equal(diTrend(-2, 0), '空头持平')
  assert.equal(diTrend(0, 1), '中性')
  assert.equal(combinePeriodTrend('中性', 1, 0), '中性')
  assert.equal(combinePeriodTrend('多头增强', 0, 1), '中性')
  assert.equal(combinePeriodTrend('多头增强', NaN, 1), '--')
  assert.equal(combinePeriodTrend('多头增强', 1, Infinity), '--')
})

test('多空九种强弱组合及互补评分完整覆盖，持平不丢失原有方向', () => {
  const states = ['增强', '持平', '减弱']
  const scores = [[100, 90, 80], [90, 80, 70], [80, 70, 60]]
  for (const [direction, sign] of [['多头', 1], ['空头', -1]]) {
    for (const [i, di] of states.entries()) for (const [j, macd] of states.entries()) {
      const previous = sign * (macd === '增强' ? 1 : macd === '持平' ? 2 : 3)
      const trend = periodTrend({ diSpread: sign * 5, diGapChange: di === '增强' ? 1 : di === '持平' ? 0 : -1 },
        { histogram: sign * 2, previousHistogram: previous })
      assert.equal(trend, di === macd ? `${direction}双${di}` : `${direction}DI${di}、MACD${macd}`)
      assert.equal(periodSupport(trend, sign), scores[i][j])
      assert.equal(periodSupport(trend, -sign), 100 - scores[i][j])
      const context = buildEnvironmentContext(all(trend), breadth(), 'BTCUSDT')
      assert.equal(context.version, 'environment-v2')
      assert.equal(sign > 0 ? context.long.structure : context.short.structure, scores[i][j])
      assert.equal(context.long.confidence, Math.round(70 + context.long.structure * 0.3))
      assert.ok(formatEnvironmentConfidence(context).includes(`5m ${trend}`))
    }
  }
  assert.equal(periodSupport('方向分歧', 1), 50)
  assert.equal(periodSupport('中性', -1), 50)
  assert.equal(periodSupport('--', 1), null)
})

test('结构分类仅将双增强视为强确认，混合状态不因末尾增强变为反转观察', () => {
  const signals = { ...all('多头双增强'), '5m': '空头DI减弱、MACD增强', '15m': '空头双持平' }
  assert.equal(classifyTrendStructure(signals).label, '多头短线回调')
  signals['5m'] = '空头双增强'
  assert.equal(classifyTrendStructure(signals).label, '多头反转观察')
  assert.equal(isDoubleStrengthening('空头DI减弱、MACD增强'), false)
  assert.equal(isDoubleStrengthening('多头双持平'), false)
})

test('共享分类保留趋势延续、短线回调、承接和数据不足', () => {
  const signals = all('多头增强')
  assert.equal(classifyTrendStructure(signals).label, '多头趋势延续')
  signals['5m'] = signals['15m'] = '空头减弱'
  assert.equal(classifyTrendStructure(signals).label, '多头短线回调')
  signals['1h'] = '空头增强'
  assert.equal(classifyTrendStructure(signals).label, '空头承接观察')
  signals['4h'] = '--'
  assert.equal(classifyTrendStructure(signals).label, '数据不足观望')
})

test('固定权重给出多空分数，持平排名中性且不按K线进度扣分', () => {
  const context = buildEnvironmentContext(all('多头增强'), breadth(), 'BTC/USDT')
  assert.equal(context.long.confidence, 100)
  assert.equal(context.short.confidence, 0)
  assert.equal(context.long.coverage, 100)
  const flat = breadth()
  for (const stats of Object.values(flat.periods)) {
    stats.changes = { BTCUSDT: 0, A: 0 }
    stats.medianChangePct = 0
  }
  assert.equal(buildEnvironmentContext(all('中性'), flat, 'BTCUSDT').long.confidence, 50)
})

test('统一方向权重：短线逆向不当作支持，回调是否可入场由策略判断', () => {
  const signals = { ...all('多头双增强'), '5m': '空头双减弱', '15m': '空头双减弱' }
  const result = buildEnvironmentContext(signals, breadth(), 'BTCUSDT')
  assert.equal(result.long.structure, 82)
  assert.equal(result.short.structure, 18)
  assert.equal('style' in result, false)
  signals['1h'] = '中性'
  assert.equal(buildEnvironmentContext(signals, breadth(), 'BTCUSDT').long.structure, 67)
})

test('旧版档案标签保留历史评分语义，不推断未知的DI/MACD明细', () => {
  for (const [signal, longScore, shortScore] of [
    ['多头增强', 100, 0], ['多头减弱', 80, 20], ['中性', 50, 50],
    ['空头减弱', 20, 80], ['空头增强', 0, 100]
  ]) {
    const result = buildEnvironmentContext(all(signal), breadth(), 'BTCUSDT')
    assert.equal(result.long.structure, longScore)
    assert.equal(result.short.structure, shortScore)
  }
  const signals = { ...all('多头增强'), '1h': '多头减弱' }
  assert.equal(buildEnvironmentContext(signals, breadth(), 'BTCUSDT').long.structure, 94)
})

test('市场与排名按五窗口10/20/30/25/15加权，24h反向只影响其15%份额', () => {
  const snapshot = breadth()
  Object.assign(snapshot.periods['24h'], {
    upCount: 2, downCount: 7, medianChangePct: -1, validCount: 8,
    changes: { BTCUSDT: -5, A: -4, B: -3, C: -2, D: -1.5, E: -1, F: -0.5, G: 0 }
  })
  const result = buildEnvironmentContext(all('多头增强'), snapshot, 'BTCUSDT')
  assert.equal(result.long.market, 85)
  assert.equal(result.long.relativeStrength, 85)
  assert.equal(result.long.confidence, 90)
  assert.equal(result.long.coverage, 97)
  for (const [period, weight] of [['5m', 10], ['15m', 20], ['1h', 30], ['4h', 25], ['24h', 15]]) {
    const sample = breadth()
    Object.assign(sample.periods[period], { upCount: 2, downCount: 7, medianChangePct: -1 })
    assert.equal(buildEnvironmentContext(all('多头增强'), sample, 'BTCUSDT').long.market, 100 - weight)
  }
})

test('24h市场或个币排名缺失时不可用，不重分配其他窗口权重', () => {
  const snapshot = breadth()
  snapshot.periods['24h'].changes.BTCUSDT = null
  let result = buildEnvironmentContext(all('多头增强'), snapshot, 'BTCUSDT')
  assert.equal(result.long.relativeStrength, null)
  assert.equal(result.long.confidence, null)
  snapshot.periods['24h'].validCount = 0
  snapshot.periods['24h'].medianChangePct = null
  result = buildEnvironmentContext(all('多头增强'), snapshot, 'BTCUSDT')
  assert.equal(result.long.market, null)
  assert.equal(result.long.available, false)
})

test('过期、缺周期、缺个币和单样本均不可用，不能填中性或重分配权重', () => {
  const stale = breadth(); stale.expiresAt = 0
  for (const context of [
    buildEnvironmentContext(all('多头增强'), stale, 'BTCUSDT'),
    buildEnvironmentContext({ ...all('多头增强'), '1d': '--' }, breadth(), 'BTCUSDT'),
    buildEnvironmentContext(all('多头增强'), breadth(), 'UNKNOWN'),
    buildEnvironmentContext(all('多头增强'), undefined, 'BTCUSDT')
  ]) {
    assert.equal(context.long.available, false)
    assert.equal(context.long.confidence, null)
  }
  const single = breadth()
  for (const stats of Object.values(single.periods)) stats.changes = { BTCUSDT: 5 }
  assert.equal(buildEnvironmentContext(all('多头增强'), single, 'BTCUSDT').long.available, false)
})

test('服务端读取全部五周期，单周期失败不抹掉其他周期且使用与看板相同参数', async () => {
  const calls = []
  const context = {
    exports: {},
    require: () => ({ TREND_PERIODS, periodTrend, buildEnvironmentContext })
  }
  vm.createContext(context)
  const source = fs.readFileSync(new URL('../server/utils/environment-context.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const result = await context.exports.loadEnvironmentContext({
    async getIndicators(symbol, timeframe, type, params) {
      calls.push({ symbol, timeframe, type, params })
      if (timeframe === '1d') throw new Error('missing bars')
      if (type === 'ADX') { assert.equal(params.adxPeriod, 14); return { values: { diSpread: 2, diGapChange: 1 } } }
      assert.equal(params.macdFastPeriod, 12)
      return { values: { histogram: 2, previousHistogram: 1 } }
    }
  }, 'BTC/USDT', breadth())
  assert.equal(calls.length, 10)
  assert.equal(result.periods['5m'], '多头双增强')
  assert.equal(result.periods['1d'], '--')
  assert.equal(result.long.available, false)
})

/** 隔离API和落盘，仅验证真实分析器接收响应后的交易信号语义。 */
function analyzerFixture() {
  let environmentForAnalyze
  let response = { direction: 'LONG', confidence: 72, reasoning: '方向：LONG；置信度：72', scoreBreakdown: {} }
  const context = {
    exports: {}, process: { env: {} }, useRuntimeConfig: () => ({}),
    require(id) {
      if (id.includes('environment-confidence')) return { diTrend, formatEnvironmentConfidence, applyCommunityConfidence }
      if (id.includes('environment-context')) return { loadEnvironmentContext: async () => environmentForAnalyze }
      if (id.includes('strategy-store')) return { strategyStore: { getStrategy: async () => ({ marketData: { timeframes: ['15m'] } }) } }
      if (id.includes('stable-hash')) return { shortHash }
      if (id.includes('ai-analysis-snapshot')) return { createStrategySnapshot: () => ({}), createQuantitativeSnapshot: () => ({}) }
      if (id.includes('candle-volume')) return { getCandleVolume }
      if (id.includes('market-breadth')) return { formatMarketBreadth: () => '' }
      // 分析器已记录决策ID和提示词缓存，补齐隔离依赖，避免测试误走 API 降级分支。
      if (id === 'node:crypto') return { randomUUID }
      if (id.includes('ai-prompt-cache')) return { aiPromptCache: { put() {} } }
      if (id.includes('ai-service')) return {
        getProviderConfig: () => ({}), callAIAPI: async () => JSON.stringify(response), extractJSONContent: value => value
      }
      if (id.includes('concurrency-pool')) return { concurrencyPoolManager: { getAIPool: () => ({ submit: task => task() }) } }
      if (id.includes('logger')) return { logger: { info() {}, error() {} } }
      return {}
    }
  }
  vm.createContext(context)
  const source = fs.readFileSync(new URL('../server/modules/ai-analyzer/MultiStrategyAIAnalyzer.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const analyzer = new context.exports.MultiStrategyAIAnalyzer({}, { aiAnalysisConfig: { enabled: false, enableHistorySection: false } })
  return {
    respond(value) { response = { ...response, ...value } },
    analyze(environment, indicators) {
      environmentForAnalyze = environment
      return analyzer.analyze('community-flow', 'BTCUSDT', { userPrompt: '' }, { emaList: [], ...indicators }, 100, 0)
    },
    call(environment) { return analyzer.callAI('', 'BTCUSDT', 100, { emaList: [] }, 0, 'strategy', {}, environment) },
    prompt(indicators, environment) { return analyzer.buildFullPrompt({ userPrompt: '' }, 'BTCUSDT', 100, { emaList: [], ...indicators }, 0, 0.1, undefined, environment) }
  }
}

test('实际用户提示词中的DI持平与环境细分使用同一规则', () => {
  const fixture = analyzerFixture()
  for (const [spread, expected] of [[2, '多头持平'], [-2, '空头持平'], [0, '中性']]) {
    const prompt = fixture.prompt({ enabledIndicators: { adx: true }, adx: 20, diSpread: spread, diGapChange: 0 })
    assert.ok(prompt.includes(`DI信号趋势: ${expected}`))
  }
})

test('相邻周期整组同向才加10点结构分，支持多空各状态且不满足不扣分', () => {
  for (const [timeframe, required] of [['5m', ['15m', '1h']], ['15m', ['1h']], ['1h', ['4h']], ['4h', ['1d']]]) {
    for (const [side, prefix] of [[1, '多头'], [-1, '空头']]) {
      for (const state of ['双增强', '双持平', '双减弱', 'DI增强、MACD减弱', 'DI减弱、MACD增强']) {
        const periods = all(`${prefix}${state}`)
        assert.equal(adjacentPeriodBonus(periods, timeframe, side), 10)
        assert.equal(adjacentPeriodBonus(periods, timeframe, -side), 0)
        for (const period of required) for (const invalid of ['中性', '方向分歧', '--', undefined, `${prefix === '多头' ? '空头' : '多头'}双增强`]) {
          assert.equal(adjacentPeriodBonus({ ...periods, [period]: invalid }, timeframe, side), 0)
        }
      }
    }
  }
  assert.equal(adjacentPeriodBonus(all('多头双增强'), '1d', 1), 0)
  assert.equal(adjacentPeriodBonus(all('空头双增强'), '1d', -1), 0)
  assert.equal(adjacentPeriodBonus({ '1h': '多头双减弱' }, '15m', 1), 10)
  assert.equal(adjacentPeriodBonus(all('多头双增强'), undefined, 1), 0)
})

test('同向奖励计入原五周期30%分项，无新提示词规则，分项仍可复算最终分', () => {
  const fixture = analyzerFixture()
  const periods = all('多头双减弱')
  const baseline = buildEnvironmentContext(periods, breadth(), 'BTCUSDT')
  const environment = buildEnvironmentContext(periods, breadth(), 'BTCUSDT', '5m')
  assert.equal(environment.long.structure, baseline.long.structure + 10)
  assert.equal(environment.long.confidence, baseline.long.confidence + 3)
  assert.equal(environment.long.adjacentBonus, 10)
  assert.equal(environment.short.confidence, baseline.short.confidence)
  assert.ok(environment.short.confidence > 0)
  assert.equal(environment.short.adjacentBonus, 0)
  const prompt = fixture.prompt({}, environment)
  assert.ok(!prompt.includes('相邻周期') && !prompt.includes('独立开仓必要条件'))
  assert.match(prompt, /五周期支持70×30%/)
  assert.equal(environment.long.confidence, Math.round(environment.long.market * .4 + environment.long.structure * .3 + environment.long.relativeStrength * .3))
})

test('奖励封顶100、5m不部分奖励、日线不变且缺失仍不可用', () => {
  const snapshot = breadth()
  const strongest = buildEnvironmentContext(all('多头双增强'), snapshot, 'BTCUSDT', '5m')
  assert.equal(strongest.long.structure, 100)
  assert.equal(strongest.long.confidence, 100)
  assert.equal(strongest.long.adjacentBonus, 0)
  const almost = buildEnvironmentContext({ ...all('多头双增强'), '5m': '多头双减弱' }, snapshot, 'BTCUSDT', '5m')
  assert.equal(almost.long.structure, 100)
  assert.equal(almost.long.adjacentBonus, 4)
  const split = { ...all('多头双减弱'), '1h': '空头双减弱' }
  const baseline = buildEnvironmentContext(split, snapshot, 'BTCUSDT')
  assert.equal(buildEnvironmentContext(split, snapshot, 'BTCUSDT', '5m').long.confidence, baseline.long.confidence)
  assert.equal(buildEnvironmentContext(split, snapshot, 'BTCUSDT', '15m').short.adjacentBonus, 10)
  const daily = buildEnvironmentContext(split, snapshot, 'BTCUSDT', '1d')
  assert.equal(daily.long.confidence, baseline.long.confidence)
  assert.equal(daily.short.confidence, baseline.short.confidence)
  const missing = buildEnvironmentContext({ ...split, '1d': '--' }, snapshot, 'BTCUSDT', '5m')
  assert.equal(missing.long.available, false)
  assert.equal(missing.long.confidence, null)
  assert.equal(missing.long.adjacentBonus, 0)
})

test('分析器按AI方向绑定正确分数，缺失时观望且不替换理由文字', async () => {
  const fixture = analyzerFixture()
  const environment = buildEnvironmentContext(all('多头增强'), breadth(), 'BTCUSDT')
  const long = await fixture.call(environment)
  assert.equal(long.confidence, 100)
  assert.equal(long.reasoning, '方向：LONG；置信度：72')
  fixture.respond({ direction: 'SHORT', confidence: 100 })
  const short = await fixture.call(environment)
  assert.equal(short.direction, 'SHORT')
  assert.equal(short.confidence, 0)
  const missing = await fixture.call(undefined)
  assert.equal(missing.direction, 'IDLE')
  assert.equal(missing.confidence, 0)
  assert.equal(missing.reasoning, '方向：LONG；置信度：72')
  fixture.respond({ direction: 'IDLE', confidence: 80, reasoning: '方向：IDLE；置信度：80' })
  const idle = await fixture.call(environment)
  assert.equal(idle.direction, 'IDLE')
  assert.equal(idle.confidence, 0)
  fixture.respond({ direction: 'BAD' })
  const invalid = await fixture.call(environment)
  assert.equal(invalid.direction, 'IDLE')
  assert.equal(invalid.confidence, 0)
})

test('提示词展示多空三个分项与权重，缺失不伪装零分且最终分由程序确定', () => {
  const context = buildEnvironmentContext(all('多头增强'), breadth(), 'BTCUSDT')
  const prompt = formatEnvironmentConfidence(context)
  assert.match(prompt, /LONG做多：置信度100分，环境明显支持/)
  assert.match(prompt, /SHORT做空：置信度0分，环境明显反向/)
  assert.ok(!prompt.includes('IDLE') && !prompt.includes('置信度记为0'))
  assert.match(prompt, /LONG做多：[^\n]*。\n\t\t（分项：市场支持100×40% \+ 五周期支持100×30% \+ 相对强弱100×30%）/)
  assert.match(prompt, /SHORT做空：[^\n]*。\n\t\t（分项：市场支持0×40% \+ 五周期支持0×30% \+ 相对强弱0×30%）/)
  assert.ok(prompt.endsWith('相对强弱0×30%）'))
  assert.ok(!prompt.includes('计算明细') && !prompt.includes('四舍五入'))
  const ranked = buildEnvironmentContext(all('多头增强'), breadth(), 'A')
  assert.match(formatEnvironmentConfidence(ranked), /相对强弱88\.89×30%/)
  assert.ok(!prompt.includes('{') && !prompt.includes('available') && !prompt.includes('analysisDirection'))
  assert.match(formatEnvironmentConfidence(), /暂无可用分数/)
  assert.ok(!formatEnvironmentConfidence().includes('置信度记为0'))
  const missing = buildEnvironmentContext({}, undefined, 'BTCUSDT')
  assert.match(formatEnvironmentConfidence(missing), /环境数据不足/)
  assert.match(formatEnvironmentConfidence(missing), /市场支持：暂无可用分数；五周期方向支持：暂无可用分数；相对强弱：暂无可用分数/)
})
