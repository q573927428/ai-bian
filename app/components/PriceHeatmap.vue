<!-- ==================== 实时价格矩形树状热力图 ==================== -->
<template>
  <div class="price-heatmap" :style="{ height: `${height}px` }">
    <div ref="chartElement" class="heatmap-chart" role="img" :aria-label="`${period}价格热力图，绿色上涨，红色下跌，可点击分组放大、滚轮缩放、${selectionHint || '点击切换 K 线'}`" />
    <div v-if="searchQuery" class="heatmap-search-results" role="status" aria-live="polite">
      <template v-if="searchMatches.length">
        <span>{{ activeSearchSymbol }} · {{ searchIndex + 1 }} / {{ searchMatches.length }}</span>
        <template v-if="searchMatches.length > 1">
          <button type="button" aria-label="定位上一个匹配代币" title="上一个匹配" @click="stepSearch(-1)">‹</button>
          <button type="button" aria-label="定位下一个匹配代币" title="下一个匹配" @click="stepSearch(1)">›</button>
        </template>
      </template>
      <span v-else>未找到匹配的代币</span>
    </div>
    <div class="heatmap-zoom">
      <button type="button" title="放大" aria-label="放大热力图" @click="zoomChart(1.25)">+</button>
      <button type="button" title="缩小" aria-label="缩小热力图" @click="zoomChart(0.8)">−</button>
      <button type="button" title="恢复视图" aria-label="恢复热力图视图" @click="resetZoom">↺</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LabelLayout } from 'echarts/features'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { getHeatmapColorThresholds, getHeatmapLegend } from '../utils/price-heatmap-colors'
import { useTheme } from '../composables/useTheme'
import { useGlobalPolling } from '../composables/useGlobalPolling'
import { formatPrice } from './kline-chart/utils/kline-formatters'
import { getHeatmapLabelHeight, installPriceHeatmapLabels } from '../utils/price-heatmap-labels'

use([TreemapChart, TooltipComponent, CanvasRenderer, LabelLayout])
installPriceHeatmapLabels()

/** 单个热力图区块；change 为 null 表示当前周期没有有效参考价。 */
interface HeatmapItem {
  symbol: string
  name: string
  price: number
  volume: number | null
  change: number | null
  group: string
  icon: string
}

/** 仅描述保存树图视口所需的内部布局接口，隔离 ECharts 未公开的 getModel 类型。 */
interface HeatmapLayoutReader {
  getModel(): {
    getSeriesByIndex(index: number): {
      getData(): {
        tree?: { root: { getLayout(): { x: number; y: number; width: number; height: number } } }
      }
    } | undefined
  }
}

const props = defineProps<{
  items: HeatmapItem[]
  /** 只定位匹配项，不改变树图数据和各代币的相对面积。 */
  searchQuery: string
  period: string
  selectedSymbol: string
  height: number
  /** 标题栏选择的面积计算方式，变化时重新生成布局快照。 */
  sizeMode: 'change' | 'volume' | 'equal'
  /** 成交额完整窗口的结束时间（毫秒），用于悬浮提示解释统计范围。 */
  volumeWindowEnd?: number
  /** 热门页复用滚动24h ticker成交额，首页继续使用已收盘K线成交额。 */
  volumeSource?: 'closed-klines' | 'ticker24h'
  /** 复用热力图时明确点击区块的实际行为。 */
  selectionHint?: string
  /** 热门页初次进入展示全图，选中详情不等同于用户主动请求缩放定位。 */
  focusSelectedOnMount?: boolean
  /** 是否把详情选中变化视为定位；热门页只接受显式定位请求。 */
  focusOnSelectionChange?: boolean
  /** 独立于详情选中状态的主动定位请求，id允许重复定位同一交易对。 */
  focusRequest?: { symbol: string; id: number }
}>()
const emit = defineEmits<{ select: [symbol: string] }>()
const chartElement = ref<HTMLElement | null>(null)
const { theme } = useTheme()
// 普通边框和分隔缝共用主题色，避免组级与区块级颜色不一致。
const separatorColor = computed(() => theme.value === 'dark' ? '#14181e' : '#e4e7ed')
let chart: ECharts | undefined
let resizeObserver: ResizeObserver | undefined
let hoveredGroup = ''
const focusedGroup = ref('')
let viewRect: { x: number; y: number; width: number; height: number } | undefined
const searchIndex = ref(0)
const searchMatches = computed(() => props.items
  .filter(item => props.searchQuery && item.symbol.includes(props.searchQuery))
  // 精确币名优先，其余按代码排序，实时行情更新不会打乱定位顺序。
  .sort((a, b) => Number(b.name.toUpperCase() === props.searchQuery) - Number(a.name.toUpperCase() === props.searchQuery)
    || a.symbol.localeCompare(b.symbol)))
