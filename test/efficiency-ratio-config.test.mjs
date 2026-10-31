// ==================== ER 策略编辑及服务端配置回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as er from '../shared/utils/efficiency-ratio.ts'

/** 执行真实配置源码，隔离网络和页面挂载；Vue 的响应式和 watcher 保持真实行为。 */
function loadSource(source, dependencies = {}, globals = {}) {
  const context = {
    exports: {}, console, ...globals,
    require: id => dependencies[id] ?? {}
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  vm.runInNewContext(compiled.outputText, context)
  return context.exports
}

/** 使用实际 SFC setup，验证加载旧策略、修改参数和保存时的响应式配置。 */
async function createEditor(strategy) {
  const path = new URL('../app/components/StrategyEditor.vue', import.meta.url)
  const descriptor = parse(readFileSync(path, 'utf8')).descriptor
  const script = compileScript(descriptor, { id: 'er-editor-test', fs: {
    fileExists: () => true,
    readFile: path => readFileSync(path, 'utf8')
  } })
  const component = loadSource(script.content, {
    vue,
    '../../shared/utils/efficiency-ratio': er,
    '../stores/bot': { useBotStore: () => ({ botConfig: { symbols: ['BTCUSDT'] } }) }
  }, { $fetch: async () => ({ success: true, data: [] }) }).default
  const events = []
  const scope = vue.effectScope()
  const props = vue.reactive({ strategy })
  const editor = scope.run(() => component.setup(props, {
    expose() {}, emit: (...args) => events.push(args)
  }))
  await vue.nextTick()
  return { editor, props, events, stop: () => scope.stop() }
}

/** 复用新策略默认必需字段，避免维护一份与编辑器脱节的表单副本。 */
async function strategyFixture(indicators) {
  const fixture = await createEditor()
  const strategy = JSON.parse(JSON.stringify(fixture.editor.form.value))
  fixture.stop()
  return { ...strategy, marketData: { symbols: ['BTCUSDT'], timeframes: ['5m'] }, indicators }
}

test('新策略默认 ER20，自动跟随策略全部勾选周期并保存窗口', async () => {
  const f = await createEditor()
  try {
    let config = f.editor.form.value.indicators.find(i => i.type === 'ER')
    assert.equal(config.params.period, 20)
    assert.deepEqual(Array.from(config.timeframes), ['1h'])
    f.editor.form.value.marketData.timeframes = ['1h', '5m', '15m']
    f.editor.erPeriod.value = 30
    await vue.nextTick()
    assert.equal(f.editor.erTimeframeLabel.value, '5m、15m、1h')
    await f.editor.handleSave()
    config = f.events.find(([event]) => event === 'save')[1].indicators.find(i => i.type === 'ER')
    assert.equal(config.params.period, 30)
    assert.deepEqual(Array.from(config.timeframes), ['5m', '15m', '1h'])
  } finally { f.stop() }
})

test('编辑旧 ER 策略保留窗口，忽略独立周期并随策略周期增删自动更新', async () => {
  const strategy = await strategyFixture([
    { id: 'er', type: 'ER', enabled: true, params: { period: 35 }, timeframes: ['15m', '1h'] }
  ])
  const f = await createEditor(strategy)
  try {
    let config = f.editor.form.value.indicators.find(i => i.type === 'ER')
    assert.deepEqual(Array.from(config.timeframes), ['5m'])
    f.editor.form.value.marketData.timeframes = ['4h', '1d']
    await vue.nextTick()
    config = f.editor.form.value.indicators.find(i => i.type === 'ER')
    assert.equal(config.params.period, 35)
    assert.deepEqual(Array.from(config.timeframes), ['4h', '1d'])
    f.editor.form.value.marketData.timeframes = ['1d']
    await vue.nextTick()
    assert.deepEqual(Array.from(f.editor.form.value.indicators.find(i => i.type === 'ER').timeframes), ['1d'])
    f.editor.selectedIndicators.value = f.editor.selectedIndicators.value.filter(type => type !== 'ER')
    await vue.nextTick()
    assert.ok(!f.editor.form.value.indicators.some(i => i.type === 'ER'))
  } finally { f.stop() }
})

test('加载未配置 ER 的旧策略不隐式启用，主动勾选后才加入配置', async () => {
  const f = await createEditor(await strategyFixture([]))
  try {
    assert.ok(!f.editor.form.value.indicators.some(i => i.type === 'ER'))
    f.editor.selectedIndicators.value.push('ER')
    await vue.nextTick()
    const config = f.editor.form.value.indicators.find(i => i.type === 'ER')
    assert.equal(config.params.period, 20)
    assert.deepEqual(Array.from(config.timeframes), ['5m'])
  } finally { f.stop() }
})

test('服务端按策略周期覆盖旧 ER 独立配置，保持窗口边界及启用开关', () => {
  const source = readFileSync(new URL('../server/utils/strategy-indicators-normalizer.ts', import.meta.url), 'utf8')
  const { normalizeStrategyIndicatorConfig } = loadSource(source, { '../../shared/utils/efficiency-ratio': er })
  const strategy = normalizeStrategyIndicatorConfig({
    marketData: { timeframes: ['15m', '5m', '15m'] },
    indicators: [{ type: 'ER', enabled: true, params: { period: 999 }, timeframes: ['1h', '15m', '1h'] }]
  })
  assert.equal(strategy.indicators[0].params.period, 100)
  assert.deepEqual(Array.from(strategy.indicators[0].timeframes), ['5m', '15m'])
  const fallback = normalizeStrategyIndicatorConfig({
    marketData: { timeframes: ['5m'] }, indicators: [{ type: 'ER', params: {}, timeframes: [] }]
  })
  assert.equal(fallback.indicators[0].params.period, 20)
  assert.deepEqual(Array.from(fallback.indicators[0].timeframes), ['5m'])
  const daily = normalizeStrategyIndicatorConfig({
    marketData: { timeframes: ['1d'] }, indicators: [{ type: 'ER', params: { period: 40 }, timeframes: ['5m', '4h'] }]
  })
  assert.equal(daily.indicators[0].params.period, 40)
  assert.deepEqual(Array.from(daily.indicators[0].timeframes), ['1d'])
  assert.equal(normalizeStrategyIndicatorConfig({ indicators: [] }).indicators.length, 0)
})
