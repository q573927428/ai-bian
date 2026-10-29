// ==================== 多周期图表共享可视窗口 ====================
/** 以时间轴右端为基准的根数偏移，跨周期联动时不混用绝对时间戳。 */
export interface ChartViewport {
  startOffset: number
  endOffset: number
}