const activeSearchSymbol = computed(() => searchMatches.value[searchIndex.value]?.symbol ?? '')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let locallySelectedSymbol = ''

/** 图内点击只切换 K 线，标记本轮选择来源，避免父组件回传选中项时触发定位。 */
function selectSymbol(symbol: string) {
  locallySelectedSymbol = symbol
  emit('select', symbol)
  // 等父组件和选中监听处理完再清理；重复点击当前币种也不会留下过期标记。
  void nextTick(() => { locallySelectedSymbol = '' })
}

/** 多个匹配逐个定位，搜索本身不会切换上方 K 线。 */
function stepSearch(direction: number) {
  searchIndex.value = (searchIndex.value + direction + searchMatches.value.length) % searchMatches.value.length
}

/** 使用树图原生缩放定位，保留其他方块，并记录视口以抵御实时行情重绘。 */
async function locateSearchMatch() {
  await locateSymbol(activeSearchSymbol.value)
}

/** 搜索与选中共用原生定位，跨分组定位后仍保留实时更新时的缩放位置。 */
async function locateSymbol(symbol: string) {
  if (!chart) return
  // 搜索可跨资产组，先退出手动分组放大，确保目标节点存在。
  focusedGroup.value = ''
  await nextTick()
  if (!chart) return
  resetZoom()
  if (!symbol) return
  chart.dispatchAction({ type: 'treemapZoomToNode', seriesId: 'price-heatmap', targetNodeId: symbol })
  // 原生定位事件不带 rootRect，仍需读取内部布局；用最小接口隔离私有 API，供重绘恢复视口。
  const data = (chart as unknown as HeatmapLayoutReader).getModel().getSeriesByIndex(0)?.getData()
  const rect = data?.tree?.root.getLayout()
  if (rect) {
    viewRect = clampViewRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'price-heatmap', rootRect: viewRect })
  }
}

// 仅外部选择或目标重新进入结果集时定位，图内点击保留当前视口。
watch([() => props.selectedSymbol, () => props.items.some(item => item.symbol === props.selectedSymbol)],
  ([symbol, available]) => {
    if (props.focusOnSelectionChange !== false && symbol && available && symbol !== locallySelectedSymbol) void locateSymbol(symbol)
  }, { flush: 'post' })

watch(() => props.focusRequest, async (request) => {
  if (!request) return
  // 等搜索清空监听执行后取消其恢复全景定时器，避免覆盖本次主动定位。
  await nextTick()
  if (request !== props.focusRequest) return
  if (searchTimer) clearTimeout(searchTimer)
  if (props.items.some(item => item.symbol === request.symbol)) await locateSymbol(request.symbol)
}, { flush: 'post' })

watch(() => props.searchQuery, () => { searchIndex.value = 0 }, { flush: 'sync' })
watch([() => props.searchQuery, () => searchMatches.value.map(item => item.symbol).join(','), searchIndex], () => {
  if (searchIndex.value >= searchMatches.value.length) searchIndex.value = 0
  if (searchTimer) clearTimeout(searchTimer)
  // 输入停顿后再定位，避免每个按键都触发跳动；清空则立即恢复全景。
  searchTimer = setTimeout(() => { void locateSearchMatch() }, props.searchQuery ? 200 : 0)
}, { flush: 'post' })

