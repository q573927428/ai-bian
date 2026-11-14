// ==================== 情绪历史与固定样本广度回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { parseFearGreed, parseOptionSkew } from '../server/utils/crypto-sentiment.ts'
import { calculateMarketBreadth } from '../app/utils/trend-market-breadth.ts'
import * as beijingTime from '../app/utils/beijing-time.ts'
import * as trendCalculations from '../app/utils/crypto-trend-calculations.ts'

const now = Date.parse('2026-11-15T12:00:00Z')
const day = 86400
const timestamp = Date.parse('2026-11-14') / 1000

test('恐慌贪婪按日期排序，保留零分，排除空值、越界分数和未来数据', () => {
  const rows = [
    { timestamp: String(timestamp), value: '0' },
    { timestamp: String(timestamp - day), value: '75' },
    { timestamp: String(timestamp - 2 * day), value: null },
    { timestamp: String(timestamp - 3 * day), value: '101' },
    { timestamp: String(timestamp + 2 * day), value: '50' },
  ]
  assert.deepEqual(parseFearGreed({ data: rows }, now), [{ date: '2026-11-13', value: 75 }, { date: '2026-11-14', value: 0 }])
  assert.throws(() => parseFearGreed({ data: [rows[0], rows[0]] }, now), /重复/)
  assert.throws(() => parseFearGreed({ data: [] }, now), /为空/)
})

test('偏斜只读取选定期限，保留负值，不把期限相加或把空值补零', () => {
  const data = { Description: 'BTC Twenty Five Delta Option Skew', Frequency: 'Daily', Series: {
    '7 Day Exp': { Data: [{ Timestamp: timestamp, Result: 100 }] },
    '30 Day Exp': { Data: [{ Timestamp: timestamp - 2 * day, Result: -3 }, { Timestamp: timestamp - day, Result: null }, { Timestamp: timestamp, Result: 0 }] },
  } }
  assert.deepEqual(parseOptionSkew(data, 'btc', 30, now), [{ date: '2026-11-12', value: -3 }, { date: '2026-11-14', value: 0 }])
  assert.throws(() => parseOptionSkew(data, 'eth', 30, now), /格式/)
  assert.throws(() => parseOptionSkew(data, 'btc', 90, now), /格式/)
  assert.throws(() => parseOptionSkew({ ...data, Frequency: 'Monthly' }, 'btc', 30, now), /格式/)
})

/** 生成覆盖30天可视区及59天预热的连续日线，最后一天为昨天。 */
function bars(symbol, price) {
  const start = Math.floor(now / 86400000) * day - 88 * day
  return Array.from({ length: 88 }, (_, i) => ({ symbol, t: start + i * day, c: price(i) }))
}

test('固定样本共用分母，新币、缺日和无效价格不能让广度跳变', () => {
  const up = bars('UP', i => 100 + i)
  const down = bars('DOWN', i => 200 - i)
  const flat = bars('FLAT', () => 10)
  const missing = bars('MISSING', i => 100 + i).filter((_, i) => i !== 70)
  const invalid = bars('INVALID', i => i === 30 ? 0 : 10)
  const newborn = bars('NEW', i => 100 + i).slice(-20)
  const result = calculateMarketBreadth([...up, ...down, ...flat, ...missing, ...invalid, ...newborn], 30, now)
  assert.deepEqual(result.symbols, ['DOWN', 'FLAT', 'UP'])
  assert.equal(result.sampleCount, 3)
  assert.equal(result.ma20.length, 29)
  assert.equal(result.ma60.length, 29)
  assert.equal(result.ma20[0].date, '2026-10-17')
  assert.equal(result.ma20.at(-1).date, '2026-11-14')
  for (const row of [...result.ma20, ...result.ma60]) assert.ok(Math.abs(row.value - 100 / 3) < 1e-8)
})

test('当天盘中价格参与均线，未来日线不纳入，不足60日预热返回空历史', () => {
  const rows = bars('UP', i => 100 + i)
  const today = Math.floor(now / 86400000) * day
  const baseline = calculateMarketBreadth(rows, 30, now)
  const live = calculateMarketBreadth([...rows, { symbol: 'UP', t: today, c: 1 }, { symbol: 'UP', t: today + day, c: 1 }], 30, now)
  assert.deepEqual(live.ma60.slice(0, -1), baseline.ma60)
  assert.equal(live.ma60.length, 30)
  assert.deepEqual(live.ma60.at(-1), { date: '2026-11-15', value: 0, provisional: true })
  assert.deepEqual(live.ma20.at(-1), { date: '2026-11-15', value: 0, provisional: true })
  assert.equal(live.sampleCount, baseline.sampleCount)
  assert.equal(calculateMarketBreadth(rows.slice(1), 30, now).sampleCount, 0)
  assert.deepEqual(calculateMarketBreadth([], 30, now).ma20, [])
})

