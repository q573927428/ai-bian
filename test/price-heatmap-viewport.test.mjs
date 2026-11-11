// ==================== 热力图主动定位与视口边界回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { init, use } from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { SVGRenderer } from 'echarts/renderers'
import { ref, watch, nextTick } from 'vue'

use([TreemapChart, SVGRenderer])

test('首页每次持仓点击都触发独立热力图聚焦，包括重复交易对及行情迟到', async () => {
  const home = fs.readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
  const handler = home.slice(home.indexOf('function handlePositionChartSelect('), home.indexOf('const handleConfigSuccess'))
  const heatmap = fs.readFileSync(new URL('../app/components/PriceHeatmap.vue', import.meta.url), 'utf8')
  const requestWatch = heatmap.slice(heatmap.indexOf('watch([() => props.focusRequest,'), heatmap.indexOf('watch(() => props.searchQuery'))
  const request = ref()
  const items = ref([{ symbol: 'BTCUSDT' }])
  const located = []
  const stops = []
  const context = {
    selectedChartSymbol: ref(''), selectedChartTimeframe: ref(''), chartFocusRequest: request,
    props: { get focusRequest() { return request.value }, get items() { return items.value } },
    nextTick, watch: (...args) => { stops.push(watch(...args)) },
    locateSymbol: async symbol => located.push(symbol)
  }
  vm.createContext(context)
  vm.runInContext(ts.transpile(`let chartFocusId = 0; let searchTimer;\n${handler}\n${requestWatch}\nglobalThis.click = handlePositionChartSelect;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  }), context)
  try {
    for (let index = 0; index < 2; index++) {
      context.click('BTC/USDT', '15m')
      await nextTick()
      await nextTick()
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.deepEqual(located, ['BTCUSDT', 'BTCUSDT'])
    context.click('1000PEPE/USDT')
    await nextTick()
    items.value = [...items.value, { symbol: '1000PEPEUSDT' }]
    await nextTick()
    await nextTick()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(located, ['BTCUSDT', 'BTCUSDT', '1000PEPEUSDT'])
  } finally {
    stops.forEach(stop => stop())
  }
})

/** 执行组件真实定位函数，并用实际 ECharts 树图验证布局覆盖视口。 */
for (const homepage of [false, true]) {
test(`${homepage ? '首页持仓定位明确放大' : '行情页保留原定位比例'}，连续定位边缘及小区块不露出空白`, async () => {
  const source = fs.readFileSync(new URL('../app/components/PriceHeatmap.vue', import.meta.url), 'utf8')
  const locate = source.slice(source.indexOf('async function locateSymbol(symbol: string)'), source.indexOf('// 仅外部选择'))
  const clamp = source.slice(source.indexOf('function clampViewRect('), source.indexOf('/** 滚轮和拖动'))
  const reset = source.slice(source.indexOf('function resetZoom()'), source.indexOf('const loadedIcons:'))
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 1360, height: 720 })
  try {
    chart.setOption({ series: [{ id: 'price-heatmap', type: 'treemap', animation: true,
      top: 0, left: 0, right: 0, bottom: 0, scaleLimit: { min: 1, max: 8 }, zoomToNodeRatio: 0.03,
      data: [{ id: 'equity', name: 'equity', children: Array.from({ length: 196 }, (_, index) => ({
        id: `S${index}`, name: `S${index}`, value: 196 - index
      })) }]
    }] })
    let zooms = 0
    const context = {
      props: homepage ? { focusZoom: { minScale: 2, targetAreaRatio: 0.12 } } : {},
      focusedGroup: { value: '' }, nextTick: async () => {},
      chart: {
        getZr: () => chart.getZr(),
        getWidth: () => chart.getWidth(), getHeight: () => chart.getHeight(), getModel: () => chart.getModel(),
        setOption: option => chart.setOption(option),
        dispatchAction: action => {
          if (action.type === 'treemapZoomToNode') {
            assert.equal(chart.getModel().getSeriesByIndex(0).get('animation'), false,
              '原生定位动画不能在校正后继续覆盖区块位置')
            zooms++
          }
          chart.dispatchAction(action)
        }
      }
    }
    vm.createContext(context)
    vm.runInContext(ts.transpile(`let viewRect;\n${locate}\n${clamp}\n${reset}\nglobalThis.api = { locateSymbol, rect: () => viewRect };`, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    }), context)
    for (const symbol of ['S0', 'S195', 'S80', 'S195']) {
      // 模拟行情重绘重新启用动画，下一次主动定位仍必须正确关闭本轮动画。
      chart.setOption({ series: [{ id: 'price-heatmap', animation: true, animationDurationUpdate: 300,
        data: [{ id: 'equity', name: 'equity', children: Array.from({ length: 196 }, (_, index) => ({
          id: `S${index}`, name: `S${index}`, value: 196 - index,
          itemStyle: { borderWidth: `S${index}` === symbol ? 3 : 0.2,
            borderColor: `S${index}` === symbol ? '#66b1ff' : '#14181e' }
        })) }]
      }] })
      // 模拟首次选择触发的数据重绘，覆盖“动画已开始后才定位”的真实顺序。
      let pendingAnimations = 0
      for (const root of chart.getZr().storage.getRoots()) {
        root.traverse(element => { pendingAnimations += element.animators.length })
      }
      assert.ok(pendingAnimations > 0, '首次选中重绘应存在尚未完成的区块动画')
      await context.api.locateSymbol(symbol)
      for (const root of chart.getZr().storage.getRoots()) {
        root.traverse(element => { assert.equal(element.animators.length, 0, '定位后旧动画不能再覆盖内容矩形') })
      }
      const rect = chart.getModel().getSeriesByIndex(0).getData().tree.root.getLayout()
      const saved = context.api.rect()
      assert.equal(rect.x, saved.x)
      assert.equal(rect.y, saved.y)
      if (homepage) assert.ok(rect.width >= chart.getWidth() * 2 - 1e-6, '首页主动定位至少放大全景的2倍')
      assert.equal(chart.getModel().getSeriesByIndex(0).get('zoomToNodeRatio'), homepage ? 0.12 : 0.03)
      assert.ok(rect.x <= 0 && rect.y <= 0)
      assert.ok(rect.x + rect.width >= chart.getWidth() - 1e-6)
      assert.ok(rect.y + rect.height >= chart.getHeight() - 1e-6)
    }
    assert.equal(zooms, 4)
    // 单个大权重目标原生定位可能不放大，仍须达到最低聚焦倍率。
    chart.setOption({ series: [{ id: 'price-heatmap', data: [{ id: 'equity', children: [
      { id: 'BIG', value: 99 }, { id: 'SMALL', value: 1 }
    ] }] }] })
    await context.api.locateSymbol('BIG')
    const bigRect = chart.getModel().getSeriesByIndex(0).getData().tree.root.getLayout()
    if (homepage) assert.ok(bigRect.width >= chart.getWidth() * 2 - 1e-6)
    else assert.ok(Math.abs(bigRect.width - chart.getWidth()) < 1e-6, '行情页大区块不额外强制放大')
    assert.ok(bigRect.x <= 0 && bigRect.x + bigRect.width >= chart.getWidth() - 1e-6)
  } finally {
    chart.dispose()
  }
})
}
