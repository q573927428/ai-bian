// ==================== 首页 ER 默认展示和实时价格更新回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref, computed } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { calculateErChartMetricsSeries } from '../app/utils/er-chart-series.ts'
import { DEFAULT_ER_PERIOD } from '../shared/utils/efficiency-ratio.ts'
import { calculateEMASeries, calculateATRSeries, calculateATRPercent } from '../app/utils/ema-calculator.ts'
import { calculateRSISeries } from '../app/utils/rsi-calculator.ts'
import { calculateADXSeries } from '../app/utils/adx-calculator.ts'

/** 执行真实组件的数据展示和价格更新函数，隔离图表渲染和行情网络连接。 */
function createFixture() {
  const source = parse(readFileSync(new URL('../app/components/kline-chart/KLineChartSimple.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = ts.createSourceFile('chart.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set(['getTimeframeSeconds', 'latestEr', 'updateLastKlineWithPrice', 'calculateLatestEmaDiff', 'calculateLatestAtrPercent', 'calculateLatestRsi', 'calculateLatestAdx', 'showLatestKline'])
  const declarations = ast.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast))))
  assert.equal(declarations.length, names.size)
  const step = 300
  const current = Math.floor(Date.now() / 1000 / step) * step
  const klineData = ref(Array.from({ length: 50 }, (_, i) => ({
    t: current - (49 - i) * step, o: 100 + i, h: 106 + i, l: 96 + i,
    c: 100 + i + Math.sin(i) * 3, v: 10
  })))
  const tooltipData = ref({})
  const globals = {
    ref, computed, klineData, tooltipData, selectedTimeframe: ref('5m'),
    tooltipVisible: ref(false), tooltipTime: ref(''), meta: ref({}), chartCanvasRef: ref(null),
    botStore: { config: { emaPeriods: [20, 200] } }, formatTime: String,
    calculateErChartMetricsSeries, DEFAULT_ER_PERIOD, calculateEMASeries, calculateATRSeries,
    calculateATRPercent, calculateRSISeries, calculateADXSeries,
    exports: {}
  }
  const compiled = ts.transpileModule(declarations.map(statement => statement.getText(ast)).join('\n')
    + '\nexports.showLatestKline = showLatestKline; exports.updateLastKlineWithPrice = updateLastKlineWithPrice;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  })
  vm.runInNewContext(compiled.outputText, globals)
  return { ...globals.exports, klineData, tooltipData }
}

test('首页首次展示未收盘 ER，价格刷新后保留并更新 ER', () => {
  const fixture = createFixture()
  fixture.showLatestKline()
  const initial = fixture.tooltipData.value.er
  assert.equal(typeof initial, 'number')
  assert.ok(Number.isFinite(initial))
  const startClose = fixture.klineData.value.at(-21).c
  assert.equal(fixture.tooltipData.value.erChangePercent, (fixture.klineData.value.at(-1).c - startClose) / startClose * 100)
  fixture.updateLastKlineWithPrice(5000)
  const updated = fixture.tooltipData.value.er
  assert.equal(typeof updated, 'number')
  assert.notEqual(updated, initial)
  assert.equal(fixture.tooltipData.value.close, 5000)
  assert.equal(fixture.tooltipData.value.erChangePercent, (5000 - startClose) / startClose * 100)
  fixture.showLatestKline()
  assert.equal(fixture.tooltipData.value.er, updated)
})

test('默认展示保留有效 ER 零值，数据不足时才显示空值', () => {
  const fixture = createFixture()
  fixture.klineData.value = fixture.klineData.value.map(bar => ({ ...bar, c: 100 }))
  fixture.showLatestKline()
  assert.equal(fixture.tooltipData.value.er, 0)
  assert.equal(fixture.tooltipData.value.erChangePercent, 0)
  fixture.klineData.value = fixture.klineData.value.slice(-20)
  fixture.showLatestKline()
  assert.equal(fixture.tooltipData.value.er, null)
  assert.equal(fixture.tooltipData.value.erChangePercent, null)
})

test('下跌窗口的 ER 保持非负，区间涨跌幅显示负值', () => {
  const fixture = createFixture()
  fixture.klineData.value = fixture.klineData.value.map((bar, i) => ({ ...bar, c: 200 - i }))
  fixture.showLatestKline()
  assert.equal(fixture.tooltipData.value.er, 1)
  assert.equal(fixture.tooltipData.value.erChangePercent, -20 / 171 * 100)
})
