// ==================== 宏观看板容器自适应布局 ====================

/** 少量图表优先横排，四个使用两行两列，其余按接近方形布局并限制每行宽度。 */
export function macroGridLayout(count: number, width: number) {
  const maxColumns = width > 1100 ? 4 : width >= 900 ? 3 : width >= 600 ? 2 : 1
  const preferred = count <= 3 ? count : Math.ceil(Math.sqrt(count))
  const columns = Math.max(1, Math.min(preferred, maxColumns))
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) }
}
