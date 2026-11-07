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
  label?: { formatter?: string; rich?: Record<string, Record<string, unknown>> }
}

/** 按完整内容、中等内容和仅图标三档分配尺寸；宽或高不足时隐藏整行。 */
export function fitHeatmapLabel(content: HeatmapLabelContent, width: number, height: number, fontFamily = 'sans-serif'): string {
  const availableWidth = Math.max(0, width - 4)
  const availableHeight = Math.max(0, height - 4)
  // 预留 1px 避免字体测量的小数误差导致图表再次截断最后一个字符。
  const fits = (text: string, size: number, bold = false) => Math.ceil(format.getTextRect(text, `${bold ? 'bold ' : ''}${size}px ${fontFamily}`).width) + 1 <= availableWidth
  const icon = (token: string) => content.icon.replace('{icon|', `{${token}|`)
  // 从当前格子可容纳的最大尺寸向下尝试，放大后内容同步变大，仍保证整行显示。
  const maxIcon = Math.min(40, Math.max(20, Math.floor(Math.min(availableWidth * 0.24, availableHeight * 0.3))))
  for (let size = maxIcon; size >= 20; size--) {
    const nameSize = Math.max(13, Math.round(size * 0.5))
    const changeSize = Math.max(11, Math.round(size * 0.45))
    if (availableWidth >= size && availableHeight >= size + 5 + nameSize + changeSize + 4 && fits(content.name, nameSize, true) && fits(content.change, changeSize)) {
      return [icon(`iconLarge${size}`), '{gap|}', `{nameLarge${nameSize}|${content.name}}`, `{change${changeSize}|${content.change}}`].join('\n')
    }
  }
  // 中档仅保留一行完整文字，名称优先；名称过长时可显示完整涨跌幅。
  for (let size = 20; size >= 16; size--) {
    const fontSize = Math.max(9, Math.round(size * 0.6))
    const nameFits = fits(content.name, fontSize, true)
    if (availableWidth >= size && availableHeight >= size + 5 + fontSize + 2 && (nameFits || fits(content.change, fontSize))) {
      return [icon(`iconMedium${size}`), '{gap|}', nameFits ? `{nameMedium${fontSize}|${content.name}}` : `{change${fontSize}|${content.change}}`].join('\n')
    }
  }
  return availableWidth >= 12 && availableHeight >= 12 ? icon('iconSmall') : ''
}

/** 与三档富文本行高保持一致，供图表将实际显示的内容整体垂直居中。 */
export function getHeatmapLabelHeight(text: string): number {
  if (!text) return 0
  return text.split('\n').reduce((height, line) => {
    if (line.startsWith('{gap|')) return height + 5
    if (line.startsWith('{iconSmall|')) return height + 12
    const size = Number(line.match(/(\d+)\|/)?.[1] || 13)
    return height + size + (line.startsWith('{icon') ? 0 : 2)
  }, 0)
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
        const layout = data.getItemLayout(index) as { width: number; height: number; borderWidth?: number } | undefined
        if (!item?.heatmapLabel || !item.label || !layout) return
        // 每次 resize 和行情更新都使用本轮真实尺寸，不能沿用上轮被删减的 formatter。
        // 树图绘制内容前还会扣掉两侧边框，不能用含边框的面积判断文字是否放得下。
        const border = Math.max(0, layout.borderWidth ?? 0) * 2
        item.label.formatter = fitHeatmapLabel(item.heatmapLabel, Math.max(0, layout.width - border), Math.max(0, layout.height - border), fontFamily)
        const rich = item.label.rich
        if (!rich) return
        for (const token of item.label.formatter.matchAll(/\{(iconLarge|iconMedium|nameLarge|nameMedium|change)(\d+)\|/g)) {
          const [, base, rawSize] = token
          const size = Number(rawSize)
          rich[`${base}${size}`] = base!.startsWith('icon')
            ? { ...rich[base!], width: size, height: size, lineHeight: size, borderRadius: size / 2 }
            : { ...rich[base!], fontSize: size, lineHeight: size + 2 }
        }
      })
    }
  })
}