test('盘中样本部分缺失时保留完整历史及分母，补齐后只增加盘中点', () => {
  const rows = [...bars('A', i => 100 + i), ...bars('B', i => 100 + i)]
  const today = Math.floor(now / 86400000) * day
  const baseline = calculateMarketBreadth(rows, 30, now)
  const partial = [...rows, { symbol: 'A', t: today, c: 1 }]
  assert.deepEqual(calculateMarketBreadth(partial, 30, now), baseline)
  const complete = calculateMarketBreadth([...partial, { symbol: 'B', t: today, c: 200 }], 30, now)
  assert.deepEqual(complete.symbols, baseline.symbols)
  assert.deepEqual(complete.ma60.slice(0, -1), baseline.ma60)
  assert.equal(complete.ma60.at(-1).value, 50)
  assert.equal(complete.ma60.at(-1).provisional, true)
})

test('近7天广度保留60日均线预热，仅展示区间内已收盘日期', () => {
  const result = calculateMarketBreadth(bars('UP', i => 100 + i), 7, now)
  assert.equal(result.days, 7)
  assert.equal(result.sampleCount, 1)
  assert.equal(result.ma60.length, 6)
  assert.equal(result.ma60[0].date, '2026-11-09')
  assert.equal(result.ma60.at(-1).date, '2026-11-14')
  assert.ok(result.ma60.every(point => point.value === 100))
})

test('均线只使用当天和之前价格；后续暴涨不能改变先前广度', () => {
  const base = bars('UP', i => 100 + i)
  const changed = base.map((row, i) => i > 70 ? { ...row, c: 1 } : row)
  assert.deepEqual(calculateMarketBreadth(base, 30, now).ma60.slice(0, 12), calculateMarketBreadth(changed, 30, now).ma60.slice(0, 12))
  assert.equal(calculateMarketBreadth(changed, 30, now).ma60.at(-1).value, 0)
})

test('情绪使用右轴分档色带，暗灰BTC使用左轴，单位与盘中状态独立', () => {
  for (const name of ['CryptoTrendChart', 'CryptoTrendsDrawer']) {
    const source = fs.readFileSync(new URL(`../app/components/${name}.vue`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: `${name}.vue`, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const source = fs.readFileSync(new URL('../app/components/CryptoTrendChart.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const date = beijingTime.beijingDate()
  let option
  const mounted = []
  const context = {
    exports: {}, Date,
    defineProps: () => ({ days: 30, format: 'money', rightFormat: 'score', rightMin: 0, rightMax: 100, referenceLines: [25, 75], series: [
      { name: '情绪', color: 'cyan', right: true, sentiment: true, points: [{ date, value: 13 }] },
      { name: 'BTC', color: '#626a78', points: [{ date, value: 80000, provisional: true }] },
    ] }),
    ResizeObserver: class { observe() {} },
    require: id => {
      if (id.includes('beijing-time')) return beijingTime
      if (id.includes('crypto-trend-calculations')) return trendCalculations
      if (id === 'vue') return { ref, watch: () => {}, onMounted: callback => mounted.push(callback), onUnmounted: () => {} }
      if (id === 'echarts/core') return { use: () => {}, init: () => ({ setOption: value => { option = value } }) }
      if (id.includes('useTheme')) return { useTheme: () => ({ theme: ref('dark') }) }
      if (id.includes('chart-tooltip-theme')) return { getChartTooltipTheme: () => ({}) }
      return {}
    },
  }
  vm.runInNewContext(ts.transpile(source + '\nelement.value = {};', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  mounted.forEach(callback => callback())
  assert.equal(option.yAxis[1].axisLabel.formatter(13), '13')
  assert.equal(option.yAxis[0].axisLabel.formatter(80000), '$80000')
  assert.equal(option.yAxis[1].min, 0)
  assert.equal(option.yAxis[1].max, 100)
  assert.equal(option.yAxis[0].min, undefined)
  assert.equal(option.series[0].yAxisIndex, 1)
  assert.equal(option.series[1].yAxisIndex, 0)
  assert.equal(option.color[1], '#626a78')
  assert.equal(option.visualMap.length, 1)
  assert.equal(option.visualMap[0].seriesIndex, 0)
  assert.equal(option.visualMap[0].pieces.length, 5)
  assert.equal(option.visualMap[0].pieces[0].lt, 25)
  assert.equal(option.visualMap[0].pieces[4].gte, 75)
  assert.equal(option.series[0].markArea.data[0][0].yAxis, 0)
  assert.equal(option.series[0].markArea.data[0][1].yAxis, 25)
  assert.equal(option.series[0].markArea.data[1][0].yAxis, 75)
  assert.equal(option.series[0].markArea.data[1][1].yAxis, 100)
  assert.equal(option.series[1].markArea, undefined)
  assert.equal(option.series[0].tooltip.valueFormatter(13, 29), '13')
  assert.equal(option.series[1].tooltip.valueFormatter(80000, 29), '$80000（盘中）')
  assert.deepEqual(Array.from(option.series[0].markLine.data, row => row.yAxis), [25, 75])
})
