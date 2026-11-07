// ==================== 热力图标签完整显示与空间分配 ====================
import { format, registerLayout } from 'echarts/core'

/** 区块标签原始内容；每次布局均从原文判断，窗口变大后可恢复被隐藏的行。 */
export interface HeatmapLabelContent {
  icon: string
  name: string
  change: string
}

/** 树图叶节点的标签相关字段，只处理价格热力图提供的节点。 */
interface HeatmapLabelItem {
  heatmapLabel?: HeatmapLabelContent
  label?: { formatter?: string }
}

/** 按完整内容、中等内容和仅图标三档分配尺寸；宽或高不足时隐藏整行。 */
export function fitHeatmapLabel(content: HeatmapLabelContent, width: number, height: number, fontFamily = 'sans-serif'): string {
  const availableWidth = Math.max(0, width - 4)
  const availableHeight = Math.max(0, height - 4)
  // 预留 1px 避免字体测量的小数误差导致图表再次截断最后一个字符。
  const largeNameFits = Math.ceil(format.getTextRect(content.name, `bold 13px ${fontFamily}`).width) + 1 <= availableWidth
  const mediumNameFits = Math.ceil(format.getTextRect(content.name, `bold 9px ${fontFamily}`).width) + 1 <= availableWidth
  const changeFits = Math.ceil(format.getTextRect(content.change, `11px ${fontFamily}`).width) + 1 <= availableWidth
  const icon = (token: string) => content.icon.replace('{icon|', `{${token}|`)
  // 完整信息使用 20px 图标，图标与文字间另留 5px；两行文字各占 13px。
  if (availableWidth >= 20 && availableHeight >= 51 && largeNameFits && changeFits) {
    return [icon('iconLarge'), '{gap|}', `{nameLarge|${content.name}}`, `{change|${content.change}}`].join('\n')
  }
  // 中档仅保留一行完整文字，名称优先；名称过长时可显示完整涨跌幅。
  if (availableWidth >= 16 && availableHeight >= 34 && (mediumNameFits || changeFits)) {
    return [icon('iconMedium'), '{gap|}', mediumNameFits ? `{nameMedium|${content.name}}` : `{change|${content.change}}`].join('\n')
  }
  return availableWidth >= 12 && availableHeight >= 12 ? icon('iconSmall') : ''
}

/** 与三档富文本行高保持一致，供图表将实际显示的内容整体垂直居中。 */
export function getHeatmapLabelHeight(text: string): number {
  if (!text) return 0
  return text.split('\n').reduce((height, line) => height + (
    line.startsWith('{iconLarge|') ? 20 : line.startsWith('{iconMedium|') ? 16
      : line.startsWith('{iconSmall|') ? 12 : line.startsWith('{gap|') ? 5 : 13
  ), 0)
}

let installed = false

/** 在树图计算区块尺寸之后、绘制标签之前应用整行显示规则；仅注册一次且只影响价格看板。 */
export function installPriceHeatmapLabels() {
  if (installed) return
  installed = true
  registerLayout(1100, {
    seriesType: 'treemap',
    reset(seriesModel, ecModel) {
      if (seriesModel.id !== 'price-heatmap') return
      const data = seriesModel.getData()
      const fontFamily = ecModel.option.textStyle?.fontFamily || 'sans-serif'
      data.each(index => {
        const item = data.getRawDataItem(index) as HeatmapLabelItem | undefined
        const layout = data.getItemLayout(index) as { width: number; height: number } | undefined
        if (!item?.heatmapLabel || !item.label || !layout) return
        // 每次 resize 和行情更新都使用本轮真实尺寸，不能沿用上轮被删减的 formatter。
        item.label.formatter = fitHeatmapLabel(item.heatmapLabel, layout.width, layout.height, fontFamily)
      })
    }
  })
}