/** 限制热力图外框覆盖整个显示区域，防止平移或缩小时露出空白。 */
function clampViewRect(rect: NonNullable<typeof viewRect>): NonNullable<typeof viewRect> {
  if (!chart) return rect
  const width = Math.max(chart.getWidth(), rect.width)
  const height = Math.max(chart.getHeight(), rect.height)
  return {
    width, height,
    x: Math.max(chart.getWidth() - width, Math.min(0, rect.x)),
    y: Math.max(chart.getHeight() - height, Math.min(0, rect.y))
  }
}

/** 滚轮和拖动共用边界校正；仅越界时补发位置更新，避免事件循环。 */
function constrainRoam(params: unknown) {
  const event = params as { rootRect?: typeof viewRect }
  const rect = event.rootRect
  if (!rect || !chart) return
  viewRect = clampViewRect(rect)
  if (rect.x !== viewRect.x || rect.y !== viewRect.y || rect.width !== viewRect.width || rect.height !== viewRect.height) {
    chart.dispatchAction({ type: 'treemapMove', seriesId: 'price-heatmap', rootRect: viewRect })
  }
}

/** 再次点击当前分组标题返回全部资产，不额外占用顶部按钮空间。 */
function focusGroup(group: string) {
  highlightGroup('')
  focusedGroup.value = focusedGroup.value === group ? '' : group
  viewRect = undefined
}

/** 子区块的原生悬停不会传递给父板块，联动父节点的边框和标题底层背景。 */
function highlightGroup(group: string) {
  if (!chart || group === hoveredGroup) return
  if (hoveredGroup) {
    chart.dispatchAction({ type: 'downplay', seriesId: 'price-heatmap', name: hoveredGroup, highlightKey: 'heatmap-group-hover' })
  }
  hoveredGroup = group
  if (group) {
    // 使用独立的高亮来源，避免移出代币时的原生 downplay 提前清除父板块高亮。
    chart.dispatchAction({ type: 'highlight', seriesId: 'price-heatmap', name: group, highlightKey: 'heatmap-group-hover' })
  }
}

/** 按当前视口中心缩放，沿用滚轮/拖动产生的矩形，避免按钮与滚轮缩放互相跳变。 */
function zoomChart(factor: number) {
  if (!chart) return
  const width = chart.getWidth()
  const height = chart.getHeight()
  const rect = viewRect ?? { x: 0, y: 0, width, height }
  const nextWidth = Math.max(width, Math.min(width * 8, rect.width * factor))
  const ratio = nextWidth / rect.width
  viewRect = clampViewRect({ x: width / 2 - (width / 2 - rect.x) * ratio, y: height / 2 - (height / 2 - rect.y) * ratio, width: nextWidth, height: rect.height * ratio })
  chart.dispatchAction({ type: 'treemapRender', seriesId: 'price-heatmap', rootRect: viewRect })
}

/** 恢复缩放和平移，保留当前选中的资产组。 */
function resetZoom() {
  if (!chart) return
  viewRect = { x: 0, y: 0, width: chart.getWidth(), height: chart.getHeight() }
  chart.dispatchAction({ type: 'treemapRender', seriesId: 'price-heatmap', rootRect: viewRect })
}
const roundedIcons = shallowRef<Record<string, string>>({})
const loadedIcons: Record<string, string> = {}
const pendingIcons = new Map<string, HTMLImageElement>()
const failedIcons = new Set<string>()
let iconsActive = false
let iconFlushFrame: number | undefined

