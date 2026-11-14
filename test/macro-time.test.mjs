// ==================== 宏观横轴与光标盘中日期回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import * as macroTime from '../app/utils/macro-time.ts'
import * as beijingTime from '../app/utils/beijing-time.ts'
import * as performance from '../app/utils/macro-performance.ts'
import * as comparison from '../app/utils/macro-comparison.ts'

const latest = Date.parse('2026-11-14T00:00:00Z') / 1000
const now = Date.parse('2026-11-14T16:40:00Z')

test('跨日末柱显示当前北京时间，历史、已结束行情和Yahoo日期不偏移', () => {
  assert.equal(macroTime.macroDisplayTime(latest, latest, 86400, 'binance', now), now / 1000)
  assert.equal(macroTime.macroDisplayTime(latest - 86400, latest, 86400, 'binance', now), latest - 86400)
  assert.equal(macroTime.macroDisplayTime(latest, latest, 86400, 'binance', now + 86400000), latest)
  assert.equal(macroTime.macroDisplayTime(latest, latest, 86400, 'yahoo', now), latest)
  const hour = Date.parse('2026-11-14T16:00:00Z') / 1000
  assert.equal(macroTime.macroDisplayTime(hour, hour, 3600, 'binance', now), hour)
})

test('宏观真实组件的横轴与光标显示同一天，保持原始K线和联动时间', () => {
  const source = fs.readFileSync(new URL('../app/components/macro-data/MacroKLineChart.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'macro-time' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'MacroKLineChart.vue', id: 'macro-time', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  const props = { market: { id: 'btc', source: 'binance' }, period: '1d' }
  const context = {
    exports: {},
    defineProps: () => props, defineEmits: () => () => {},
    require: id => {
      if (id === 'vue') return { computed, ref, inject: () => undefined, watch() {}, onMounted() {}, onBeforeUnmount() {} }
      if (id === 'lightweight-charts') return { ColorType: { Solid: 'solid' }, TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 } }
      if (id.includes('macro-time')) return macroTime
      if (id.includes('beijing-time')) return beijingTime
      if (id.includes('macro-performance')) return performance
      if (id.includes('macro-comparison')) return comparison
      if (id.includes('useTheme')) return { useTheme: () => ({ theme: ref('dark') }) }
      if (id.includes('useGlobalPolling')) return { useGlobalPolling() {} }
      return {}
    },
  }
  vm.runInNewContext(ts.transpile(descriptor.scriptSetup.content + '\nglobalThis.api = { latestBar, displayNow, chartTimeOptions };', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  const api = context.api
  api.latestBar.value = { time: latest, close: 65111 }
  api.displayNow.value = now
  const options = api.chartTimeOptions()
  assert.equal(options.timeScale.tickMarkFormatter(latest, 2), '11/15')
  assert.equal(options.localization.timeFormatter(latest), '2026/11/15 00:40 北京时间 · 盘中')
  assert.equal(options.localization.timeFormatter(latest - 86400), '2026/11/13 08:00 北京时间')
  assert.equal(api.latestBar.value.time, latest)
  assert.notEqual(options.timeScale.tickMarkFormatter, api.chartTimeOptions().timeScale.tickMarkFormatter)
  props.market.source = 'yahoo'
  assert.equal(api.chartTimeOptions().localization.timeFormatter(latest), '2026/11/14 08:00 北京时间')
})
