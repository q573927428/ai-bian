// ==================== 多周期结构、方向支持度与置信度边界测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { TREND_PERIODS, combinePeriodTrend, periodTrend, classifyTrendStructure, buildEnvironmentContext, formatEnvironmentConfidence } from '../app/utils/environment-confidence.ts'

const all = signal => Object.fromEntries(TREND_PERIODS.map(period => [period, signal]))

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

test('DI/MACD同向才有方向，持平不是双增强，缺失与中性分开', () => {
  assert.equal(periodTrend({ diSpread: 1, diGapChange: 0.1 }, { histogram: 2, previousHistogram: 1 }), '多头增强')
  assert.equal(combinePeriodTrend('多头增强', 2, 2), '多头减弱')
  assert.equal(combinePeriodTrend('多头增强', -2, -1), '中性')
  assert.equal(combinePeriodTrend('空头增强', -2, -1), '空头增强')
  assert.equal(combinePeriodTrend('多头增强', undefined, 1), '--')
  assert.equal(periodTrend({ diSpread: null, diGapChange: 1 }, { histogram: 1, previousHistogram: 0 }), '--')
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
  const signals = { ...all('多头增强'), '5m': '空头减弱', '15m': '空头减弱' }
  const result = buildEnvironmentContext(signals, breadth(), 'BTCUSDT')
  assert.equal(result.long.structure, 76)
  assert.equal(result.short.structure, 24)
  assert.equal('style' in result, false)
  signals['1h'] = '中性'
  assert.equal(buildEnvironmentContext(signals, breadth(), 'BTCUSDT').long.structure, 61)
})

test('多周期支持度按100/80/50/20/0区分方向与增强状态，多空对称', () => {
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
  assert.equal(result.periods['5m'], '多头增强')
  assert.equal(result.periods['1d'], '--')
  assert.equal(result.long.available, false)
})

/** 隔离API和落盘，仅验证真实分析器接收响应后的交易信号语义。 */
function analyzerFixture() {
  let response = { direction: 'LONG', confidence: 72, reasoning: '方向：LONG；置信度：72', scoreBreakdown: {} }
  const context = {
    exports: {}, process: { env: {} }, useRuntimeConfig: () => ({}),
    require(id) {
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
    call(environment) { return analyzer.callAI('', 'BTCUSDT', 100, { emaList: [] }, 0, 'strategy', {}, environment) }
  }
}

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