/** 圆形裁剪必须作用于图片像素；ECharts 富文本的 borderRadius 不会裁掉图片背景的方角。 */
function loadRoundedIcons() {
  if (!iconsActive) return
  for (const url of new Set(props.items.map(item => item.icon).filter(Boolean))) {
    if (loadedIcons[url] || pendingIcons.has(url) || failedIcons.has(url)) continue
    const image = new Image()
    pendingIcons.set(url, image)
    // 远程官方图标使用匿名 CORS，不能读取的图片保留圆形占位，避免污染图表画布。
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      pendingIcons.delete(url)
      if (!iconsActive) return
      try {
        const canvas = document.createElement('canvas')
        // 缩放后最大 40px 图标仍使用双倍分辨率，避免出现模糊边缘。
        const size = 80
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d')
        if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error('图标不可绘制')
        context.beginPath()
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
        context.clip()
        // 按 cover 比例居中绘制，长方形原图也不拉伸变形。
        const scale = size / Math.min(image.naturalWidth, image.naturalHeight)
        const width = image.naturalWidth * scale
        const height = image.naturalHeight * scale
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        loadedIcons[url] = canvas.toDataURL('image/png')
        // 同一帧批量提交图标，避免每张图片到达都单独重绘热力图。
        if (iconFlushFrame === undefined) {
          iconFlushFrame = requestAnimationFrame(() => {
            iconFlushFrame = undefined
            roundedIcons.value = { ...loadedIcons }
          })
        }
      } catch {
        failedIcons.add(url)
      }
    }
    image.onerror = () => {
      pendingIcons.delete(url)
      failedIcons.add(url)
    }
    image.src = url
  }
}

watch(() => [...new Set(props.items.map(item => item.icon).filter(Boolean))].sort().join('\n'), loadRoundedIcons)

const colorThresholds = computed(() => getHeatmapColorThresholds(props.period))
const legend = computed(() => getHeatmapLegend(props.period))

/** 按当前周期的七个颜色锚点过渡，只有持平或缺失行情使用灰色。 */
function changeColor(change: number | null): string {
  const colors = legend.value
  if (change === null || !Number.isFinite(change) || change === 0) return colors[3]!.color
  const [low, middle, high] = colorThresholds.value
  const magnitude = Math.abs(change)
  const indices = change > 0 ? [4, 5, 6] : [2, 1, 0]
  if (magnitude <= low) return colors[indices[0]!]!.color
  if (magnitude >= high) return colors[indices[2]!]!.color
  const lower = magnitude <= middle ? low : middle
  const upper = magnitude <= middle ? middle : high
  const start = colors[indices[magnitude <= middle ? 0 : 1]!]!.color
  const end = colors[indices[magnitude <= middle ? 1 : 2]!]!.color
  if (magnitude === middle) return colors[indices[1]!]!.color
  const ratio = (magnitude - lower) / (upper - lower)
  // 在同一方向的颜色之间插值，不经过灰色，保证微小涨跌也可辨认。
  const channels = [1, 3, 5].map(offset => {
    const from = parseInt(start.slice(offset, offset + 2), 16)
    const to = parseInt(end.slice(offset, offset + 2), 16)
    return Math.round(from + (to - from) * ratio)
  })
  return `rgb(${channels.join(',')})`
}

/** 缺失涨跌幅不伪造为 0%；标签与悬浮提示使用同一格式。 */
function changeLabel(change: number | null): string {
  return change === null ? '待更新' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
}

// 面积复用全局 60 秒节拍取最新权重；两次刷新之间实时价格只更新颜色和文字。
const layoutRevision = ref(0)
useGlobalPolling(() => { layoutRevision.value++ })
let layoutKey = ''
const layoutWeights = new Map<string, number>()

