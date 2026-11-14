// ==================== 趋势头部区间统计与周期联动 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, ref } from 'vue'
import * as summary from '../app/utils/trend-window-summary.ts'
import * as calculations from '../app/utils/crypto-trend-calculations.ts'
import { beijingDate } from '../app/utils/beijing-time.ts'

test('各窗口只累计实际披露值，排除未来、延用及无效值', () => {
  const end = '2026-11-15'
  const rows = [
    { date: '2025-11-15', value: 999 },
    { date: '2026-01-01', value: 10 },
    { date: '2026-09-01', value: 20 },
    { date: '2026-11-01', value: 30 },
    { date: '2026-11-09', value: -5 },
    { date: end, value: 100, disclosedDate: '2026-11-09' },
    { date: '2026-11-16', value: 999 },
    { date: '2026-11-14', value: NaN },
  ]
  assert.deepEqual([7, 30, 90, 365].map(days => summary.summarizeTrendWindow(rows, days, end).total), [-5, 25, 45, 55])
  assert.equal(summary.summarizeTrendWindow(rows, 30, end).average, 12.5)
  assert.equal(summary.summarizeTrendWindow(rows, 7, end).change, null)
  assert.equal(summary.summarizeTrendWindow([], 7, end).total, null)
})

test('首尾有效值计算变化，零基准和单点不伪造变化率', () => {
  const rows = [{ date: '2026-11-09', value: 100 }, { date: '2026-11-14', value: 125, provisional: true }]
  assert.equal(summary.summarizeTrendWindow(rows, 7, '2026-11-15').change, 25)
  assert.equal(summary.summarizeTrendWindow([{ ...rows[0], value: 0 }, rows[1]], 7, '2026-11-15').change, null)
  assert.equal(summary.formatTrendAmount(-1500000), '-$1.50M')
  assert.equal(summary.formatTrendAmount(null), '--')
  assert.equal(summary.formatTrendNumber(-0.001, '%', true), '0.0%')
  assert.equal(beijingDate(Date.parse('2026-11-14T16:01:00Z')), '2026-11-15')
})

test('卡片头部响应全局周期，ETF累计和稳定币变化采用原始观测', () => {
  const component = fs.readFileSync(new URL('../app/components/CryptoTrendsDrawer.vue', import.meta.url), 'utf8')
  const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = {
    exports: {}, AbortController,
    defineProps: () => ({ modelValue: true }), withDefaults: value => value, defineEmits: () => () => {},
    require: id => {
      if (id === 'vue') return { computed, ref, watch() {}, onUnmounted() {} }
      if (id.includes('trend-window-summary')) return summary
      if (id.includes('crypto-trend-calculations')) return calculations
      if (id.includes('useGlobalPolling')) return { useGlobalPolling() {} }
      return {}
    },
  }
  vm.runInNewContext(ts.transpile(script + '\nglobalThis.api = { data, days, panels };', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  const { data, days, panels } = context.api
  const end = beijingDate()
  const ago = count => new Date(Date.parse(end) - count * 86400000).toISOString().slice(0, 10)
  const rows = [{ date: ago(20), value: 100 }, { date: ago(5), value: 150 }, { date: end, value: 200 }]
  data.value = { prices: { btc: [], eth: [], btcdom: [] }, metrics: Object.fromEntries(['btcEtf', 'ethEtf', 'stablecoinSupply'].map(key => [key, { points: rows }])) }
  const panel = title => panels.value.find(entry => entry.title === title)
  days.value = 30
  assert.equal(panel('ETF 资金流').stats[0].value, '$450.00')
  assert.equal(panel('稳定币供应量').stats[1].value, '+100.0%')
  days.value = 7
  assert.equal(panel('ETF 资金流').stats[0].value, '$350.00')
  assert.equal(panel('稳定币供应量').stats[1].value, '+33.3%')
  assert.match(component, /class="window-label">\{\{ rangeLabel \}\}/)
})
