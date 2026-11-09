// ==================== 成交分布视区同步与互斥开关回归 ====================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { ref, watch } from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { calculateVolumeProfile } from '../app/utils/volume-profile.ts'

test('新增图层及父子组件通过Vue脚本和模板编译', () => {
  for (const name of ['VolumeProfileOverlay', 'OrderBookOverlay', 'KLineChartCanvas']) {
    const filename = `${name}.vue`
    const source = readFileSync(new URL(`../app/components/kline-chart/${filename}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    const template = compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})

test('盘口与成交分布在恢复偏好及双向切换时保持互斥', () => {
  const source = readFileSync(new URL('../app/components/kline-chart/KLineChartCanvas.vue', import.meta.url), 'utf8')
  const logic = source.slice(source.indexOf('const orderBookEnabled ='), source.indexOf('const selectedRiskPosition ='))
  const preferences = []
  const setup = new Function('useChartOverlayPreference', 'watch', `${logic}; return { orderBookEnabled, volumeProfileEnabled }`)
  const state = setup(() => { const value = ref(false); preferences.push(value); return value }, watch)
  state.orderBookEnabled.value = true
  assert.equal(state.volumeProfileEnabled.value, false)
  // 模拟后恢复的本地成交分布偏好，必须先关掉已启用的盘口。
  state.volumeProfileEnabled.value = true
  assert.equal(state.orderBookEnabled.value, false)
  state.orderBookEnabled.value = true
  assert.equal(state.volumeProfileEnabled.value, false)
  state.orderBookEnabled.value = false
  assert.equal(state.volumeProfileEnabled.value, false)
})

test('真实绘制逻辑随可见时间和价格缩放更新，关闭/加载/数据更新不残留旧图', async () => {
  let range = { from: 1, to: 1 }
  let scale = 1
  let calculations = 0
  const watchers = []
  const props = {
    enabled: true, loading: false,
    klines: [{ t: 1, o: 10, h: 20, l: 10, c: 20, v: 1, q: 100, bq: 70 }, { t: 2, o: 30, h: 40, l: 30, c: 40, v: 1, q: 500, bq: 100 }],
    getChart: () => ({ timeScale: () => ({ getVisibleRange: () => range, width: () => 600 }), panes: () => [{ getHeight: () => 300 }] }),
    getSeries: () => ({ priceToCoordinate: price => (50 - price) * scale * 4 })
  }
  const fixture = {
    props, computed: fn => ({ get value() { return fn() } }), shallowRef: value => ({ value }),
    onBeforeUnmount() {}, onMounted() {}, useId: () => 'test-profile', watch: (getter, callback) => watchers.push(callback),
    calculateVolumeProfile: (...args) => { calculations++; return calculateVolumeProfile(...args) }
  }
  const file = readFileSync(new URL('../app/components/kline-chart/VolumeProfileOverlay.vue', import.meta.url), 'utf8')
  let source = file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import \{[^}]+\} from 'vue'/, 'const {computed,onBeforeUnmount,onMounted,shallowRef,useId,watch,calculateVolumeProfile} = globalThis.__profileFixture')
    .replace(/import \{ calculateVolumeProfile \} from '[^']+'/, '')
    .replace('const props = defineProps<Props>()', 'const props = globalThis.__profileFixture.props')
    .replace('defineEmits<{ toggle: [] }>()', '')
    .replace('requestAnimationFrame(draw)', '0')
  source += '\nexport { draw, profile, geometry };'
  globalThis.__profileFixture = fixture
  try {
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    const component = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
    component.draw(150)
    assert.equal(component.profile.value.totalBars, 1)
    assert.equal(component.profile.value.bins.reduce((sum, bin) => sum + bin.amount, 0).toFixed(2), '100.00')
    assert.ok(component.geometry.value.bars.every(bar => bar.color === '#25b8a7'))
    const before = component.geometry.value.bars[0].y
    scale = 1.1
    component.draw(300)
    assert.notEqual(component.geometry.value.bars[0].y, before)
    assert.equal(calculations, 1, '仅价格轴缩放不重新分桶')
    range = { from: 2, to: 2 }
    component.draw(450)
    assert.ok(component.geometry.value.bars.every(bar => bar.color === '#ed6069'))
    assert.equal(component.profile.value.bins.reduce((sum, bin) => sum + bin.amount, 0).toFixed(2), '500.00')
    const rendered = component.geometry.value
    // 多次行情更新之间保留同一几何对象，不能先删除SVG再等待150ms重画。
    for (let i = 0; i < 20; i++) {
      watchers[0]()
      assert.equal(component.geometry.value, rendered, '高频更新期间图层不能被清空')
    }
    component.draw(600)
    assert.ok(component.geometry.value, '相同几何的数据更新仍能恢复绘制')
    props.enabled = false
    watchers[1]()
    component.draw(750)
    assert.equal(component.geometry.value, null)
    props.enabled = true
    watchers[1]()
    component.draw(900)
    assert.ok(component.geometry.value)
    props.loading = true
    component.draw(1050)
    assert.equal(component.geometry.value, null)
    props.loading = false
    component.draw(1200)
    assert.ok(component.geometry.value)
    range = { from: 9, to: 10 }
    component.draw(1350)
    assert.equal(component.geometry.value, null)
    assert.equal(component.profile.value.totalBars, 0)
    range = { from: 2, to: 2 }
    props.klines[1].bq = 250
    watchers[0]()
    component.draw(1500)
    assert.ok(component.geometry.value.bars.every(bar => bar.color === '#909399' && !bar.missing))
    // 阈值包含正负5%的边界，绝对值不足5%才是灰色。
    for (const [buy, color] of [[262.5, '#25b8a7'], [237.5, '#ed6069'], [262, '#909399']]) {
      props.klines[1].bq = buy
      watchers[0]()
      component.draw(1650 + [262.5, 237.5, 262].indexOf(buy) * 150)
      assert.ok(component.geometry.value.bars.every(bar => bar.color === color && !bar.missing))
    }
    delete props.klines[1].bq
    watchers[0]()
    component.draw(2100)
    assert.ok(component.geometry.value.bars.every(bar => bar.missing))
    watchers[2]()
    assert.equal(component.geometry.value, null, '切换交易对或周期立即撤下旧分布')
  } finally { delete globalThis.__profileFixture }
})