const chartData = computed(() => {
  const key = JSON.stringify([layoutRevision.value, props.period, props.sizeMode, props.items.map((item) => [item.symbol, item.group])])
  if (key !== layoutKey) {
    layoutKey = key
    layoutWeights.clear()
  }
  // 参考价首次到达前不锁定占位面积，待有效数据出现后再固定一次。
  const maxVolume = Math.max(0, ...props.items.map((item) => typeof item.volume === 'number' && Number.isFinite(item.volume) ? item.volume : 0))
  const groups = new Map<string, object[]>()
  for (const item of props.items) {
    const liveWeight = props.sizeMode === 'equal' ? 1
      : props.sizeMode === 'volume' ? Math.max(typeof item.volume === 'number' && Number.isFinite(item.volume) ? item.volume : 0, maxVolume * 0.002, 1)
        : Math.max(Math.abs(item.change ?? 0), 0.3)
    const ready = props.sizeMode === 'equal' || (props.sizeMode === 'volume' ? item.volume !== null && item.volume >= 0 : item.change !== null)
    if (!layoutWeights.has(item.symbol) && ready) layoutWeights.set(item.symbol, liveWeight)
    const value = layoutWeights.get(item.symbol) ?? liveWeight
    const iconStyle = {
      fontSize: 9, align: 'center',
      // 三档尺寸共用同一张圆形图片，加载中或失败时也保留圆形占位。
      backgroundColor: roundedIcons.value[item.icon] ? { image: roundedIcons.value[item.icon] } : '#515761'
    }
    const isSelected = item.symbol === props.selectedSymbol
    const isSearchMatch = Boolean(props.searchQuery && item.symbol.includes(props.searchQuery))
    const borderColor = item.symbol === activeSearchSymbol.value ? '#ffd666'
      : isSearchMatch ? '#ffffff' : isSelected ? '#66b1ff' : separatorColor.value
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group)!.push({
      id: item.symbol,
      name: item.name,
      symbol: item.symbol,
      group: item.group,
      value,
      // 保留完整原文，布局阶段依据区块实际宽高决定每一行是否完整显示。
      heatmapLabel: {
        icon: `{icon|${roundedIcons.value[item.icon] ? '' : item.name.slice(0, 1)}}`,
        name: item.name,
        change: changeLabel(item.change)
      },
      itemStyle: {
        color: changeColor(item.change),
        borderColor,
        // 分隔线由代币自身绘制，避免父板块高亮背景透过间隙；相邻各半像素组成 1px 分隔线。
        // 当前交易对用持续的粗蓝框标记，保留涨跌底色；搜索命中仍沿用黄/白色。
        borderWidth: isSelected ? 3 : isSearchMatch ? 2 : 0.2
      },
      // 悬停保持内部边框不变，普通分隔线只跟随主题；选中和搜索标记继续保留。
      emphasis: {
        itemStyle: {
          borderColor,
          borderWidth: isSelected ? 3 : isSearchMatch ? 2 : 0.2
        }
      },
      label: {
        // 实际文本由布局阶段填入，避免图表自动生成省略号或不完整的百分比。
        formatter: '',
        rich: {
          iconLarge: { ...iconStyle, height: 20, width: 20, lineHeight: 20, borderRadius: 10 },
          iconMedium: { ...iconStyle, height: 16, width: 16, lineHeight: 16, borderRadius: 8 },
          iconSmall: { ...iconStyle, height: 12, width: 12, lineHeight: 12, borderRadius: 6 },
          gap: { height: 5, width: 1, lineHeight: 5, fontSize: 0 },
          nameLarge: { fontSize: 13, fontWeight: 'bold', lineHeight: 13 },
          nameMedium: { fontSize: 9, fontWeight: 'bold', lineHeight: 13 },
          change: { fontSize: 11, lineHeight: 13 }
        }
      }
    })
  }
  return [...groups].filter(([name]) => !focusedGroup.value || name === focusedGroup.value)
    .map(([name, children]) => ({ id: name, name, children }))
})

watch(focusedGroup, () => { resetZoom() }, { flush: 'post' })
watch(() => props.items.map(item => item.group).join(','), () => {
  if (focusedGroup.value && !props.items.some(item => item.group === focusedGroup.value)) focusGroup('')
})

