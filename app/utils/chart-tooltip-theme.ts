// ==================== 图表悬浮提示框主题配色 ====================

/** 从图表容器读取当前主题色；返回实际颜色，同时兼容 HTML 和 Canvas 富文本提示框。 */
export function getChartTooltipTheme(element: HTMLElement) {
  const styles = getComputedStyle(element)
  return {
    backgroundColor: styles.getPropertyValue('--bg-tooltip').trim() || '#ffffff',
    borderColor: styles.getPropertyValue('--border-color').trim() || '#ebeef5',
    textStyle: { color: styles.getPropertyValue('--text-primary').trim() || '#303133' },
    shadowColor: 'rgba(0, 0, 0, 0.2)',
    shadowBlur: 8,
  }
}
