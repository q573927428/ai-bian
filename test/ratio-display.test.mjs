// ==================== 比值图盘中日期、提示与横轴一致性 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, ref } from 'vue'
import * as beijingTime from '../app/utils/beijing-time.ts'
import * as calculations from '../app/utils/relative-market-calculations.ts'

test('北京时间凌晨比值图末点、顶部范围和提示均显示今日且仍为盘中', () => {
  const source = fs.readFileSync(new URL('../app/components/RelativeRatioChart.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  let option
  const context = {
    exports: {}, AbortController,
    defineProps: () => ({ days: 90, refreshVersion: 0 }),
    chartStub: { clear() {}, getOption: () => ({}), setOption: value => { option = value } },
    require: id => {
      if (id === 'vue') return { computed, ref, watch() {}, onMounted() {}, onBeforeUnmount() {} }
      if (id.includes('beijing-time')) return beijingTime
      if (id.includes('relative-market-calculations')) return calculations
      if (id.includes('useTheme')) return { useTheme: () => ({ theme: ref('dark') }) }
      if (id.includes('chart-tooltip-theme')) return { getChartTooltipTheme: () => ({}) }
      return {}
    },
  }
  vm.runInNewContext(ts.transpile(source + '\nchart = globalThis.chartStub; element.value = {}; globalThis.api = { sourcePoints, displayNow, points, historyRange, unfinished, render };', {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }), context)
  const api = context.api
  api.displayNow.value = Date.parse('2026-11-14T16:40:00Z') / 1000
  api.sourcePoints.value = [{ t: Date.parse('2026-11-13T00:00:00Z') / 1000, value: .028 }, { t: Date.parse('2026-11-14T00:00:00Z') / 1000, value: .02795811 }]
  api.render()
  assert.equal(api.unfinished.value, true)
  assert.match(api.historyRange.value, /2026\/11\/15$/)
  assert.equal(option.series[0].data.at(-1), .02795811)
  const tooltip = option.tooltip.formatter([{ dataIndex: option.series[0].data.length - 1 }])
  assert.match(tooltip, /^2026\/11\/15 00:40 北京时间/)
  assert.match(tooltip, /（盘中）/)
  assert.equal(api.points.value.at(-1).periodStart, api.sourcePoints.value.at(-1).t)
})