/** 面积随全局轮询刷新时使用短过渡，让区块大小和位置变化更容易跟随。 */
function renderChart() {
  if (!chart) return
  const savedViewRect = viewRect && { ...viewRect }
  const zoomed = savedViewRect && (savedViewRect.width !== chart.getWidth() || savedViewRect.x !== 0 || savedViewRect.y !== 0)
  const dark = theme.value === 'dark'
  const option: EChartsCoreOption = {
    animation: true,
    tooltip: {
      // 富文本提示避免将交易对名称拼接成 HTML，同时让内容跟随鼠标保持在容器内。
      renderMode: 'richText',
      confine: true,
      backgroundColor: dark ? '#20242c' : '#ffffff',
      borderColor: dark ? '#41464d' : '#dcdfe6',
      textStyle: { color: dark ? '#f2f3f5' : '#303133', fontSize: 12 },
      formatter: (params: { data?: { symbol?: string } }) => {
        const item = props.items.find((entry) => entry.symbol === params.data?.symbol)
        if (!item) return ''
        const volume = item.volume === null ? '待更新'
          : '$' + new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(item.volume)
        const volumeLine = props.sizeMode === 'volume'
          ? `\n${props.period} 成交额：${volume}\n${props.volumeSource === 'ticker24h' ? '币安滚动24h行情快照' : `仅含已收盘 5m K 线${props.volumeWindowEnd ? '，截至 ' + new Date(props.volumeWindowEnd).toLocaleTimeString() : ''}`}` : ''
        return `${item.name} · ${item.group}\n最新价：${item.price > 0 ? '$' + formatPrice(item.price) : '待更新'}\n${props.period} 涨跌幅：${changeLabel(item.change)}${volumeLine}\n${props.selectionHint || '点击切换 K 线'}`
      }
    },
    series: [{
      id: 'price-heatmap',
      type: 'treemap',
      // 放大状态下不能先播放恢复默认布局的动画，否则实时更新会把视图拉回原位。
      animation: !zoomed,
      animationDurationUpdate: 300,
      animationEasingUpdate: 'cubicOut',
      stateAnimation: { duration: 0 },
      data: chartData.value,
      top: 0, left: 0, right: 0, bottom: 0,
      roam: true,
      scaleLimit: { min: 1, max: 8 },
      // 定位时让目标占约 3% 的视口面积，保留更多周边代币供对照。
      zoomToNodeRatio: 0.03,
      // 缩放仅改变视口，不因放大而重新增删小格，保持整体布局一致。
      visibleMin: 0,
      childrenVisibleMin: 0,
      nodeClick: false,
      breadcrumb: { show: false },
      // 默认每侧 5px 留白会让 20px 左右的小格连图标都放不下，缩至 2px 后优先显示图标。
      label: { show: true, padding: 2, color: '#fff', overflow: 'truncate', align: 'center', verticalAlign: 'middle' },
      labelLayout: (params: { rect: { height: number }; text: string }) => {
        // 树图会把富文本容器撑满格子，verticalAlign 只能居中容器；按实际可见行高补偿内容位置。
        const available = Math.max(0, params.rect.height - 4)
        const visibleHeight = getHeatmapLabelHeight(params.text)
        return { dy: visibleHeight ? Math.max(0, (available - visibleHeight) / 2) : 0 }
      },
      upperLabel: { show: true, height: 18, color: dark ? '#e5e7eb' : '#303133', fontSize: 11 },
      itemStyle: { borderColor: separatorColor.value, borderWidth: 2, gapWidth: 1 },
      emphasis: { itemStyle: { borderColor: '#a3d0ff', borderWidth: 1 } },
      levels: [
        // 根节点只负责排列资产分组，不展示无名称的父级标题栏。
        { itemStyle: { gapWidth: 4 }, upperLabel: { show: false } },
        {
          // 树图的父节点背景同时承载外框和标题栏；标题文本背景透明，避免覆盖高亮后留下深色横条。
          // 关闭子区块间隙，内部改用代币边框分隔，只让板块外框和标题露出高亮背景。
          itemStyle: { color: dark ? '#1c2026' : '#f2f3f5', borderColor: separatorColor.value, gapWidth: 0 },
          upperLabel: { show: true, padding: [0, 0, 0, 6], backgroundColor: 'transparent' },
          emphasis: {
            itemStyle: { borderColor: '#a3d0ff' },
            // 高亮底色为浅蓝，标题使用深色文字以保持可读性；显式透明也清除合并更新遗留的旧背景。
            upperLabel: { color: '#172b4d', backgroundColor: 'transparent' }
          }
        },
        { upperLabel: { show: false } }
      ]
    }]
  }
  // 合并更新以复用系列、区块和 TooltipView；全量重建会在每次行情推送时清除悬停提示。
  chart.setOption(option, { notMerge: false })
  // ECharts 的 setOption 会按初始容器重算树图；在同一帧恢复视口，保留缩放和平移。
  // 此动作只改变显示范围，不清空已锁定的面积权重。
  if (savedViewRect) {
    chart.dispatchAction({ type: 'treemapRender', seriesId: 'price-heatmap', rootRect: savedViewRect })
  }
}

watch([chartData, () => props.period, theme], renderChart)

onMounted(() => {
  iconsActive = true
  loadRoundedIcons()
  if (!chartElement.value) return
  chart = init(chartElement.value)
  chart.on('mouseover', (params) => {
    const data = params.data as { group?: string; name?: string; children?: unknown[] } | undefined
    highlightGroup(data?.group ?? (data?.children ? data.name ?? '' : ''))
  })
  // 标题、代币和分隔缝之间移动时保持所属板块高亮，离开画布或进入空白后恢复。
  chart.getZr().on('mousemove', (event) => {
    if (!event.target) highlightGroup('')
  })
  chart.getZr().on('globalout', () => { highlightGroup('') })
  chart.on('click', (params) => {
    const data = params.data as { symbol?: string; name?: string; children?: unknown[] } | undefined
    if (data?.symbol) selectSymbol(data.symbol)
    else if (data?.children && data.name) focusGroup(data.name)
  })
  chart.on('treemaprender', constrainRoam)
  chart.on('treemapmove', constrainRoam)
  resizeObserver = new ResizeObserver(() => {
    if (!chart || !chartElement.value) return
    const width = chartElement.value.clientWidth
    const height = chartElement.value.clientHeight
    if (width === chart.getWidth() && height === chart.getHeight()) return
    // 容器真正变化才调整视口；普通行情重绘不能清空缩放状态。
    if (viewRect && chart.getWidth() && chart.getHeight()) {
      const scaleX = width / chart.getWidth()
      const scaleY = height / chart.getHeight()
      viewRect = { x: viewRect.x * scaleX, y: viewRect.y * scaleY, width: viewRect.width * scaleX, height: viewRect.height * scaleY }
    }
    chart.resize()
    if (viewRect) chart.dispatchAction({ type: 'treemapRender', seriesId: 'price-heatmap', rootRect: viewRect })
  })
  resizeObserver.observe(chartElement.value)
  renderChart()
  if (props.searchQuery) void locateSearchMatch()
  else if (props.focusSelectedOnMount !== false && props.items.some(item => item.symbol === props.selectedSymbol)) void locateSymbol(props.selectedSymbol)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  iconsActive = false
  if (iconFlushFrame !== undefined) cancelAnimationFrame(iconFlushFrame)
  for (const image of pendingIcons.values()) {
    image.onload = image.onerror = null
    image.src = ''
  }
  pendingIcons.clear()
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = undefined
})
</script>

<style scoped>
.price-heatmap {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin: -10px;
}
.heatmap-zoom {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 平时弱化遮挡，鼠标或键盘操作时恢复清晰。 */
  opacity: 0.55;
  transition: opacity 0.18s ease;
}
.heatmap-zoom:hover,
.heatmap-zoom:focus-within {
  opacity: 1;
}
.heatmap-search-results {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color-overlay);
  color: var(--text-primary);
  font-size: 12px;
  /* 搜索提示与缩放控件保持一致，减少对行情方块的遮挡。 */
  opacity: 0.55;
  transition: opacity 0.18s ease;
}
.heatmap-search-results:hover,
.heatmap-search-results:focus-within {
  opacity: 1;
}
.heatmap-search-results button {
  border: 0;
  border-radius: 3px;
  background: var(--el-fill-color);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 16px;
}
.heatmap-zoom button {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color-overlay);
  color: var(--text-primary);
  cursor: pointer;
}
.heatmap-zoom button { width: 25px; height: 25px; font-size: 17px; padding: 0; }
.heatmap-zoom button:hover { background: var(--el-fill-color-dark); }
.heatmap-chart {
  width: 100%;
  flex: 1;
  min-height: 0;
}
</style>
